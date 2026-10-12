import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.jpg':'image/jpeg'};
const srv=createServer(async(req,res)=>{
 try{const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const f=resolve(root,'.'+pathname);
  if(!f.startsWith(root+sep)){res.writeHead(403).end();return;}
  const bytes=await readFile(f);res.writeHead(200,{'Content-Type':types[extname(f)]||'application/octet-stream'}).end(bytes);
 }catch{res.writeHead(404).end('Not Found');}
});
await new Promise(done=>srv.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const url='http://127.0.0.1:'+srv.address().port+'/holy-angel-combined-test.html';
const plans={version:1,plans:[
 {equipmentId:'armA',name:'手Lv280',slot:'arm',current:'240',target:'280',steps:''},
 {equipmentId:'feetA',name:'足Lv250',slot:'feet',current:'240',target:'250',steps:''}],
 partsBySlot:{arm:0,feet:0,accessory:0,head:0,body:0},
 ownedRelics:{chalice:0,medal:0,wing:0,fruit:0},
 settings:{tickets:0,startAt:'2026-10-11T18:30',usedToday:false,
 strategy:'complete-cycle',roundsPerWeek:3,weeks:4,gauge:0,selected:'none',
 freeSwitches:1,abandon:false}};
const actual={schemaVersion:2,snapshot:{at:'2026-10-11T18:00',
 relics:{chalice:1,medal:0,wing:0,fruit:0},
 partsBySlot:{arm:20,feet:0,accessory:0,head:0,body:0},
 tickets:9,diamonds:30000,gauge:0,selected:'chalice',
 freeSwitches:1,usedFreeToday:false,claimedCheckpoints:[]},events:[]};
let n=0;
const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);n++;};
const ok=(x,msg)=>{assert.ok(x,msg);n++;};
try{
 for(const width of [360,390,412,768]){
  const p=await browser.newPage({viewport:{width,height:850},acceptDownloads:true});
  const errors=[];p.on('pageerror',err=>errors.push(err.message));
  p.on('dialog',d=>d.accept());
  await p.goto(url,{waitUntil:'networkidle'});
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow '+width);
  await p.evaluate(([a,b])=>{
   localStorage.setItem('holy-angel-multi-plan-test-v1',a);
   localStorage.setItem('holy-angel-actuals-test-v2',b);
  },[JSON.stringify(plans),JSON.stringify(actual)]);
  await p.locator('[data-action="load-plans"]').click();
  await p.locator('[data-action="load-actuals"]').click();
  await p.locator('[data-action="create-v3"]').click();
  eq(await p.locator('#revision').textContent(),'このまとめデータの更新番号：0','New revision');
  eq(await p.locator('#exchanges').textContent(),'3回','Plan source E3');
  await p.locator('#inventory-source').selectOption('actuals');
  eq(await p.locator('#exchanges').textContent(),'2回','Actual source E2');
  eq((await p.locator('#shortages strong').allTextContents()).slice(0,2),['1個','2個'],'Confirmed inventory only');
  await p.locator('#editable-plans button').nth(1).click();
  ok((await p.locator('#editable-plans').textContent()).includes('1番 足Lv250'),'Reordered priority');
  await p.locator('#event-at').fill('2026-10-11T18:05');
  await p.locator('#draw-count').fill('10');
  await p.locator('#draw-tickets').fill('9');
  await p.locator('#draw-free').selectOption('true');
  await p.locator('[data-action="record"]').click();
  eq(await p.locator('#event-count').textContent(),'1件','Added actual draw');
  ok((await p.locator('#forecast-status').textContent()).includes('未受取'),'Pending reward blocks forecast');
  await p.locator('#event-kind').selectOption('claim');
  await p.locator('#event-at').fill('2026-10-11T18:06');
  await p.locator('#claim-at').selectOption('10');
  await p.locator('#claim-won').selectOption('true');
  await p.locator('[data-action="record"]').click();
  eq(await p.locator('#event-count').textContent(),'2件','Actual reward recorded');
  await p.locator('[data-action="undo"]').click();
  eq(await p.locator('#event-count').textContent(),'1件','Undo restored log');
  ok((await p.locator('#forecast-status').textContent()).includes('未受取'),'Undo restores pending');
  await p.locator('[data-action="save-v3"]').click();
  ok((await p.locator('#save-status').textContent()).includes('この端末にまとめて保存'),'Separate v3 local save');
  await p.reload({waitUntil:'networkidle'});
  await p.locator('[data-action="load-v3"]').click();
  eq(await p.locator('#event-count').textContent(),'1件','V3 survives reload');
  eq(await p.locator('#inventory-source').inputValue(),'actuals','Restored source');
  const filePromise=p.waitForEvent('download');
  await p.locator('[data-action="export-v3"]').click();
  const download=await filePromise;
  eq(download.suggestedFilename(),'holy-angel-combined-v3.json','Download label only uses simple Japanese UI');
  const exported=JSON.parse((await readFile(await download.path())).toString('utf8'));
  eq(exported.schemaVersion,3,'Version 3 file');
  eq(exported.actualData.events.length,1,'Export includes actual history');
  const original=await p.evaluate(()=>[
   localStorage.getItem('holy-angel-multi-plan-test-v1'),
   localStorage.getItem('holy-angel-actuals-test-v2')]);
  eq(original,[JSON.stringify(plans),JSON.stringify(actual)],'Old v1/v2 files untouched');
  await p.locator('#combined-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":2}')});
  await p.locator('#bridge-error').waitFor({state:'visible'});
  eq(await p.locator('#event-count').textContent(),'1件','Invalid import never wipes data');
  await p.locator('#combined-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await p.locator('#save-status').getByText('ファイルからまとめデータを読み込みました',{exact:false}).waitFor();
  eq(await p.locator('#event-count').textContent(),'1件','Valid file import');
  eq(errors,[],'No JS errors');
  if(width===390)await p.screenshot({path:'holy-angel-combined-390.png',fullPage:true});
  await p.close();
 }
 console.log('PASS '+n+' v3 combined workspace browser checks');
}finally{await browser.close();await new Promise(done=>srv.close(done));}
