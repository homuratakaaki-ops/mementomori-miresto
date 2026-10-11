import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  try{
    const requestPath=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const file=resolve(root,'.'+requestPath);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}).end(bytes);
  }catch{res.writeHead(404).end('Not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const url='http://127.0.0.1:'+server.address().port+'/holy-angel-actuals-test.html';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
let checks=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++};
const ok=(condition,label)=>{assert.ok(condition,label);checks++};
try{
for(const width of [360,390,412,768]){
  const page=await browser.newPage({viewport:{width,height:850},acceptDownloads:true});
  page.on('dialog',dialog=>dialog.accept());
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const response=await page.goto(url,{waitUntil:'networkidle'});
  eq(response.status(),200,'Preview served');
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow '+width);
  await page.locator('[name="snapshotAt"]').fill('2026-10-11T18:00');
  await page.locator('[name="eventAt"]').fill('2026-10-11T18:05');
  await page.locator('[name="initialTickets"]').fill('9');
  await page.locator('[name="initialDiamonds"]').fill('30000');
  await page.locator('[name="relic-medal"]').fill('1');
  await page.locator('[name="drawCount"]').fill('10');
  await page.locator('[name="drawTickets"]').fill('9');
  await page.locator('[name="drawFree"]').check();
  await page.locator('[data-action="record"]').click();
  eq(await page.locator('#actual-gauge').textContent(),'10/50回','Ten draw gauge');
  eq(await page.locator('#actual-tickets').textContent(),'0枚','Nine tickets used');
  ok((await page.locator('#pending-note').textContent()).includes('10回報酬'),'Claim remains pending');
  eq(await page.locator('#actual-inventory .relic-line').first().locator('strong').textContent(),'0個','No relic before claimed');
  // Invalid repeated free draw must not mutate saved history.
  await page.locator('[name="drawCount"]').fill('1');
  await page.locator('[name="drawTickets"]').fill('0');
  await page.locator('[data-action="record"]').click();
  ok(await page.locator('#actual-error').isVisible(),'Second free use rejected');
  eq(await page.locator('#event-list .card').count(),1,'Failed event is not registered');
  // Claim at 10 after actually receiving it.
  await page.locator('[name="eventType"]').selectOption('claim');
  await page.locator('[name="claimMilestone"]').selectOption('10');
  await page.locator('[name="claimWon"]').selectOption('true');
  await page.locator('[data-action="record"]').click();
  eq(await page.locator('#actual-inventory .relic-line').first().locator('strong').textContent(),'1個','10 reward confirmed');
  // Continue to 25, claim loss, then draw 50 and claim guaranteed one.
  await page.locator('[name="eventType"]').selectOption('draw');
  await page.locator('[name="drawCount"]').fill('15');
  await page.locator('[name="drawFree"]').uncheck();
  await page.locator('[data-action="record"]').click();
  eq(await page.locator('#actual-diamonds').textContent(),'4,500ダイヤ','15 paid draws');
  await page.locator('[name="eventType"]').selectOption('claim');
  await page.locator('[name="claimMilestone"]').selectOption('25');
  await page.locator('[name="claimWon"]').selectOption('false');
  await page.locator('[data-action="record"]').click();
  await page.locator('[name="eventType"]').selectOption('draw');
  await page.locator('[name="drawCount"]').fill('25');
  await page.locator('[data-action="record"]').click();
  await page.locator('[name="eventType"]').selectOption('claim');
  await page.locator('[name="claimMilestone"]').selectOption('50');
  await page.locator('[name="claimWon"]').selectOption('true');
  await page.locator('[data-action="record"]').click();
  eq(await page.locator('#actual-gauge').textContent(),'0/50回','Reset at 50');
  eq(await page.locator('#actual-inventory .relic-line').first().locator('strong').textContent(),'2個','10+50 rewards');
  eq(await page.locator('#actual-diamonds').textContent(),'12,000ダイヤ','Paid draw total');
  // Exchange requires paired relics, adds 50 unused part pieces.
  await page.locator('[name="eventType"]').selectOption('exchange');
  await page.locator('[name="exchangeSlot"]').selectOption('arm');
  await page.locator('[data-action="record"]').click();
  ok((await page.locator('#actual-inventory').textContent()).includes('手 50個'),'Part exchange adds 50');
  eq(await page.locator('#actual-inventory .relic-line').first().locator('strong').textContent(),'1個','One chalice spent');
  eq(await page.locator('#actual-inventory .relic-line').nth(1).locator('strong').textContent(),'0個','One medal spent');
  await page.locator('[data-action="undo"]').click();
  ok((await page.locator('#actual-inventory').textContent()).includes('手 0個'),'Undo restores parts');
  eq(await page.locator('#actual-inventory .relic-line').nth(1).locator('strong').textContent(),'1個','Undo restores medal');
  // Explicit local save, reload, same data. No cloud.
  await page.locator('[data-action="save"]').click();
  ok((await page.locator('#actual-status').textContent()).includes('この端末だけ'),'Local-only saved label');
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-action="load"]').click();
  eq(await page.locator('#actual-inventory .relic-line').first().locator('strong').textContent(),'2個','Save/reload retains actual claims');
  eq(await page.locator('#event-list .card').count(),6,'Undo retained only six actual events');
  const downloadPromise=page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download=await downloadPromise;
  eq(download.suggestedFilename(),'holy-angel-actuals-v2.json','Versioned backup');
  const json=JSON.parse((await readFile(await download.path())).toString('utf8'));
  eq(json.schemaVersion,2,'JSON v2 schema');
  eq(json.events.length,6,'JSON includes actual events');
  // Modify draft, import JSON, ensure all data restored.
  await page.locator('[name="initialTickets"]').fill('100');
  await page.locator('#actual-import').setInputFiles({name:'holy-angel-actuals-v2.json',
    mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});
  await page.locator('#actual-status').getByText('JSONを読み込みました',{exact:false}).waitFor();
  eq(await page.locator('[name="initialTickets"]').inputValue(),'9','JSON import restores starting ticket count');
  if(width===390)await page.screenshot({path:'holy-angel-actuals-390.png',fullPage:true});
  // Import prior-plan schema is deliberately refused. No current data loss.
  await page.locator('#actual-import').setInputFiles({name:'old-draft.json',
    mimeType:'application/json',buffer:Buffer.from('{"version":1,"plans":[]}')});
  await page.locator('#actual-error').getByText('JSONを復元できません',{exact:false}).waitFor();
  eq(await page.locator('#event-list .card').count(),6,'Invalid backup does not wipe history');
  eq(errors,[],'No browser JavaScript errors');
  await page.close();
}
console.log('PASS '+checks+' Chromium actual-record UI interactions at four widths');
}finally{await browser.close();await new Promise(done=>server.close(done));}
