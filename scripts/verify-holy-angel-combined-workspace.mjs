import assert from 'node:assert/strict';
import {
 createCombinedWorkspace,parseCombinedWorkspace,serializeCombinedWorkspace,
 inspectCombinedWorkspace,chooseCombinedSource,moveCombinedPlan,setCombinedStartAt,
 appendCombinedActualEvent,undoLastCombinedEvent,COMBINED_WORKSPACE_KEY
} from '../js/holy-angel-combined-workspace.mjs';

let n=0;
const eq=(name,x,y)=>{assert.deepEqual(x,y,name);n++};
const bad=(name,fn,re)=>{assert.throws(fn,re,name);n++};
const plan=()=>({version:1,plans:[
 {equipmentId:'armA',name:'腕Lv280',slot:'arm',current:'240',target:'280',steps:''},
 {equipmentId:'feetA',name:'足Lv250',slot:'feet',current:'240',target:'250',steps:''}],
 partsBySlot:{arm:0,feet:0,accessory:0,head:0,body:0},
 ownedRelics:{chalice:0,medal:0,wing:0,fruit:0},
 settings:{tickets:0,startAt:'2026-10-11T18:30',usedToday:false,
  strategy:'complete-cycle',roundsPerWeek:3,weeks:4,gauge:0,selected:'none',
  freeSwitches:1,abandon:false}});
const actual=()=>({schemaVersion:2,snapshot:{
 at:'2026-10-11T18:00',relics:{chalice:1,medal:0,wing:0,fruit:0},
 partsBySlot:{arm:20,feet:0,accessory:0,head:0,body:0},
 tickets:0,diamonds:50000,gauge:0,selected:'chalice',freeSwitches:1,
 usedFreeToday:false,claimedCheckpoints:[]},events:[]});
const oldPlan=plan(),oldActual=actual();
const oldJson=[JSON.stringify(oldPlan),JSON.stringify(oldActual)];
const v3=createCombinedWorkspace({planV1:oldPlan,actualV2:oldActual});
eq('version 3',v3.schemaVersion,3);
eq('fresh revision 0',v3.revision,0);
eq('default plans mode',v3.inventoryMode,'plans');
eq('v1 plan maintained',v3.planData.version,1);
eq('v2 actual maintained',v3.actualData.schemaVersion,2);
eq('legacy unchanged on migrate',[JSON.stringify(oldPlan),JSON.stringify(oldActual)],oldJson);
eq('new key not same as old',COMBINED_WORKSPACE_KEY,'holy-angel-combined-test-v3');
const info=inspectCombinedWorkspace(v3);
eq('has two planned items',info.plans,2);
eq('zero actual entries initially',info.actualEvents,0);
eq('forecast available in plan mode',info.blockedReason,null);
eq('plan mode shortage chalice',info.forecast.shortages.chalice,3);
const selected=chooseCombinedSource(v3,'actuals');
eq('revised source',selected.inventoryMode,'actuals');
eq('revision 1',selected.revision,1);
eq('actual shortage chalice 1',inspectCombinedWorkspace(selected).forecast.shortages.chalice,1);
eq('actual shortage medal 2',inspectCombinedWorkspace(selected).forecast.shortages.medal,2);
eq('actual only two exchanges',inspectCombinedWorkspace(selected).forecast.combined.perItem.reduce((n,p)=>n+p.exchanges,0),2);
eq('old source remains plans',v3.inventoryMode,'plans');
const rearranged=moveCombinedPlan(v3,1,0);
eq('plan moved to first',rearranged.planData.plans[0].equipmentId,'feetA');
eq('no source mutation after reorder',v3.planData.plans[0].equipmentId,'armA');
eq('no original mutation after reorder',oldPlan.plans[0].equipmentId,'armA');
eq('revision increments',rearranged.revision,1);
const dated=setCombinedStartAt(v3,'2026-10-11T19:30');
eq('date changed only in new draft',dated.planData.settings.startAt,'2026-10-11T19:30');
eq('source date untouched',v3.planData.settings.startAt,'2026-10-11T18:30');
const round= parseCombinedWorkspace(serializeCombinedWorkspace(selected));
eq('save & restore equal',round,selected);
const draw={id:'draw1',at:'2026-10-11T18:05',type:'draw',count:10,free:true,ticketsUsed:0};
const recorded=appendCombinedActualEvent(selected,draw);
eq('new actual event added',recorded.actualData.events.length,1);
eq('initial remains event-free',selected.actualData.events.length,0);
eq('draw does not add an unclaimed relic',inspectCombinedWorkspace(recorded).actual.relics.chalice,1);
eq('unclaimed blocks forecast',inspectCombinedWorkspace(recorded).forecast,null);
eq('reason says unclaimed',inspectCombinedWorkspace(recorded).blockedReason.includes('未受取'),true);
const claim={id:'claim1',at:'2026-10-11T18:06',type:'claim',milestone:10,won:true};
const claimed=appendCombinedActualEvent(recorded,claim);
eq('actual reward increased',inspectCombinedWorkspace(claimed).actual.relics.chalice,2);
eq('claim maintained original snapshot',selected.actualData.snapshot.relics.chalice,1);
const reverted=undoLastCombinedEvent(claimed);
eq('undo removes latest event',reverted.actualData.events.length,1);
eq('undo restores pending reward',inspectCombinedWorkspace(reverted).actual.pendingClaims,[10]);
eq('undo does not mutate previous',claimed.actualData.events.length,2);
eq('replay not doubling rewards',inspectCombinedWorkspace(claimed).actual.relics.chalice,2);
eq('full JSON restores event history',parseCombinedWorkspace(serializeCombinedWorkspace(claimed)).actualData.events.length,2);
bad('cannot reuse event ID',()=>appendCombinedActualEvent(recorded,draw),/二重登録/);
bad('cannot redefine event ID',()=>appendCombinedActualEvent(recorded,{...draw,count:8}),/異なる内容/);
bad('cannot register reward before gauge',()=>appendCombinedActualEvent(selected,claim),/before drawing/);
bad('no actuals -> cannot use actual mode',()=>createCombinedWorkspace({planV1:oldPlan,inventoryMode:'actuals'}),/実績/);
bad('no actuals -> cannot append',()=>appendCombinedActualEvent(createCombinedWorkspace({planV1:oldPlan}),draw),/実績/);
bad('cannot undo without actuals',()=>undoLastCombinedEvent(createCombinedWorkspace({planV1:oldPlan})),/取り消せる/);
bad('cannot undo empty history',()=>undoLastCombinedEvent(selected),/取り消せる/);
bad('cannot reorder outside bounds',()=>moveCombinedPlan(v3,0,9),/位置/);
bad('cannot restore wrong version',()=>parseCombinedWorkspace('{"schemaVersion":2}'),/版/);
bad('cannot import broken JSON',()=>parseCombinedWorkspace('{broken'),/JSON|Expected/);
bad('cannot use invalid plan goal',()=>{const p=plan();p.plans[0].target='545';return createCombinedWorkspace({planV1:p})},/10刻み/);
bad('cannot use corrupted actual reward history',()=>{const a=actual();a.events=[claim];return createCombinedWorkspace({planV1:plan(),actualV2:a})},/before drawing/);
bad('never silently accept oversize',()=>parseCombinedWorkspace(' '.repeat(64001)),/64KB/);
bad('bad start time rejected',()=>setCombinedStartAt(v3,'2026-02-30T18:00'),/Invalid/);
bad('bad inventory mode rejected',()=>chooseCombinedSource(v3,'everything'),/参照元/);
eq('old external data unchanged after tests',[JSON.stringify(oldPlan),JSON.stringify(oldActual)],oldJson);
console.log('PASS '+n+' unified v3 workspace non-destructive migration tests');
