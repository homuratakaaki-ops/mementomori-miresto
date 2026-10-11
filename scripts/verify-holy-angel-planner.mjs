import assert from 'node:assert/strict';
import {MICHAEL_CUMULATIVE_PARTS, standardRemainder, planEquipmentParts, planCombinedEquipment, fixedDrawCost} from '../js/holy-angel-planner-core.mjs';
let count = 0;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); ++count; }
check('table boundaries', [MICHAEL_CUMULATIVE_PARTS[240], MICHAEL_CUMULATIVE_PARTS[530]], [100,900]);
check('increment 520->530', MICHAEL_CUMULATIVE_PARTS[530]-MICHAEL_CUMULATIVE_PARTS[520], 40);
check('standard leftovers', [240,250,260,270,280,290,300].map(l=>standardRemainder(l)), [0,35,20,0,30,10,35]);
const plan=(currentLevel,targetLevel,ownedParts)=>planEquipmentParts({slot:'arm',currentLevel,targetLevel,ownedParts});
check('280->300 normal', [plan(280,300,30).exchanges,plan(280,300,30).remainingParts], [1,35]);
check('280->300 prepaid 50', [plan(280,300,80).exchanges,plan(280,300,80).remainingParts], [0,35]);
check('240->280 actual P=20', [plan(240,280,20).exchanges,plan(240,280,20).remainingParts], [1,0]);
check('240->280 actual P=100', [plan(240,280,100).exchanges,plan(240,280,100).remainingParts], [0,30]);
check('already reached keeps excess', [plan(300,280,100).exchanges,plan(300,280,100).remainingParts], [0,100]);
check('not owned ->240', [plan(null,240,0).exchanges,plan(null,240,0).remainingParts], [2,0]);
check('280->300 intermediate', plan(280,300,30).steps.map(s=>[s.level,s.requiredParts,s.remainingParts]), [[290,20,10],[300,25,35]]);
check('530->550 custom increments', planEquipmentParts({slot:'arm',currentLevel:530,targetLevel:550,ownedParts:0,customStepParts:{540:32,550:13}}).exchanges,1);
assert.throws(()=>planEquipmentParts({slot:'arm',currentLevel:530,targetLevel:550,customStepParts:{540:30}}), /550/); ++count;
assert.throws(()=>planEquipmentParts({slot:'arm',currentLevel:240,targetLevel:280,ownedParts:-1}), /ownedParts/); ++count;
const combined=planCombinedEquipment([
  {equipmentId:'arm1',slot:'arm',currentLevel:240,targetLevel:280,ownedParts:0},
  {equipmentId:'feet1',slot:'feet',currentLevel:240,targetLevel:280,ownedParts:0},
],{chalice:1,medal:1});
check('two items relic needs', [combined.totalRelics.chalice,combined.shortages.chalice,combined.totalRelics.medal,combined.shortages.medal],[4,3,4,3]);
const same=planCombinedEquipment([
  {equipmentId:'arm1',slot:'arm',currentLevel:240,targetLevel:300,ownedParts:0},
  {equipmentId:'arm1',slot:'arm',currentLevel:240,targetLevel:350,ownedParts:0}
]);
check('one physical item twice is not duplicated', [same.perItem.length,same.perItem[0].exchanges], [1,5]);
check('fixed draws 50 Monday',fixedDrawCost({draws:50,freeDraws:7}).totalDiamonds,12900);
check('fixed draws 100 Monday',fixedDrawCost({draws:100,freeDraws:7}).totalDiamonds,27900);
check('fixed draws 50 Thursday +20 tickets',fixedDrawCost({draws:50,freeDraws:4,tickets:20}).totalDiamonds,7800);
check('paid switch 300',fixedDrawCost({draws:1,freeDraws:1,paidSwitches:1}).totalDiamonds,300);
assert.throws(()=>fixedDrawCost({draws:2,freeDraws:3}),/exceeds/); ++count;
console.log('PASS ' + count + ' holy-angel core checks');
