import {replayHolyAngelActuals,ACTUAL_RELICS,ACTUAL_SLOTS} from './holy-angel-actual-log.mjs';
const root=document.querySelector('#actual-root'),error=root.querySelector('#actual-error'),
  history=document.querySelector('#event-list'),status=root.querySelector('#actual-status');
const id=x=>document.getElementById(x);
const SAVE_KEY='holy-angel-actuals-test-v2';
const MAX_BYTES=64000,MAX_EVENTS=300;
const NAMES={chalice:'天契の聖杯',medal:'蒼穹の銀勲',wing:'希求の神翼',fruit:'悠園の果実'};
const PART_NAMES={arm:'手',feet:'足',accessory:'アクセサリー',head:'頭',body:'胴'};
const actionNames={draw:'ガチャ',claim:'回数報酬受取',switch:'聖遺物変更',exchange:'パーツ交換','weekly-reset':'週更新'};
const nowJst=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
const el=name=>root.querySelector('[name="'+name+'"]');
const value=name=>el(name).value;
const checked=name=>el(name).checked;
const readNumber=(name,{min=0,max=1000000}={})=>{
  const v=value(name).trim();
  if(!/^\d+$/.test(v))throw new Error(name+'は0以上の整数で入力してください');
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(name+'の数を確認してください（'+min+'〜'+max+'）');
  return n;
};
const simpleText=(s,max)=>typeof s==='string'&&s.length<=max;
let recordedEvents=[];
let draftCounter=0;
function readSnapshot(){
  const coins=value('initialDiamonds').trim();
  const claimed=[];
  if(checked('claimed10'))claimed.push(10);
  if(checked('claimed25'))claimed.push(25);
  return {at:value('snapshotAt'),selected:value('initialSelected'),gauge:readNumber('initialGauge',{max:49}),
    tickets:readNumber('initialTickets'),diamonds:coins===''?undefined:readNumber('initialDiamonds',{max:1000000000}),
    freeSwitches:readNumber('initialSwitches',{max:1}),usedFreeToday:checked('initialUsedToday'),
    claimedCheckpoints:claimed,
    relics:Object.fromEntries(ACTUAL_RELICS.map(k=>[k,readNumber('relic-'+k)])),
    partsBySlot:Object.fromEntries(Object.keys(ACTUAL_SLOTS).map(k=>[k,readNumber('part-'+k)]))};
}
function fillSnapshot(s){
  el('snapshotAt').value=s.at;el('initialSelected').value=s.selected;
  el('initialGauge').value=s.gauge;el('initialSwitches').value=s.freeSwitches;
  el('initialTickets').value=s.tickets;el('initialDiamonds').value=s.diamonds??'';
  el('initialUsedToday').checked=s.usedFreeToday;
  el('claimed10').checked=s.claimedCheckpoints.includes(10);
  el('claimed25').checked=s.claimedCheckpoints.includes(25);
  for(const k of ACTUAL_RELICS)el('relic-'+k).value=s.relics[k];
  for(const k of Object.keys(ACTUAL_SLOTS))el('part-'+k).value=s.partsBySlot[k];
}
function readEvent(){
  const kind=value('eventType');
  const event={id:'event-'+crypto.randomUUID(),type:kind,at:value('eventAt')};
  if(kind==='draw')Object.assign(event,{count:readNumber('drawCount',{min:1,max:50}),
    ticketsUsed:readNumber('drawTickets',{max:50}),free:checked('drawFree')});
  else if(kind==='claim')Object.assign(event,{milestone:readNumber('claimMilestone',{min:10,max:50}),
    won:value('claimWon')==='true'});
  else if(kind==='switch')Object.assign(event,{to:value('switchTo'),method:value('switchMethod'),
    abandonPending:checked('abandonPending')});
  else if(kind==='exchange')Object.assign(event,{slot:value('exchangeSlot'),count:readNumber('exchangeCount',{min:1,max:100})});
  else if(kind==='weekly-reset')Object.assign(event,{selected:value('resetSelected')});
  else throw new Error('操作の種類が不明です');
  return event;
}
function preview(snapshot,events){return replayHolyAngelActuals({snapshot,events});}
function showError(message){error.textContent='記録できません：'+message;error.hidden=false;}
function clearError(){error.textContent='';error.hidden=true;}
function setStatus(text){status.textContent=text;}
function text(idName,value){id(idName).textContent=String(value);}
function showRows(actual){
  const slots=Object.keys(ACTUAL_SLOTS);
  const inventory=id('actual-inventory');inventory.replaceChildren();
  const title=document.createElement('h3');title.textContent='実際に所持する聖遺物';inventory.append(title);
  for(const relic of ACTUAL_RELICS){
    const line=document.createElement('div');line.className='relic-line';
    const left=document.createElement('span');left.className='relic-label';
    const img=document.createElement('span');img.className='relic-icon';img.setAttribute('aria-hidden','true');
    img.style.backgroundPositionX=(-36*ACTUAL_RELICS.indexOf(relic))+'px';
    left.append(img,document.createTextNode(NAMES[relic]));
    const quantity=document.createElement('strong');quantity.textContent=actual.relics[relic]+'個';
    line.append(left,quantity);inventory.append(line);
  }
  const h=document.createElement('h3');h.textContent='交換済みパーツ（未使用）';inventory.append(h);
  const p=document.createElement('p');p.className='small';p.textContent=slots.map(k=>PART_NAMES[k]+' '+actual.partsBySlot[k]+'個').join('／');
  inventory.append(p);
  text('actual-selected',NAMES[actual.selected]);
  text('actual-gauge',actual.gauge+'/50回');
  text('actual-tickets',actual.tickets+'枚');
  text('actual-diamonds',actual.diamondsSpent.toLocaleString('ja-JP')+'ダイヤ');
  const pending=actual.pendingClaims.map(k=>k+'回報酬').join('、');
  text('pending-note',pending?'未受取の可能性：'+pending+'。ゲームで受取を確認してから記録してください。':'記録上、現在受け取っていない節目報酬はありません。');
}
function showHistory(events){
  history.replaceChildren();
  if(!events.length){
    const p=document.createElement('p');p.className='small';p.textContent='まだ実績はありません。';history.append(p);return;
  }
  for(let i=0;i<events.length;i++){
    const event=events[i];
    const div=document.createElement('div');div.className='card';
    const row=document.createElement('div');row.className='row';
    const label=document.createElement('strong');label.textContent=(i+1)+'件目 '+actionNames[event.type];
    const date=document.createElement('span');date.className='minor';date.textContent=event.at+' JST';
    row.append(label,date);div.append(row);
    const note=document.createElement('div');note.className='minor';
    if(event.type==='draw')note.textContent=event.count+'回（無料'+Number(event.free)+'・チケット'+event.ticketsUsed+'）';
    else if(event.type==='claim')note.textContent=event.milestone+'回報酬：'+(event.won?'当選':'非当選');
    else if(event.type==='switch')note.textContent=NAMES[event.to]+'へ変更（'+(event.method==='free'?'無料':'300ダイヤ')+'）';
    else if(event.type==='exchange')note.textContent=PART_NAMES[event.slot]+' '+event.count+'回（50パーツ単位）';
    else note.textContent=NAMES[event.selected]+'で新しい週を開始';
    div.append(note);history.append(div);
  }
}
function render(){
  const result=preview(readSnapshot(),recordedEvents);
  showRows(result);showHistory(recordedEvents);id('undo-last').disabled=recordedEvents.length===0;
  return result;
}
function getDraft(){
  const data={schemaVersion:2,snapshot:readSnapshot(),events:recordedEvents.map(e=>({...e}))};
  preview(data.snapshot,data.events);
  const json=JSON.stringify(data);
  if(json.length>MAX_BYTES)throw new Error('保存データが大きすぎます。実績を整理してください（上限64KB）。');
  return json;
}
function validateRestored(json){
  if(typeof json!=='string'||json.length>MAX_BYTES)throw new Error('読み込めるデータファイルは64KB以内です');
  const o=JSON.parse(json);
  if(!o||typeof o!=='object'||Array.isArray(o)||o.schemaVersion!==2 ||
    !o.snapshot||!Array.isArray(o.events)||o.events.length>MAX_EVENTS)throw new Error('この実績データの形式には対応していません（schemaVersion 2専用）');
  if(o.events.some(e=>!e||typeof e!=='object'||!simpleText(e.id,80)||!simpleText(e.at,16)))
    throw new Error('実績のIDと日時が不正です');
  // Replay the imported data BEFORE changing any currently visible data.
  preview(o.snapshot,o.events);
  return {snapshot:o.snapshot,events:o.events};
}
function restore(json,source){
  const newDraft=validateRestored(json);
  const backup={snapshot:readSnapshot(),events:recordedEvents};
  try{
    fillSnapshot(newDraft.snapshot);recordedEvents=newDraft.events.map(e=>({...e}));
    render();clearError();setStatus(source+'。クラウドには保存していません。');
  }catch(e){
    fillSnapshot(backup.snapshot);recordedEvents=backup.events;render();throw e;
  }
}
function updateFields(){
  const kind=value('eventType');
  for(const field of root.querySelectorAll('[data-show]'))field.hidden=!field.dataset.show.split(' ').includes(kind);
}
root.addEventListener('change',event=>{
  if(event.target.name==='eventType')updateFields();
  if(event.target.id!=='actual-import'){
    setStatus('変更あり。保存ボタンを押すまでこの端末には保存されません。');
  }
});
root.addEventListener('input',event=>{
  if(event.target.id!=='actual-import')setStatus('変更あり。端末内保存はまだです。');
});
root.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');
  if(!button||!root.contains(button))return;
  const action=button.dataset.action;clearError();
  try{
    if(action==='record'){
      if(recordedEvents.length>=MAX_EVENTS)throw new Error('実績は最大300件です');
      const e=readEvent();
      const next=[...recordedEvents,e];
      preview(readSnapshot(),next); // Atomic validation BEFORE changing history.
      recordedEvents=next;render();setStatus('実績を仮登録しました。この端末へはまだ保存していません。');
    }
    if(action==='undo'){
      if(!recordedEvents.length)throw new Error('取り消せる実績はありません');
      const ok=confirm('最後の1件を取り消します。あとから追加した実績はありませんか？');
      if(!ok)return;
      const next=recordedEvents.slice(0,-1);preview(readSnapshot(),next);
      recordedEvents=next;render();setStatus('最後の1件を取り消しました。保存すると反映されます。');
    }
    if(action==='save'){
      const json=getDraft();
      localStorage.setItem(SAVE_KEY,json);
      render();setStatus('この端末だけに保存しました。スマホ・PC間では同期されません。');
    }
    if(action==='load'){
      const json=localStorage.getItem(SAVE_KEY);
      if(!json)throw new Error('この端末に保存済みの実績はありません');
      restore(json,'この端末の実績を読み込みました');
    }
    if(action==='export'){
      const data=new Blob([getDraft()],{type:'application/json'});
      const url=URL.createObjectURL(data),anchor=document.createElement('a');
      anchor.href=url;anchor.download='holy-angel-actuals-v2.json';
      anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setStatus('データファイルの保存を開始しました。この端末への下書き保存は別に行ってください。');
    }
  }catch(e){showError(e.message||String(e));}
});
id('actual-import').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>MAX_BYTES)throw new Error('データファイルが大きすぎます（上限64KB）。');
    restore(await file.text(),'ファイルからデータを読み込みました');
  }catch(e){showError('データファイルを読み込めません：'+(e.message||String(e)));}
  finally{event.target.value='';}
});
el('snapshotAt').value=nowJst();
el('eventAt').value=el('snapshotAt').value;
updateFields();
try{render()}catch(e){showError(e.message||String(e))}
setStatus('開発用の実績記録テスト。まだ端末内保存もクラウド同期もしていません。');
