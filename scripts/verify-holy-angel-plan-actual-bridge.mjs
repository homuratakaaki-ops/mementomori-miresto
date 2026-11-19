import assert from 'node:assert/strict';
import {bridgePlansAndActuals,normalizeLegacyPlans,validateActualBundle,PLAN_V1_KEY,ACTUAL_V2_KEY} from '../js/holy-angel-plan-actual-bridge.mjs';

let checks=0;
const eq=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;};
const bad=(label,fn,re)=>{assert.throws(fn,re,label);checks++;};
const base=()=>({
 version:1,
 plans:[
  {equipmentId:'armA',name:'手 Lv280',slot:'arm',current:'240',target:'280',steps:''},
  {equipmentId:'feetA',name:'足 Lv250',slot:'feet',current:'240',target:'250',steps:''}
 ],
 partsBySlot:{arm:0,feet:0,accessory:0,head:0,body:0},
 ownedRelics:{chalice:0,medal:0,wing:0,fruit:0},
 settings:{tickets:0,startAt:'2026-10-11T18:30',usedToday:false,
  strategy:'complete-cycle',roundsPerWeek:3,weeks:4,gauge:0,
  selected:'none',freeSwitches:1,abandon:false}
});
const actual=()=>({
 schemaVersion:2,
 snapshot:{at:'2026-10-11T18:00',
  relics:{chalice:1,medal:0,wing:0,fruit:0},
  partsBySlot:{arm:20,feet:0,accessory:0,head:0,body:0},
  tickets:10,diamonds:50000,gauge:0,selected:'chalice',
  freeSwitches:1,usedFreeToday:true,claimedCheckpoints:[]},
 events:[]
});
const planned=bridgePlansAndActuals({planV1:base()});
eq('plan-only indicator',planned.source,'plan-entry');
eq('plan-only existing shortfalls',[planned.shortages.chalice,planned.shortages.medal],[3,3]);
eq('plan-only exchanges',[planned.combined.perItem[0].exchanges,planned.combined.perItem[1].exchanges],[2,1]);
eq('plan-only cost uses 0 tickets',planned.inventory.tickets,0);
eq('plan-only Sunday has 1 free day left',planned.free.firstWeekFreeDraws,1);
const actualView=bridgePlansAndActuals({planV1:base(),actualV2:actual(),inventorySource:'actuals'});
eq('actual confirmed inventory',actualView.source,'confirmed-actuals');
eq('actual inventory differs from stale plan input',actualView.differsFromPlanEntry,true);
eq('actual used only confirmed chalice',actualView.inventory.ownedRelics.chalice,1);
eq('actual uses true ticket stock',actualView.inventory.tickets,10);
eq('actual parts shared across goals',actualView.combined.perItem[0].exchanges,1);
eq('actual feet still one exchange',actualView.combined.perItem[1].exchanges,1);
eq('actual shortfalls after combined',[actualView.shortages.chalice,actualView.shortages.medal],[1,2]);
eq('actual current selected carried',actualView.forecast.expectedDiamondsToComplete!==null,true);
eq('actual free used Sunday means zero remains',actualView.free.firstWeekFreeDraws,0);
eq('actual startup unchanged',actualView.asOf,'2026-10-11T18:00');
const stale=base(),originalActual=actual(),previous=[JSON.stringify(stale),JSON.stringify(originalActual)];
bridgePlansAndActuals({planV1:stale,actualV2:originalActual,inventorySource:'actuals'});
eq('both snapshots remain immutable', [JSON.stringify(stale),JSON.stringify(originalActual)],previous);
eq('old v1 key is unchanged',PLAN_V1_KEY,'holy-angel-multi-plan-test-v1');
eq('old v2 key is unchanged',ACTUAL_V2_KEY,'holy-angel-actuals-test-v2');

bad('refuse actual mode without imported actual records',
 ()=>bridgePlansAndActuals({planV1:base(),inventorySource:'actuals'}),/実績データ/);
bad('Monday reset cannot be inferred from Sundays actual gauge',
 ()=>{const p=base();p.settings.startAt='2026-10-12T04:00';return bridgePlansAndActuals({planV1:p,actualV2:actual(),inventorySource:'actuals'});},/週更新が未記録/);
bad('refuse non-v1 plans',()=>bridgePlansAndActuals({planV1:{...base(),version:2}}),/旧テスト版1/);
bad('refuse old file as v2 actuals',()=>bridgePlansAndActuals({planV1:base(),actualV2:base(),inventorySource:'actuals'}),/テスト版2/);
bad('do not auto assume stale plan start equals latest actual',
 ()=>{const p=base();p.settings.startAt='2026-10-11T12:00';bridgePlansAndActuals({planV1:p,actualV2:actual(),inventorySource:'actuals'});},/最後の実績より前/);
bad('reject unknown source',()=>bridgePlansAndActuals({planV1:base(),inventorySource:'both'}),/参照元/);
bad('reject impossible manual Lv',()=>{const p=base();p.plans[0].target='530';p.plans[0].steps='540=40';p.plans[0].current='545';bridgePlansAndActuals({planV1:p});},/10刻み/);
bad('reject same ID with contradictory current',()=>{const p=base();p.plans[1].equipmentId='armA';bridgePlansAndActuals({planV1:p});},/開始状態/);
bad('reject negative manual stock',()=>{const p=base();p.partsBySlot.arm=-1;bridgePlansAndActuals({planV1:p});},/数値/);
bad('reject extra level duplicate',()=>{const p=base();p.plans[0].steps='540=40,540=50';bridgePlansAndActuals({planV1:p});},/重複/);

const claimed=actual();
claimed.snapshot.gauge=10;
claimed.snapshot.claimedCheckpoints=[];
bad('pending unclaimed milestones do not produce misleading forecast',
 ()=>bridgePlansAndActuals({planV1:base(),actualV2:claimed,inventorySource:'actuals'}),/未受取/);
claimed.snapshot.claimedCheckpoints=[10];
eq('claim explicitly recorded allows forecast',
 bridgePlansAndActuals({planV1:base(),actualV2:claimed,inventorySource:'actuals'}).usedRealInventory,true);

const eventActual=actual();
eventActual.events=[
 {id:'draw1',type:'draw',at:'2026-10-11T18:05',count:10,free:false,ticketsUsed:10},
 {id:'claim1',type:'claim',at:'2026-10-11T18:06',milestone:10,won:true}
];
bad('cannot silently abandon a gauge whose relic is already sufficient',
 ()=>bridgePlansAndActuals({planV1:base(),actualV2:eventActual,inventorySource:'actuals'}),/Partial gauge/i);
const confirmedSwitchPlan=base();confirmedSwitchPlan.settings.abandon=true;
const eventResult=bridgePlansAndActuals({planV1:confirmedSwitchPlan,actualV2:eventActual,inventorySource:'actuals'});
eq('confirmed claim advances relics',eventResult.inventory.ownedRelics.chalice,2);
eq('claims never touch original v1 inventory',base().ownedRelics.chalice,0);
eq('confirmed claim reduces remaining shortage',eventResult.shortages.chalice,0);
eq('recorded gauge affects forecast horizon',eventResult.forecast.expectedDraws>0,true);
eq('duplicate exact replay not double charged',(()=>{eventActual.events.push(eventActual.events[0]);return validateActualBundle(eventActual).relics.chalice})(),2);

const achieved=base(); achieved.plans[0].target='240'; achieved.plans[1].target='240';
eq('zero deficits complete now',bridgePlansAndActuals({planV1:achieved}).forecast.expectedDiamondsSpent,0);
eq('zero deficit actual mode complete',bridgePlansAndActuals({planV1:achieved,actualV2:actual(),inventorySource:'actuals'}).forecast.expectedDiamondsSpent,0);

const sameDayPlan=base();sameDayPlan.settings.startAt='2026-10-11T19:00';
const same=bridgePlansAndActuals({planV1:sameDayPlan,actualV2:actual(),inventorySource:'actuals'});
eq('actual free used today suppresses extra free',same.free.firstWeekFreeDraws,0);

console.log('PASS '+checks+' bridge tests: v1 plans and v2 confirmed actuals');
