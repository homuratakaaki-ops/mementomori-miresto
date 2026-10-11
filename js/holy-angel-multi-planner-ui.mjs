import {planPrioritizedSharedEquipment,planEquipmentParts,PART_SLOTS,RELIC_KEYS} from './holy-angel-planner-core.mjs';
import {forecastMultiRelicWithStopping} from './holy-angel-multi-stop.mjs';
import {getForecastFreeSchedule} from './holy-angel-calendar.mjs';

const SLOT_NAMES={arm:'手',feet:'足',accessory:'アクセサリー',head:'頭',body:'胴'};
const RELIC_NAMES={chalice:'天契の聖杯',medal:'蒼穹の銀勲',wing:'希求の神翼',fruit:'悠園の果実'};
const STORAGE_KEY='holy-angel-multi-plan-test-v1';
const SLOT_IDS=Object.keys(SLOT_NAMES);
const MAX_PLANS=8;
const root=document.getElementById('multi-root');
const planHost=document.getElementById('plan-list');
const template=document.getElementById('plan-template');
const errorEl=document.getElementById('multi-error');
const results=document.getElementById('multi-results');
const statusEl=document.getElementById('save-state');
const byId=id=>document.getElementById(id);
const numFmt=n=>Number.isFinite(n)?Math.round(n).toLocaleString('ja-JP'):'計算不可';
const dateNow=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
let sequence=0;
const newPlan=()=>({equipmentId:'equipment-'+(++sequence),name:'装備'+sequence,slot:'arm',current:'240',target:'300',steps:''});
const blankDraft=()=>({
  version:1,plans:[{equipmentId:'equipment-1',name:'腕をLv300',slot:'arm',current:'240',target:'300',steps:''},
                 {equipmentId:'equipment-2',name:'足をLv280',slot:'feet',current:'240',target:'280',steps:''}],
  partsBySlot:Object.fromEntries(SLOT_IDS.map(k=>[k,0])),
  ownedRelics:Object.fromEntries(RELIC_KEYS.map(k=>[k,0])),
  settings:{tickets:0,startAt:dateNow(),usedToday:false,strategy:'stop-on-target',
    roundsPerWeek:2,weeks:4,gauge:0,selected:'none',freeSwitches:1,abandon:false}
});
let draft=blankDraft();
sequence=2;

function setStatus(message){statusEl.textContent=message;}
function fail(message){errorEl.textContent='確認してください：'+message;errorEl.hidden=false;}
function clearError(){errorEl.hidden=true;errorEl.textContent='';}
function number(value,label,{min=0,max=1_000_000}={}){
  const s=String(value).trim();
  if(s===''||!/^\d+$/.test(s))throw new Error(label+'は0以上の整数で入力してください');
  const n=Number(s);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(label+'は'+min+'～'+max+'で入力してください');
  return n;
}
function stepsToObject(text){
  const map={};
  for(const line of String(text||'').split(/[,\n]/)){
    const t=line.trim();if(!t)continue;
    const m=/^(\d+)\s*[:=]\s*(\d+)$/.exec(t);
    if(!m)throw new Error('追加パーツは「540=40」の形で入力してください');
    const lv=Number(m[1]),qty=Number(m[2]);
    if(lv<540||lv>5000||lv%10!==0||!Number.isSafeInteger(qty))throw new Error('Lv540以上は10Lv刻みの追加パーツ数を入力してください');
    if(Object.hasOwn(map,lv))throw new Error('同じ追加レベルが複数あります：Lv'+lv);
    map[lv]=qty;
  }
  return map;
}
function selectedOptions(select,values){
  select.replaceChildren();
  for(const [value,label] of Object.entries(values)){
    const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
  }
}
function updateCards(){
  planHost.replaceChildren();
  draft.plans.forEach((plan,index)=>{
    const node=template.content.firstElementChild.cloneNode(true);
    node.dataset.index=String(index);
    node.querySelector('.priority-no').textContent=String(index+1);
    const fields=node.querySelectorAll('[data-field]');
    for(const el of fields){
      if(el.dataset.field==='slot')selectedOptions(el,SLOT_NAMES);
      el.value=plan[el.dataset.field];
    }
    const last=draft.plans.length===1;
    node.querySelector('[data-move="up"]').disabled=index===0;
    node.querySelector('[data-move="down"]').disabled=index===draft.plans.length-1;
    node.querySelector('[data-move="remove"]').disabled=last;
    planHost.append(node);
  });
  byId('plan-count').textContent=draft.plans.length+'件';
}
function fillGlobals(){
  for(const slot of SLOT_IDS)root.querySelector('[name="parts-'+slot+'"]').value=draft.partsBySlot[slot];
  for(const relic of RELIC_KEYS)root.querySelector('[name="owned-'+relic+'"]').value=draft.ownedRelics[relic];
  for(const [key,value] of Object.entries(draft.settings)){
    const el=root.querySelector('[name="'+key+'"]');
    if(!el)continue;
    if(el.type==='checkbox')el.checked=value;else el.value=String(value);
  }
  updateCards();
}
function syncFromScreen(){
  for(const slot of SLOT_IDS)draft.partsBySlot[slot]=root.querySelector('[name="parts-'+slot+'"]').value;
  for(const relic of RELIC_KEYS)draft.ownedRelics[relic]=root.querySelector('[name="owned-'+relic+'"]').value;
  for(const key of Object.keys(draft.settings)){
    const el=root.querySelector('[name="'+key+'"]');
    if(!el)continue;
    draft.settings[key]=el.type==='checkbox'?el.checked:el.value;
  }
  draft.plans=Array.from(planHost.children).map((card,index)=>{
    const previous=draft.plans[index],plan={...previous};
    for(const field of card.querySelectorAll('[data-field]'))plan[field.dataset.field]=field.value;
    return plan;
  });
}
function getCalculationInput(){
  const p=draft.plans.map((plan,index)=>{
    const title=(plan.name||'装備'+(index+1)).trim();
    const current=String(plan.current).trim();
    const level=current===''?null:number(current,title+'の現在Lv',{min:240,max:5000});
    const target=number(plan.target,title+'の目標Lv',{min:240,max:5000});
    if((level!==null && level%10!==0)||target%10!==0)throw new Error(title+'のレベルは10刻みです');
    return {equipmentId:String(plan.equipmentId).trim(),slot:plan.slot,
      currentLevel:level,targetLevel:target,customStepParts:stepsToObject(plan.steps)};
  });
  const partsBySlot=Object.fromEntries(SLOT_IDS.map(k=>[k,number(draft.partsBySlot[k],SLOT_NAMES[k]+'の未使用パーツ')]));
  const ownedRelics=Object.fromEntries(RELIC_KEYS.map(k=>[k,number(draft.ownedRelics[k],RELIC_NAMES[k]+'の所持数')]));
  const settings=draft.settings;
  const free=getForecastFreeSchedule(settings.startAt,{freeUsedThisGameDay:settings.usedToday});
  const gauge=number(settings.gauge,'回数ゲージ',{max:49});
  const freeSwitches=number(settings.freeSwitches,'無料切替権利',{max:1});
  return {plans:p,partsBySlot,ownedRelics,free,settings:{
    tickets:number(settings.tickets,'チケット枚数'),strategy:settings.strategy,
    roundsPerWeek:number(settings.roundsPerWeek,'週の挑戦枠',{min:1,max:3}),
    weeks:number(settings.weeks,'予測する週数',{min:1,max:12}),startGauge:gauge,
    startSelected:settings.selected==='none'?null:settings.selected,
    abandonPartialGauge:settings.abandon,freeSwitchesRemaining:freeSwitches,
    firstWeekFreeDraws:free.firstWeekFreeDraws,laterWeekFreeDraws:7}};
}
function cell(row,text,tag='td'){const el=document.createElement(tag);el.textContent=String(text);row.append(el);}
function appendRows(host,rows){
  host.replaceChildren();
  for(const values of rows){const tr=document.createElement('tr');for(const value of values)cell(tr,value);host.append(tr);}
}
function iconNode(relic){
  const span=document.createElement('span');span.className='relic-icon';
  span.setAttribute('aria-hidden','true');
  span.style.backgroundPositionX=(-36*RELIC_KEYS.indexOf(relic))+'px';
  return span;
}
function showRelics(host,shortages){
  host.replaceChildren();
  for(const relic of RELIC_KEYS){
    const line=document.createElement('div');line.className='relic-line';
    const left=document.createElement('span');left.className='relic-label';left.append(iconNode(relic),document.createTextNode(RELIC_NAMES[relic]));
    const right=document.createElement('strong');right.textContent=numFmt(shortages[relic])+'個';
    line.append(left,right);host.append(line);
  }
}
function calculate(){
  syncFromScreen();clearError();results.hidden=true;
  try{
    const {plans,partsBySlot,ownedRelics,free,settings}=getCalculationInput();
    const combined=planPrioritizedSharedEquipment({plans,partsBySlot,ownedRelics});
    // Aim for relics needed by higher-priority equipment first.
    // Keep all four IDs in the order even if some have no remaining deficit.
    const relicOrder=[...new Set([
      ...combined.perItem.flatMap(item=>RELIC_KEYS.filter(key=>item.relics[key]>0)),
      ...RELIC_KEYS
    ])];
    const forecast=forecastMultiRelicWithStopping({needs:combined.shortages,order:relicOrder,...settings});
    byId('overall-exchanges').textContent=numFmt(combined.perItem.reduce((n,p)=>n+p.exchanges,0))+'回';
    byId('overall-diamonds').textContent=forecast.expectedDiamondsToComplete===null?'期間内の総額は未確定':numFmt(forecast.expectedDiamondsToComplete)+'ダイヤ';
    byId('overall-probability').textContent=(forecast.probabilityFinished*100).toFixed(1)+'%';
    byId('overall-free').textContent=String(free.firstWeekFreeDraws)+'回';
    byId('overall-note').textContent=
      '聖遺物の取得予測（装備進化の完成保証ではありません）。'+
      (forecast.completedGuarantee?
       '平均到達は'+forecast.expectedCompletionWeek.toFixed(2)+'週目。':
       '期間内に揃わない経路があります。期間内に使う平均ダイヤは'+numFmt(forecast.expectedDiamondsSpent)+'。')+
      '狙う聖遺物の順番：'+(relicOrder.filter(k=>combined.shortages[k]>0).map(k=>RELIC_NAMES[k]).join(' → ')||'追加不要')+'。10回と25回の抽選は独立と仮定。無料分は週末までに使える前提です。';
    showRelics(byId('shortages'),combined.shortages);
    const rows=combined.perItem.map((p,i)=>[
      (i+1)+'番 '+(draft.plans.find(x=>x.equipmentId===p.equipmentId)?.name||p.equipmentId),
      SLOT_NAMES[p.slot], 'Lv'+(p.currentLevel===null?'未所持':p.currentLevel)+'→'+p.targetLevel,
      p.exchanges+'回',p.remainingParts+'個'
    ]);
    appendRows(byId('combined-details'),rows);
    const singles=plans.map((p,i)=>{
      const individual=planEquipmentParts({...p,ownedParts:partsBySlot[p.slot]});
      return [draft.plans[i].name||p.equipmentId,SLOT_NAMES[p.slot],individual.exchanges+'回',
        '単独の場合のみ（共有パーツを仮に全部利用）'];
    });
    appendRows(byId('individual-details'),singles);
    appendRows(byId('multi-weekly'),forecast.exactWeek.map(r=>[
      r.week===0?'現在':r.week+'週目',(r.probability*100).toFixed(1)+'%',(r.cumulativeProbability*100).toFixed(1)+'%'
    ]));
    byId('actual-parts-note').textContent='開始時の未使用パーツを計算上だけ割り当てています。ゲーム内の実在庫は変更していません。'+
      '計算後の未使用パーツ（手／足／アクセサリー／頭／胴）：'+SLOT_IDS.map(k=>SLOT_NAMES[k]+combined.remainingPartsBySlot[k]+'個').join('・');
    results.hidden=false;
    results.scrollIntoView({block:'start',behavior:'smooth'});
    setStatus('計算済み。クラウドへは保存していません。');
  }catch(error){fail(error.message||String(error));}
}
function validateImported(input){
  if(!input||typeof input!=='object'||input.version!==1||!Array.isArray(input.plans)
      ||!input.partsBySlot||!input.ownedRelics||!input.settings)throw new Error('対応していない計画データです');
  if(input.plans.length<1||input.plans.length>MAX_PLANS)throw new Error('計画数は1～'+MAX_PLANS+'件です');
  const plans=input.plans.map((p,i)=>{
    if(!p||typeof p!=='object')throw new Error('計画の形式が不正です');
    const equipId=String(p.equipmentId||'').trim(),slot=String(p.slot||'');
    if(!equipId||equipId.length>80||!SLOT_IDS.includes(slot))throw new Error('装備ID・部位が不正です');
    const name=String(p.name||'装備'+(i+1));
    if(name.length>80)throw new Error('計画名が長すぎます');
    if(String(p.steps||'').length>1500)throw new Error('追加パーツ入力が長すぎます');
    return {equipmentId:equipId,name,slot,current:String(p.current??''),target:String(p.target??'300'),steps:String(p.steps||'')};
  });
  const partsBySlot=Object.fromEntries(SLOT_IDS.map(k=>[k,number(input.partsBySlot[k],SLOT_NAMES[k]+'のパーツ')]));
  const ownedRelics=Object.fromEntries(RELIC_KEYS.map(k=>[k,number(input.ownedRelics[k],RELIC_NAMES[k]+'の在庫')]));
  const o=input.settings;
  const settings={tickets:number(o.tickets,'チケット'),startAt:String(o.startAt),usedToday:o.usedToday===true,
    strategy:String(o.strategy),roundsPerWeek:number(o.roundsPerWeek,'挑戦枠',{min:1,max:3}),
    weeks:number(o.weeks,'期間',{min:1,max:12}),gauge:number(o.gauge,'ゲージ',{max:49}),
    selected:String(o.selected),freeSwitches:number(o.freeSwitches,'無料変更',{max:1}),abandon:o.abandon===true};
  getForecastFreeSchedule(settings.startAt,{freeUsedThisGameDay:settings.usedToday});
  if(!['stop-on-target','complete-cycle'].includes(settings.strategy) ||
    !['none',...RELIC_KEYS].includes(settings.selected))throw new Error('計画方式・選択聖遺物が不正です');
  return {version:1,plans,partsBySlot,ownedRelics,settings};
}
function serialize(){
  syncFromScreen();
  const parsed=validateImported(draft);
  const json=JSON.stringify(parsed);
  if(json.length>64000)throw new Error('データが大きすぎます');
  return json;
}
function restore(json,message){
  if(json.length>64000)throw new Error('データが大きすぎます');
  const next=validateImported(JSON.parse(json));
  draft=next;
  sequence=Math.max(sequence,...draft.plans.map(x=>Number(String(x.equipmentId).match(/(\d+)$/)?.[1]||0)));
  fillGlobals();results.hidden=true;clearError();setStatus(message);
}
root.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button||!root.contains(button))return;
  const action=button.dataset.action;
  if(!action)return;
  if(action==='add'){
    syncFromScreen();
    if(draft.plans.length>=MAX_PLANS){fail('計画は最大'+MAX_PLANS+'件です');return;}
    draft.plans.push(newPlan());updateCards();results.hidden=true;setStatus('端末内の変更は未保存です。');return;
  }
  if(action==='up'||action==='down'||action==='remove'){
    syncFromScreen();
    const i=Number(button.closest('[data-index]').dataset.index);
    if(action==='remove'){draft.plans.splice(i,1);}
    else{const next=i+(action==='up'?-1:1);if(next<0||next>=draft.plans.length)return;
      [draft.plans[i],draft.plans[next]]=[draft.plans[next],draft.plans[i]];}
    updateCards();results.hidden=true;setStatus('優先順を変更。実際の在庫は消費しません。');return;
  }
  if(action==='calculate')calculate();
  if(action==='save'){
    try{const json=serialize();localStorage.setItem(STORAGE_KEY,json);clearError();
      setStatus('この端末だけに保存しました。PC・スマホ間では同期されません。');}
    catch(e){fail('端末内保存に失敗しました。'+e.message);}
  }
  if(action==='load'){
    try{const data=localStorage.getItem(STORAGE_KEY);if(!data)throw new Error('保存済みの下書きがありません');
      restore(data,'この端末の下書きを読み込みました。');}
    catch(e){fail(e.message);}
  }
  if(action==='export'){
    try{const blob=new Blob([serialize()],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='holy-angel-plans.json';a.click();
      // Explicit download action: do not alter stored data.
      setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus('JSONを書き出しました。編集リンクとは別です。');}
    catch(e){fail(e.message);}
  }
});
byId('import-json').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>64000)throw new Error('JSONのサイズは64KB以内にしてください');
    restore(await file.text(),'JSONを読み込みました。実在庫と計画を必ず確認してください。');
  }catch(e){fail('JSONを読み込めません：'+e.message);}
  finally{event.target.value='';}
});
root.addEventListener('input',event=>{
  if(event.target.matches('input,select,textarea')&&event.target.id!=='import-json'){
    setStatus('変更あり。端末内保存ボタンを押すまで保存されません。');
    results.hidden=true;
  }
});
fillGlobals();
setStatus('開発用テスト画面。計算は保存されず、クラウドにも送信しません。');
