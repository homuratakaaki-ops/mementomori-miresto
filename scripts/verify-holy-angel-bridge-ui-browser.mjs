import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const server=createServer(async(req,res)=>{
 try{
 const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));
 if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
 const data=await readFile(file);
 res.writeHead(200,{'Content-Type':extname(file)==='.mjs'?'text/javascript':extname(file)==='.jpg'?'image/jpeg':'text/html'}).end(data);
 }catch{res.writeHead(404).end('Not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const link='http://127.0.0.1:'+server.address().port+'/holy-angel-linked-test.html';
const plans={version:1,plans:[
 {equipmentId:'arm1',name:'手をLv280',slot:'arm',current:'240',target:'280',steps:''},
 {equipmentId:'foot1',name:'足をLv250',slot:'feet',current:'240',target:'250',steps:''}],
 partsBySlot:{arm:0,feet:0,accessory:0,head:0,body:0},
 ownedRelics:{chalice:0,medal:0,wing:0,fruit:0},
 settings:{tickets:0,startAt:'2026-10-11T18:30',usedToday:false,strategy:'complete-cycle',roundsPerWeek:3,weeks:4,gauge:0,selected:'none',freeSwitches:1,abandon:false}};
const actual={schemaVersion:2,snapshot:{at:'2026-10-11T18:00',
 relics:{chalice:1,medal:0,wing:0,fruit:0},partsBySlot:{arm:20,feet:0,accessory:0,head:0,body:0},
 tickets:10,diamonds:50000,gauge:0,selected:'chalice',freeSwitches:1,usedFreeToday:true,claimedCheckpoints:[]},events:[]};
let n=0;
function eq(a,b){assert.deepEqual(a,b);n++;}
function ok(a){assert.ok(a);n++;}
try{
 for(const width of [360,390,412,768]){
  const page=await browser.newPage({viewport:{width,height:820}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(link,{waitUntil:'networkidle'});
  ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#plan-file').setInputFiles({name:'plan-data.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(plans))});
  await page.locator('#load-status').getByText('育成計画：読込済み',{exact:false}).waitFor();
  await page.locator('[data-action="calculate"]').click();
  await page.locator('#bridge-results').waitFor({state:'visible'});
  eq(await page.locator('#exchanges').textContent(),'3回');
  eq((await page.locator('#shortages strong').allTextContents()).slice(0,2),['3個','3個']);
  await page.locator('#actual-file').setInputFiles({name:'actual-data.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(actual))});
  await page.locator('#inventory-source').selectOption('actuals');
  await page.locator('[data-action="calculate"]').click();
  eq(await page.locator('#exchanges').textContent(),'2回');
  eq((await page.locator('#shortages strong').allTextContents()).slice(0,2),['1個','2個']);
  ok((await page.locator('#warning').textContent()).includes('差がある'));
  await page.locator('#plan-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"bad":true}')});
  await page.locator('#bridge-error').waitFor({state:'visible'});
  await page.locator('[data-action="calculate"]').click();
  eq(await page.locator('#exchanges').textContent(),'2回');
  await page.locator('#plan-start').fill('2026-10-11T12:00');
  await page.locator('[data-action="calculate"]').click();
  ok((await page.locator('#bridge-error').textContent()).includes('最後の実績より前'));
  await page.locator('#plan-start').fill('2026-10-12T04:00');
  await page.locator('[data-action="calculate"]').click();
  ok((await page.locator('#bridge-error').textContent()).includes('週更新が未記録'));
  await page.locator('#plan-start').fill('2026-10-11T18:30');
  const pending=structuredClone(actual);pending.snapshot.gauge=10;
  await page.locator('#actual-file').setInputFiles({name:'pending.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(pending))});
  await page.locator('[data-action="calculate"]').click();
  ok((await page.locator('#bridge-error').textContent()).includes('未受取'));
  await page.locator('#actual-file').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(actual))});
  await page.locator('[data-action="calculate"]').click();
  eq(await page.locator('#exchanges').textContent(),'2回');
  eq(errors,[]);
  if(width===390)await page.screenshot({path:'holy-angel-bridge-390.png',fullPage:true});
  await page.close();
 }
 console.log('PASS '+n+' linked plan/actual browser checks');
}finally{await browser.close();await new Promise(done=>server.close(done));}
