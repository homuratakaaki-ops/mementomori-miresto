/**
 * Stage 11: read-only bridge from existing local plan v1 and actual-log v2.
 * No migration or storage writes. This does NOT trust predicted relics as real.
 * The chosen source always supplies ALL shared inventory, not a sum of v1+v2.
 */
import {PART_SLOTS,RELIC_KEYS,planPrioritizedSharedEquipment} from './holy-angel-planner-core.mjs';
import {replayHolyAngelActuals} from './holy-angel-actual-log.mjs';
import {getForecastFreeSchedule,parseJstLocal,gameDayJst} from './holy-angel-calendar.mjs';
import {forecastMultiRelicWithStopping} from './holy-angel-multi-stop.mjs';

export const PLAN_V1_KEY='holy-angel-multi-plan-test-v1';
export const ACTUAL_V2_KEY='holy-angel-actuals-test-v2';
const SLOTS=Object.keys(PART_SLOTS),ALL=[...RELIC_KEYS];
function obj(name,value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(name+'の形式が正しくありません');
  return value;
}
function count(name,value,max=1_000_000) {
  if(typeof value==='string'&&!/^\d+$/.test(value.trim()))throw new RangeError(name+'は0以上の整数にしてください');
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0||n>max)throw new RangeError(name+'の数値が正しくありません');
  return n;
}
function level(name,value,allowNone=false){
  if(allowNone && (value===null||value===undefined||value===''))return null;
  const n=count(name,value,5000);
  if(n<240||n%10!==0)throw new RangeError(name+'はLv240以上、10刻みにしてください');
  return n;
}
function extraSteps(text){
  const o={};
  if(text===undefined||text===null||text==='')return o;
  if(typeof text!=='string'||text.length>1500)throw new RangeError('追加パーツ入力が長すぎます');
  for(const item of text.split(/[,\n]/)){
    if(!item.trim())continue;
    const m=/^(\d+)\s*[:=]\s*(\d+)$/.exec(item.trim());
    if(!m)throw new Error('追加パーツは「540=40」の形式で入力してください');
    const lv=count('追加レベル',m[1],5000),parts=count('追加パーツ',m[2]);
    if(lv<540||lv%10!==0||Object.hasOwn(o,lv))throw new RangeError('Lv540以降を10刻みで重複なく入力してください');
    o[lv]=parts;
  }
  return o;
}
function quantities(name,value,keys){
  obj(name,value);
  return Object.fromEntries(keys.map(k=>[k,count(name+' '+k,value[k]??0)]));
}
export function normalizeLegacyPlans(planV1){
  const plan=obj('育成計画',planV1);
  if(plan.version!==1||!Array.isArray(plan.plans)||plan.plans.length<1||plan.plans.length>8)
    throw new Error('育成計画の保存データは旧テスト版1に対応しています（1〜8件）');
  const seen=new Map();
  const plans=plan.plans.map((p,index)=>{
    obj('育成計画'+(index+1),p);
    if(typeof p.equipmentId!=='string'||!p.equipmentId.trim()||p.equipmentId.length>80)
      throw new Error('装備IDが正しくありません');
    if(!Object.hasOwn(PART_SLOTS,p.slot))throw new Error('部位が正しくありません');
    const currentLevel=level('現在Lv',p.current,true);
    const targetLevel=level('目標Lv',p.target);
    const customStepParts=extraSteps(p.steps);
    const item={equipmentId:p.equipmentId,slot:p.slot,currentLevel,targetLevel,customStepParts};
    const previous=seen.get(item.equipmentId);
    if(previous&&(previous.slot!==item.slot||previous.currentLevel!==item.currentLevel||
        JSON.stringify(previous.customStepParts)!==JSON.stringify(item.customStepParts)))
      throw new Error('同じ装備IDの開始状態が一致していません');
    seen.set(item.equipmentId,item);
    return {...item,name:typeof p.name==='string' ? p.name.slice(0,80) : '装備'+(index+1)};
  });
  const partsBySlot=quantities('未使用パーツ',plan.partsBySlot,SLOTS);
  const ownedRelics=quantities('聖遺物',plan.ownedRelics,ALL);
  const s=obj('ガチャ計画の条件',plan.settings);
  const startAt=s.startAt;
  parseJstLocal(startAt);
  if(typeof s.usedToday!=='boolean')throw new Error('無料ガチャの使用状況が不明です');
  if(!['stop-on-target','complete-cycle'].includes(s.strategy))throw new Error('引き方が正しくありません');
  if(!['none',...ALL].includes(s.selected))throw new Error('現在選択中の聖遺物が正しくありません');
  if(typeof s.abandon!=='boolean')throw new Error('途中ゲージの放棄確認が正しくありません');
  return {plans,partsBySlot,ownedRelics,settings:{
    startAt,usedToday:s.usedToday,strategy:s.strategy,
    roundsPerWeek:count('週の挑戦枠',s.roundsPerWeek,3),
    weeks:count('計算する週数',s.weeks,12),
    gauge:count('現在のガチャ回数',s.gauge,49),
    freeSwitches:count('無料変更残',s.freeSwitches,1),
    tickets:count('チケット残',s.tickets),
    selected:s.selected,abandon:s.abandon
  }};
}
export function validateActualBundle(actualV2){
  const bundle=obj('実績の保存データ',actualV2);
  if(bundle.schemaVersion!==2||!Array.isArray(bundle.events)||bundle.events.length>300)
    throw new Error('実績データはテスト版2の記録に対応しています');
  const state=replayHolyAngelActuals({snapshot:bundle.snapshot,events:bundle.events});
  return state;
}
/** Pure function. Does not update either saved plan or saved actuals. */
export function bridgePlansAndActuals({planV1,actualV2=null,inventorySource='plans'}){
  const plan=normalizeLegacyPlans(planV1);
  if(!['plans','actuals'].includes(inventorySource))throw new Error('所持素材の参照元が正しくありません');
  let partsBySlot=plan.partsBySlot,ownedRelics=plan.ownedRelics;
  let settings={
    tickets:plan.settings.tickets,startAt:plan.settings.startAt,
    usedToday:plan.settings.usedToday,
    startGauge:plan.settings.gauge,startSelected:plan.settings.selected==='none'?null:plan.settings.selected,
    freeSwitchesRemaining:plan.settings.freeSwitches
  };
  let actualState=null;
  let differs=false;
  if(inventorySource==='actuals'){
    if(!actualV2)throw new Error('実績データを読み込んでください');
    actualState=validateActualBundle(actualV2);
    // A passed checkpoint has unknown outcome until explicitly claimed.
    if(actualState.pendingClaims.length)
      throw new Error('未受取の回数報酬があります。先に実際の報酬を確認して記録してください（計算では補完しません）');
    if(parseJstLocal(plan.settings.startAt)<parseJstLocal(actualState.at))
      throw new Error('計画の開始日時が最後の実績より前です。計画の日時を進めてください');
    partsBySlot={...actualState.partsBySlot};
    ownedRelics={...actualState.relics};
    differs=SLOTS.some(k=>plan.partsBySlot[k]!==partsBySlot[k])||
       ALL.some(k=>plan.ownedRelics[k]!==ownedRelics[k])||
       plan.settings.tickets!==actualState.tickets;
    const sameDay=gameDayJst(plan.settings.startAt)===actualState.gameDay;
    settings={
      tickets:actualState.tickets,
      startAt:plan.settings.startAt,
      usedToday:sameDay?actualState.usedFreeToday:false,
      startGauge:actualState.gauge,
      startSelected:actualState.selected,
      freeSwitchesRemaining:actualState.freeSwitches
    };
  }
  const combined=planPrioritizedSharedEquipment({plans:plan.plans,partsBySlot,ownedRelics});
  const free=getForecastFreeSchedule(settings.startAt,{freeUsedThisGameDay:settings.usedToday});
  const relicOrder=[...new Set([
    ...combined.perItem.flatMap(item=>ALL.filter(key=>item.relics[key]>0)),...ALL
  ])];
  const forecast=forecastMultiRelicWithStopping({
    needs:combined.shortages,order:relicOrder,
    tickets:settings.tickets,
    strategy:plan.settings.strategy,
    roundsPerWeek:plan.settings.roundsPerWeek,
    weeks:plan.settings.weeks,
    startGauge:settings.startGauge,
    startSelected:settings.startSelected,
    abandonPartialGauge:plan.settings.abandon,
    freeSwitchesRemaining:settings.freeSwitchesRemaining,
    firstWeekFreeDraws:free.firstWeekFreeDraws,laterWeekFreeDraws:7
  });
  return {
    source:inventorySource==='actuals'?'confirmed-actuals':'plan-entry',
    asOf:inventorySource==='actuals'?actualState.at:null,
    usedRealInventory:inventorySource==='actuals',
    differsFromPlanEntry:differs,
    inventory:{partsBySlot:{...partsBySlot},ownedRelics:{...ownedRelics},tickets:settings.tickets},
    planNames:plan.plans.map(x=>x.name),
    priority:combined.priority,
    combined,shortages:{...combined.shortages},
    free,forecast,
    warning:inventorySource==='actuals'?
      '記録済みの実績のみ所持数に反映。計画の素材数は変更しません。実績日時から計画開始まで新しい操作がない前提です。':
      '計画画面へ入力した在庫で試算。実績の所持数との同期は行いません。'
  };
}
