import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg'};
const server=createServer(async (req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const file=resolve(root,'.'+pathname);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    const buffer=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}).end(buffer);
  }catch{res.writeHead(404).end('Not found');}
});
await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));
const url='http://127.0.0.1:'+server.address().port+'/holy-angel-multi-planner-test.html';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let count=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);count++};
const ok=(condition,label)=>{assert.ok(condition,label);count++};
try{
  for(const width of [360,390,412,768]){
    const page=await browser.newPage({viewport:{width,height:850},acceptDownloads:true});
    const exceptions=[];
    page.on('pageerror',error=>exceptions.push(error.message));
    const response=await page.goto(url,{waitUntil:'networkidle'});
    eq(response.status(),200,'Page HTTP 200');
    await page.locator('#plan-list .plan-card').first().waitFor();
    eq(await page.locator('#plan-list .plan-card').count(),2,'Two starter plans');
    const x=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
    ok(x,'No horizontal page overflow at '+width);
    const background=await page.locator('.relic-icon').first().evaluate(el=>getComputedStyle(el).backgroundImage);
    ok(background.includes('relic-sprite.jpg'),'Game sprite is wired');
    await page.locator('[name="parts-arm"]').fill('20');
    // Both pieces now use arm parts from the same shared inventory.
    const cards=page.locator('#plan-list .plan-card');
    await cards.nth(0).locator('[data-field="target"]').fill('250');
    await cards.nth(1).locator('[data-field="slot"]').selectOption('arm');
    await cards.nth(1).locator('[data-field="target"]').fill('280');
    await page.locator('[data-action="calculate"]').click();
    await page.locator('#multi-results').waitFor({state:'visible'});
    eq(await page.locator('#overall-exchanges').textContent(),'2回','Shared parts, total 2 exchanges');
    const rows=page.locator('#combined-details tr');
    eq((await rows.nth(0).locator('td').allTextContents())[3],'0回','First piece starts with 20 parts');
    eq((await rows.nth(1).locator('td').allTextContents())[3],'2回','Second piece uses remaining 5');
    await cards.nth(1).locator('[data-action="up"]').click();
    eq(await page.locator('#multi-results').isVisible(),false,'Old forecast hidden on reorder');
    await page.locator('[data-action="calculate"]').click();
    await page.locator('#multi-results').waitFor({state:'visible'});
    eq(await page.locator('#overall-exchanges').textContent(),'2回','Same total exchanges after reorder');
    eq((await rows.nth(0).locator('td').allTextContents())[3],'1回','Priority first takes available parts');
    eq((await rows.nth(1).locator('td').allTextContents())[3],'1回','Priority second needs one exchange');
    await page.locator('[data-action="save"]').click();
    ok((await page.locator('#save-state').textContent()).includes('この端末だけ'),'Local save is explicitly device-only');
    await page.reload({waitUntil:'networkidle'});
    await page.locator('[data-action="load"]').click();
    eq(await page.locator('#plan-list .plan-card').first().locator('[data-field="target"]').inputValue(),'280','Saved priority reload');
    const downloadPromise=page.waitForEvent('download');
    await page.locator('[data-action="export"]').click();
    const download=await downloadPromise;
    eq(download.suggestedFilename(),'holy-angel-plans.json','JSON export name');
    const filePath=await download.path();
    const json=JSON.parse((await readFile(filePath)).toString('utf8'));
    eq(json.version,1,'JSON version');
    eq(json.plans.length,2,'JSON count');
    const pic=page.locator('#plan-list .plan-card').first();
    await pic.locator('[data-field="target"]').fill('545');
    await page.locator('[data-action="calculate"]').click();
    ok(await page.locator('#multi-error').isVisible(),'Non-10-level target rejected');
    ok(!(await page.locator('#multi-results').isVisible()),'Invalid plan no result');
    await page.locator('#import-json').setInputFiles({name:'holy-angel-plans.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify(json),'utf8')});
    await page.locator('#save-state').getByText('ファイルからデータを読み込みました。実在庫と計画を必ず確認してください。').waitFor({state:'visible',timeout:5000});
    eq(await page.locator('#plan-list .plan-card').first().locator('[data-field="target"]').inputValue(),'280','JSON reimport restore');
    eq(exceptions,[],'No browser page errors');
    if(width===390){
      await page.locator('[data-action="calculate"]').click();
      await page.locator('#multi-results').waitFor({state:'visible'});
      await page.screenshot({path:'holy-angel-multi-390.png',fullPage:true});
    }
    await page.close();
  }
  console.log('PASS '+count+' Chromium multi-plan interactions (360/390/412/768px)');
}finally{await browser.close();await new Promise(close=>server.close(close));}
