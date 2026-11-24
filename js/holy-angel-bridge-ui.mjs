import {
 PLAN_V1_KEY,ACTUAL_V2_KEY,normalizeLegacyPlans,validateActualBundle,bridgePlansAndActuals
} from './holy-angel-plan-actual-bridge.mjs';
import {RELIC_KEYS} from './holy-angel-planner-core.mjs';

const names={chalice:'天契の聖杯',medal:'蒼穹の銀勲',wing:'希求の神翼',fruit:'悠園の果実'};
const slots={arm:'手',feet:'足',accessory:'アクセサリー',head:'頭',body:'胴'};
const root=document.getElementById('bridge-root'),id=x=>document.getElementById(x);
let plan=null,actual=null;
const limit=64000;
function format(n){return Math.round(n).toLocaleString('ja-JP');}
function message(text){const el=id('bridge-error');el.textContent='確認してください：'+text;el.hidden=false;}
function clearError(){id('bridge-error').hidden=true;id('bridge-error').textContent='';}
function status(){
 id('load-status').textContent='育成計画：'+(plan?'読込済み（'+plan.plans.length+'件）':'未読込')+
   ' ／ 実績：'+(actual?'読込済み（'+actual.events.length+'件の記録）':'未読込');
}
function cleanText(raw){
 if(typeof raw!=='string'||raw.length>limit)throw new Error('データファイルが大きすぎるか読み込めません（64KB以内）');
 return JSON.parse(raw);
}
function acceptPlan(raw){
 const decoded=cleanText(raw);
 const normalized=normalizeLegacyPlans(decoded);
 // Keep original version and data untouched. We do not migrate or save it.
 plan=decoded;
 id('plan-start').value=normalized.settings.startAt;
 id('bridge-results').hidden=true;clearError();status();
}
function acceptActual(raw){
 const decoded=cleanText(raw);
 validateActualBundle(decoded);
 actual=decoded;
 id('bridge-results').hidden=true;clearError();status();
}
async function fromFile(file,which){
 if(!file)return;
 if(file.size>limit)throw new Error('64KBを超えるデータファイルは読み込めません');
 const raw=await file.text();
 if(which==='plans')acceptPlan(raw);else acceptActual(raw);
}
function local(which){
 const key=which==='plans'?PLAN_V1_KEY:ACTUAL_V2_KEY;
 const raw=localStorage.getItem(key);
 if(!raw)throw new Error(which==='plans'?'この端末に育成計画の保存がありません':'この端末に実績記録の保存がありません');
 if(which==='plans')acceptPlan(raw);else acceptActual(raw);
}
function showRelics(need){
 const host=id('shortages');host.replaceChildren();
 for(const [index,key] of RELIC_KEYS.entries()){
   const row=document.createElement('div');row.className='relic-line';
   const left=document.createElement('span');left.className='relic-label';
   const icon=document.createElement('span');icon.className='relic-icon';icon.setAttribute('aria-hidden','true');
   icon.style.backgroundPositionX=(-36*index)+'px';
   left.append(icon,document.createTextNode(names[key]));
   const total=document.createElement('strong');total.textContent=format(need[key])+'個';
   row.append(left,total);host.append(row);
 }
}
function calculate(){
 if(!plan)throw new Error('先に育成計画を読み込んでください');
 const source=id('inventory-source').value;
 if(source==='actuals'&&!actual)throw new Error('実績記録を読み込んでから選んでください');
 const copy={...plan,settings:{...plan.settings,startAt:id('plan-start').value}};
 const beforePlan=JSON.stringify(plan),beforeActual=actual===null?null:JSON.stringify(actual);
 const result=bridgePlansAndActuals({planV1:copy,actualV2:actual,inventorySource:source});
 if(beforePlan!==JSON.stringify(plan)||beforeActual!== (actual===null?null:JSON.stringify(actual)))
   throw new Error('元のデータが変更されました。試算を中止してください');
 id('used-source').textContent=result.usedRealInventory?'確認済みの実績':'計画に入力した所持数';
 id('exchanges').textContent=format(result.combined.perItem.reduce((sum,p)=>sum+p.exchanges,0))+'回';
 id('probability').textContent=(result.forecast.probabilityFinished*100).toFixed(1)+'%';
 id('diamonds').textContent=result.forecast.expectedDiamondsToComplete===null?'期間内の総額は未確定':
   format(result.forecast.expectedDiamondsToComplete)+'ダイヤ';
 showRelics(result.shortages);
 const tbody=id('plan-rows');tbody.replaceChildren();
 for(const [index,item] of result.combined.perItem.entries()){
   const row=document.createElement('tr');
   const planName=result.planNames.find((_,i)=>result.priority[index]===copy.plans[i]?.equipmentId)??item.equipmentId;
   for(const value of [planName,slots[item.slot],item.exchanges+'回',item.remainingParts+'個']){
     const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);
   }
   tbody.append(row);
 }
 id('warning').textContent=result.warning+
   (result.differsFromPlanEntry?' 計画の古い所持数と実績に差があるため、実績側の所持数だけを採用しています。':'')+
   (result.forecast.expectedDiamondsToComplete===null?
      ' 表示期間内に揃わない場合があります。期間中の平均支出は'+format(result.forecast.expectedDiamondsSpent)+'ダイヤです。':'')+
   ' 結果を見ても、元の計画と実績は変更されません。';
 id('bridge-results').hidden=false;
 id('bridge-results').scrollIntoView({block:'start',behavior:'smooth'});
}
root.addEventListener('click',event=>{
 const btn=event.target.closest('button[data-action]');
 if(!btn||!root.contains(btn))return;
 try{
  clearError();
  if(btn.dataset.action==='load-plans')local('plans');
  if(btn.dataset.action==='load-actuals')local('actuals');
  if(btn.dataset.action==='calculate')calculate();
 }catch(e){id('bridge-results').hidden=true;message(e.message||String(e));}
});
for(const [elId,which] of [['plan-file','plans'],['actual-file','actuals']]){
 id(elId).addEventListener('change',async event=>{
  try{await fromFile(event.target.files?.[0],which);}
  catch(e){id('bridge-results').hidden=true;message('データを読み込めません：'+(e.message||String(e)));}
  finally{event.target.value='';}
 });
}
id('inventory-source').addEventListener('change',()=>{id('bridge-results').hidden=true;clearError();});
id('plan-start').addEventListener('input',()=>{id('bridge-results').hidden=true;});
status();
