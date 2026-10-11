/**
 * Stage 12: version-3 local combined workspace.
 * Migration COPIES the two previous structures. It never modifies old saves.
 * Planning numbers are distinct from confirmed in-game actual inventory.
 * No external services, clocks or storage APIs are used by this module.
 */
import {normalizeLegacyPlans,validateActualBundle,bridgePlansAndActuals} from './holy-angel-plan-actual-bridge.mjs';
import {replayHolyAngelActuals} from './holy-angel-actual-log.mjs';
import {parseJstLocal} from './holy-angel-calendar.mjs';

export const COMBINED_WORKSPACE_KEY='holy-angel-combined-test-v3';
export const COMBINED_SCHEMA_VERSION=3;
export const COMBINED_MAX_BYTES=64000;
const clone=value=>JSON.parse(JSON.stringify(value));
function object(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(label+'の形式が正しくありません');
  return value;
}
function validate(doc){
  object(doc,'保存データ');
  if(doc.schemaVersion!==3)throw new Error('新しい統合保存データの版が異なります');
  if(!Number.isSafeInteger(doc.revision)||doc.revision<0)throw new Error('更新番号が正しくありません');
  if(!['plans','actuals'].includes(doc.inventoryMode))throw new Error('所持数の参照元が正しくありません');
  object(doc.planData,'育成計画');
  normalizeLegacyPlans(doc.planData);
  if(doc.actualData!==null){
    object(doc.actualData,'実績');
    validateActualBundle(doc.actualData);
  }
  if(doc.inventoryMode==='actuals' && doc.actualData===null)throw new Error('実績を使うには実績データを先に読み込んでください');
  const json=JSON.stringify(doc);
  if(new TextEncoder().encode(json).byteLength>COMBINED_MAX_BYTES)throw new Error('保存データが大きすぎます（64KB以内）');
  return doc;
}
export function createCombinedWorkspace({planV1,actualV2=null,inventoryMode='plans'}){
  normalizeLegacyPlans(planV1);
  if(actualV2!==null)validateActualBundle(actualV2);
  const next={schemaVersion:3,revision:0,inventoryMode,
    planData:clone(planV1),actualData:actualV2===null?null:clone(actualV2)};
  return clone(validate(next));
}
export function parseCombinedWorkspace(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).byteLength>COMBINED_MAX_BYTES)
    throw new Error('読み込めるデータファイルは64KB以内です');
  return clone(validate(JSON.parse(text)));
}
export function serializeCombinedWorkspace(doc){return JSON.stringify(validate(doc));}
export function inspectCombinedWorkspace(doc){
  validate(doc);
  const plan=normalizeLegacyPlans(doc.planData);
  const actual=doc.actualData===null?null:validateActualBundle(doc.actualData);
  let forecast=null,blockedReason=null;
  try{
    forecast=bridgePlansAndActuals({
      planV1:doc.planData,actualV2:doc.actualData,inventorySource:doc.inventoryMode
    });
  }catch(err){blockedReason=err.message||String(err);}
  return {
    revision:doc.revision,mode:doc.inventoryMode,plans:plan.plans.length,
    actualEvents:doc.actualData?.events.length??0,
    actual,forecast,blockedReason
  };
}
function changed(doc,edit){
  validate(doc);
  const copy=clone(doc);
  edit(copy);
  copy.revision++;
  return clone(validate(copy));
}
export function chooseCombinedSource(doc,mode){
  return changed(doc,next=>{
    if(!['plans','actuals'].includes(mode))throw new Error('参照元が正しくありません');
    if(mode==='actuals'&&next.actualData===null)throw new Error('先に実績を読み込んでください');
    next.inventoryMode=mode;
  });
}
export function moveCombinedPlan(doc,from,to){
  return changed(doc,next=>{
    const plans=next.planData.plans;
    if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<0||to<0||
       from>=plans.length||to>=plans.length)throw new Error('並べ替えの位置が不正です');
    const [item]=plans.splice(from,1);plans.splice(to,0,item);
  });
}
export function setCombinedStartAt(doc,value){
  return changed(doc,next=>{
    parseJstLocal(value);
    next.planData.settings.startAt=value;
  });
}
export function appendCombinedActualEvent(doc,event){
  return changed(doc,next=>{
    if(next.actualData===null)throw new Error('実績データがありません');
    object(event,'実績');
    if(typeof event.id!=='string'||!event.id||event.id.length>80)throw new Error('実績IDが正しくありません');
    const existing=next.actualData.events.find(e=>e.id===event.id);
    if(existing){
      if(JSON.stringify(existing)===JSON.stringify(event))
        throw new Error('同じ実績はすでに記録されています（二重登録を防止）');
      throw new Error('同じ実績IDで異なる内容を登録できません');
    }
    if(next.actualData.events.length>=300)throw new Error('実績は最大300件です');
    next.actualData.events.push(clone(event));
    replayHolyAngelActuals({snapshot:next.actualData.snapshot,events:next.actualData.events});
    // Forecast may become blocked by pending claims; data is still valid.
  });
}
export function undoLastCombinedEvent(doc){
  return changed(doc,next=>{
    if(next.actualData===null||next.actualData.events.length===0)throw new Error('取り消せる実績がありません');
    next.actualData.events.pop();
    replayHolyAngelActuals({snapshot:next.actualData.snapshot,events:next.actualData.events});
  });
}
