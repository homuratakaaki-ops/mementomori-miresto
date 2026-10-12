import {COMBINED_WORKSPACE_KEY,createCombinedWorkspace,parseCombinedWorkspace,
 serializeCombinedWorkspace,inspectCombinedWorkspace,chooseCombinedSource,
 moveCombinedPlan,setCombinedStartAt,appendCombinedActualEvent,
 undoLastCombinedEvent} from './holy-angel-combined-workspace.mjs';
import {PLAN_V1_KEY,ACTUAL_V2_KEY,normalizeLegacyPlans,
 validateActualBundle} from './holy-angel-plan-actual-bridge.mjs';

const el=id=>document.getElementById(id);
const root=el('combined-root');
const names={chalice:'天契の聖杯',medal:'蒼穹の銀勲',wing:'希求の神翼',fruit:'悠園の果実'};
const slots={arm:'手',feet:'足',accessory:'アクセサリー',head:'頭',body:'胴'};
let plans=null,actuals=null,workspace=null,dirty=false,baseSaved=null;
const now=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',
 year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
 hourCycle:'h23'}).format(new Date()).replace(' ','T');
function numeric(id,min=0,max=1000000){
 const s=el(id).value;
 if(!/^\d+$/.test(s))throw new Error('数値を確認してください：'+id);
 const n=Number(s);
 if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('入力できる数の範囲を超えています：'+id);
 return n;
}
function showError(e){el('bridge-error').hidden=false;el('bridge-error').textContent='確認してください：'+(e.message||String(e));}
function clearError(){el('bridge-error').hidden=true;el('bridge-error').textContent='';}
function status(text){el('save-status').textContent=text;}
function refreshLegacy(){
 el('load-status').textContent='育成計画：'+(plans?'読込済み':'未読込')+
   ' ／ 実績：'+(actuals?'読込済み':'未読込');
}
function parseLimited(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>64000)throw new Error('データファイルは64KB以内です');
 return JSON.parse(raw);
}
function legacy(kind,raw){
 const obj=parseLimited(raw);
 if(kind==='plan'){normalizeLegacyPlans(obj);plans=obj;}
 else{validateActualBundle(obj);actuals=obj;}
 refreshLegacy();clearError();status('以前のデータを読み込みました。まだ新しいまとめデータは変更していません。');
}
function mark(next,msg){
 serializeCombinedWorkspace(next);
 workspace=next;dirty=true;refresh();clearError();status(msg+'。この端末にはまだ保存していません。');
}
function update(fn,msg){
 if(!workspace)throw new Error('先にまとめデータを作るか読み込んでください');
 mark(fn(workspace),msg);
}
function confirmReplace(){
 return !dirty||confirm('保存していない変更があります。別データを読み込むと現在の変更は失われます。続けますか？');
}
function refresh(){
 const info=workspace?inspectCombinedWorkspace(workspace):null;
 el('revision').textContent=info?'このまとめデータの更新番号：'+info.revision:'まとめデータ未作成';
 el('inventory-source').value=info?.mode||'plans';
 el('plan-start').value=workspace?.planData.settings.startAt||'';
 const host=el('editable-plans');host.replaceChildren();
 if(workspace)for(const [index,p] of workspace.planData.plans.entries()){
  const row=document.createElement('div');row.className='relic-line';
  const title=document.createElement('span');title.textContent=(index+1)+'番 '+(p.name||p.equipmentId)+'（'+(slots[p.slot]||p.slot)+'）';
  const buttons=document.createElement('span');
  for(const [distance,label] of [[-1,'↑'],[1,'↓']]){
   const btn=document.createElement('button');btn.type='button';btn.textContent=label;
   btn.dataset.index=String(index);btn.dataset.move=String(index+distance);
   btn.disabled=index+distance<0||index+distance>=workspace.planData.plans.length;
   btn.style.minHeight='37px';btn.style.marginLeft='5px';buttons.append(btn);
  }
  row.append(title,buttons);host.append(row);
 }
 const ready=info?.forecast;
 if(!ready){
  el('bridge-results').hidden=true;
  el('warning').textContent=info?.blockedReason||'先にまとめデータを作成してください。';
 }else{
  const forecast=ready.forecast;
  el('used-source').textContent=info.mode==='actuals'?'確認済みの実績':'計画の入力値';
  el('exchanges').textContent=ready.combined.perItem.reduce((n,p)=>n+p.exchanges,0)+'回';
  el('probability').textContent=(forecast.probabilityFinished*100).toFixed(1)+'%';
  el('diamonds').textContent=forecast.expectedDiamondsToComplete===null?'期間内の総額は未確定':
   Math.round(forecast.expectedDiamondsToComplete).toLocaleString('ja-JP')+'ダイヤ';
  const short=el('shortages');short.replaceChildren();
  for(const [i,key] of ['chalice','medal','wing','fruit'].entries()){
    const div=document.createElement('div');div.className='relic-line';
    const left=document.createElement('span');left.className='relic-label';
    const icon=document.createElement('span');icon.className='relic-icon';icon.setAttribute('aria-hidden','true');
    icon.style.backgroundPositionX=(-36*i)+'px';
    left.append(icon,document.createTextNode(names[key]));
    const count=document.createElement('strong');count.textContent=ready.shortages[key]+'個';
    div.append(left,count);short.append(div);
  }
  const tbody=el('plan-rows');tbody.replaceChildren();
  for(const item of ready.combined.perItem){
   const tr=document.createElement('tr');
   const name=workspace.planData.plans.find(p=>p.equipmentId===item.equipmentId)?.name||item.equipmentId;
   for(const value of [name,slots[item.slot],item.exchanges+'回',item.remainingParts+'個']){
    const td=document.createElement('td');td.textContent=value;tr.append(td);
   }
   tbody.append(tr);
  }
  el('warning').textContent=ready.warning+' 計算結果を見ただけでは実在庫と元の保存内容は変更されません。';
  el('bridge-results').hidden=false;
 }
 const events=workspace?.actualData?.events??[];
 el('history').textContent=events.length+'件の実績を新しいまとめデータに記録中。'+
   (info?.actual?' 実際の聖遺物：'+Object.entries(info.actual.relics).map(([key,n])=>names[key]+n+'個').join('、'):'');
}
function currentEvent(){
 const type=el('event-kind').value;
 const e={id:crypto.randomUUID(),at:el('event-at').value,type};
 if(type==='draw')Object.assign(e,{count:numeric('draw-count',1,50),
  ticketsUsed:numeric('draw-tickets',0,50),free:el('draw-free').value==='true'});
 else if(type==='claim')Object.assign(e,{milestone:numeric('claim-at',10,50),
  won:numeric('claim-at')===50||el('claim-won').value==='true'});
 else if(type==='switch')Object.assign(e,{to:el('switch-to').value,
  method:el('switch-method').value,abandonPending:el('switch-abandon').value==='true'});
 else if(type==='exchange')Object.assign(e,{slot:el('exchange-slot').value,count:numeric('exchange-times',1,100)});
 else if(type==='weekly-reset')Object.assign(e,{selected:el('reset-relic').value});
 else throw new Error('操作の種類が正しくありません');
 return e;
}
function updateFields(){
 const type=el('event-kind').value;
 for(const field of root.querySelectorAll('[data-event]'))field.hidden=field.dataset.event!==type;
}

root.addEventListener('click',event=>{
 const button=event.target.closest('button');
 if(!button||!root.contains(button))return;
 try{
  clearError();
  if(button.dataset.move!==undefined){
   update(doc=>moveCombinedPlan(doc,Number(button.dataset.index),Number(button.dataset.move)),
    '育成の優先順を変更しました');
   return;
  }
  const action=button.dataset.action;
  if(action==='load-plans'||action==='load-actuals'){
   const type=action==='load-plans'?'plan':'actual';
   const key=type==='plan'?PLAN_V1_KEY:ACTUAL_V2_KEY;
   const raw=localStorage.getItem(key);
   if(!raw)throw new Error('この端末には以前の'+(type==='plan'?'育成計画':'ガチャ実績')+'が保存されていません');
   legacy(type,raw);
  }else if(action==='create-v3'){
   if(!plans)throw new Error('先に育成計画を読み込んでください');
   if(!confirmReplace())return;
   mark(createCombinedWorkspace({planV1:plans,actualV2:actuals}),
    '旧データを残したまま新しいまとめデータを作成しました');
   el('event-at').value=actuals?.snapshot.at||now();
  }else if(action==='calculate'){
   if(!workspace)throw new Error('先に新しいまとめデータを作ってください');
   const result=inspectCombinedWorkspace(workspace);
   refresh();
   if(result.blockedReason)throw new Error(result.blockedReason);
   status('入力した条件で再計算しました。元データは変更していません。');
  }else if(action==='record'){
   update(doc=>appendCombinedActualEvent(doc,currentEvent()),'実際のガチャ操作を追加しました');
  }else if(action==='undo'){
   if(!confirm('最後に記録した操作1件を取り消しますか？'))return;
   update(undoLastCombinedEvent,'最後の実績を取り消しました');
  }else if(action==='save-v3'){
   if(!workspace)throw new Error('まだまとめデータはありません');
   const next=serializeCombinedWorkspace(workspace);
   const currentStored=localStorage.getItem(COMBINED_WORKSPACE_KEY);
   if(currentStored!==baseSaved)throw new Error('この端末の保存内容が別の操作で変わっています。データファイルを保存してから、最新版を読み込んでください');
   localStorage.setItem(COMBINED_WORKSPACE_KEY,next);
   baseSaved=next;dirty=false;status('この端末にまとめて保存しました。旧データとクラウドは変更していません。');
  }else if(action==='load-v3'){
   if(!confirmReplace())return;
   const raw=localStorage.getItem(COMBINED_WORKSPACE_KEY);
   if(!raw)throw new Error('この端末にまとめデータの保存がありません');
   const next=parseCombinedWorkspace(raw);
   workspace=next;baseSaved=raw;dirty=false;refresh();
   status('この端末の保存済みデータを読み込みました。');
  }else if(action==='export-v3'){
   if(!workspace)throw new Error('まだまとめデータがありません');
   const raw=serializeCombinedWorkspace(workspace);
   const href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
   const a=document.createElement('a');a.href=href;a.download='holy-angel-combined-v3.json';a.click();
   setTimeout(()=>URL.revokeObjectURL(href),1000);
   status('データファイルの保存を開始しました。端末内の下書き保存とは別です。');
  }
 }catch(e){showError(e);}
});
for(const [id,type] of [['plan-file','plan'],['actual-file','actual']]){
 el(id).addEventListener('change',async event=>{
  const f=event.target.files?.[0];if(!f)return;
  try{
   if(f.size>64000)throw new Error('データファイルが大きすぎます');
   legacy(type,await f.text());
  }catch(e){showError(e);}
  finally{event.target.value='';}
 });
}
el('combined-file').addEventListener('change',async event=>{
 const file=event.target.files?.[0];if(!file)return;
 try{
  if(!confirmReplace())return;
  if(file.size>64000)throw new Error('データファイルが大きすぎます');
  const raw=await file.text();
  const next=parseCombinedWorkspace(raw);
  workspace=next;dirty=true;refresh();clearError();
  status('ファイルからまとめデータを読み込みました。この端末への保存はまだです。');
 }catch(e){showError(e);}
 finally{event.target.value='';}
});
el('inventory-source').addEventListener('change',()=>{
 if(!workspace)return;
 const chosen=el('inventory-source').value;
 try{update(doc=>chooseCombinedSource(doc,chosen),'所持素材の参照元を変更しました');}
 catch(e){el('inventory-source').value=workspace.inventoryMode;showError(e);}
});
el('plan-start').addEventListener('change',()=>{
 if(!workspace)return;
 const chosen=el('plan-start').value;
 try{update(doc=>setCombinedStartAt(doc,chosen),'計算の開始日時を変更しました');}
 catch(e){el('plan-start').value=workspace.planData.settings.startAt;showError(e);}
});
el('event-kind').addEventListener('change',updateFields);
el('event-at').value=now();
updateFields();refresh();refreshLegacy();
status('まだ保存されていません。');
