import assert from 'node:assert/strict';
import {forecastMultiRelicWithStopping as forecast,RELICS} from '../js/holy-angel-multi-stop.mjs';
let checks=0;
function near(name,actual,expected,tolerance=1e-8){assert.ok(actual!==null&&Math.abs(actual-expected)<tolerance, name+': got '+actual+' instead of '+expected);checks++;}
function eq(name,a,b){assert.deepEqual(a,b,name);checks++;}
function invalid(name,f,pattern){assert.throws(f,pattern,name);checks++;}
const run=(needs,opt={})=>forecast({needs,...opt});
const ones=run({chalice:1});
near('one target 34 average draws',ones.expectedDraws,34);
near('one target average diamonds 8100',ones.expectedDiamondsToComplete,8100);
near('one target finish 1w',ones.exactWeek[0].cumulativeProbability,1);
near('one type 2 target 64.32 draws',run({chalice:2},{roundsPerWeek:1,weeks:2}).expectedDraws,64.32);
near('one type 2 target 16188',run({chalice:2},{roundsPerWeek:1,weeks:2}).expectedDiamondsToComplete,16188);
near('one type 2 target 1w 52%',run({chalice:2},{roundsPerWeek:1,weeks:2}).exactWeek[0].probability,.52);
near('one type 2 target 1.48w',run({chalice:2},{roundsPerWeek:1,weeks:2}).expectedCompletionWeek,1.48);
near('one type 2 full cost',run({chalice:2},{roundsPerWeek:1,weeks:2,strategy:'complete-cycle'}).expectedDiamondsToComplete,19092);
const distinct=run({chalice:1,medal:1},{roundsPerWeek:2,weeks:1});
near('two distinct 68 average draws',distinct.expectedDraws,68);
near('two distinct 18300 diamonds',distinct.expectedDiamondsToComplete,18300);
near('two distinct 1w guaranteed',distinct.exactWeek[0].cumulativeProbability,1);
near('one free switch to other relic',distinct.expectedFreeSwitches,1);
near('paid switch if free exhausted',run({chalice:1,medal:1},{roundsPerWeek:2,freeSwitchesRemaining:0}).expectedDiamondsToComplete,18456);
near('complete 2 different 27900',run({chalice:1,medal:1},{roundsPerWeek:2,strategy:'complete-cycle'}).expectedDiamondsToComplete,27900);
const twoOne=run({chalice:2,medal:1},{roundsPerWeek:2,weeks:2});
near('two+one 2w guaranteed',twoOne.exactWeek[1].cumulativeProbability,1);
near('two+one first week .52',twoOne.exactWeek[0].cumulativeProbability,.52);
const under=run({chalice:2,medal:1},{roundsPerWeek:1,weeks:1});
near('unfinished mass is 1',under.probabilityUnfinished,1);
eq('no completion cost if unfinished',under.expectedDiamondsToComplete,null);
eq('no completion week if unfinished',under.expectedCompletionWeek,null);
const after25=run({chalice:1},{startGauge:25,startSelected:'chalice'});
near('start at25 draws exactly 25',after25.expectedDraws,25);
near('start at25 no 10/25 reroll',after25.expectedSurplusByRelic.chalice,0);
near('start at25 cost',after25.expectedDiamondsToComplete,5400);
near('start at49 cost0',run({chalice:1},{startGauge:49,startSelected:'chalice'}).expectedDiamondsToComplete,0);
near('start at49 free used cost300',run({chalice:1},{startGauge:49,startSelected:'chalice',firstWeekFreeDraws:0}).expectedDiamondsToComplete,300);
invalid('switch from partial forbidden',()=>run({medal:1},{startGauge:49,startSelected:'chalice'}),/abandoned/);
near('switch from partial paid',run({medal:1},{startGauge:49,startSelected:'chalice',abandonPartialGauge:true,freeSwitchesRemaining:0}).expectedDiamondsToComplete,8400);
near('switch from partial free',run({medal:1},{startGauge:49,startSelected:'chalice',abandonPartialGauge:true,freeSwitchesRemaining:1}).expectedDiamondsToComplete,8100);
near('single 50 full 20 tickets',run({chalice:1},{strategy:'complete-cycle',tickets:20}).expectedDiamondsToComplete,6900);
near('two distinct stop 20 tickets with path-level cap',run({chalice:1,medal:1},{roundsPerWeek:2,tickets:20}).expectedDiamondsToComplete,12384);
near('first week free 0',run({chalice:1},{firstWeekFreeDraws:0}).expectedDiamondsToComplete,10200);
const zero=run({});near('no needed probability 1',zero.probabilityFinished,1);
near('no needed cost0',zero.expectedDiamondsToComplete,0);
invalid('invalid order',()=>run({chalice:1},{order:['chalice','chalice','wing','fruit']}),/order/);
invalid('noninteger needs',()=>run({chalice:.5}),/needs.chalice/);
invalid('negative needs',()=>run({chalice:-1}),/needs.chalice/);
invalid('invalid rounds',()=>run({chalice:1},{roundsPerWeek:4}),/roundsPerWeek/);
invalid('invalid weeks',()=>run({chalice:1},{weeks:27}),/weeks/);
invalid('gauge not specified target',()=>run({chalice:1},{startGauge:11}),/startSelected/);
invalid('free count >7',()=>run({chalice:1},{firstWeekFreeDraws:8}),/firstWeekFreeDraws/);
invalid('bad starting relic',()=>run({chalice:1},{startSelected:'abc'}),/startSelected/);
invalid('bad selected strategy',()=>run({chalice:1},{strategy:'none'}),/strategy/);
function brute({needs,order=RELICS,strategy='stop-on-target',roundsPerWeek=2,weeks=2,
startGauge=0,startSelected=null,abandonPartialGauge=false,
freeSwitchesRemaining=1,firstWeekFreeDraws=7,laterWeekFreeDraws=7,tickets=0}){
let completedMass=0,weekMoment=0,expenseMoment=0,drawMoment=0,
freeMoment=0,ticketMoment=0,paidSwitchMoment=0,freeSwitchMoment=0,roundMoment=0;
const surplusMoments=Object.fromEntries(RELICS.map(id=>[id,0]));
const perWeek=Array(weeks).fill(0);
function collect(s,complete,week){
expenseMoment+=s.p*s.cost;drawMoment+=s.p*s.draws;
freeMoment+=s.p*s.freeTotal;ticketMoment+=s.p*s.ticketTotal;
paidSwitchMoment+=s.p*s.paidSwitchTotal;freeSwitchMoment+=s.p*s.freeSwitchTotal;
roundMoment+=s.p*s.rounds;
for(const id of RELICS) surplusMoments[id]+=s.p*s.surplus[id];
if(complete){completedMass+=s.p;weekMoment+=s.p*week;perWeek[week-1]+=s.p;}
}
function recurse(s,week,round){
if(RELICS.every(id=>s.need[id]===0)){collect(s,true,week);return;}
if(week>weeks){collect(s,false,week);return;}
if(round===roundsPerWeek){recurse({...s,gauge:0,selected:null,mayDiscardGauge:false,freeSwitches:1,freeRemaining:laterWeekFreeDraws},week+1,0);return;}
const target=order.find(id=>s.need[id]>0);
const switching=s.selected!==null && s.selected!==target;
const start=switching?0:s.gauge;
if(switching&&s.gauge>0&&!s.mayDiscardGauge&&!abandonPartialGauge)throw new Error('bad gauge switching');
const freeSwitch=switching&&s.freeSwitches>0;
const paidSwitch=switching&&!freeSwitch;
const switchCost=paidSwitch?300:0;
const base={...s,selected:target,paidSwitchTotal:s.paidSwitchTotal+Number(paidSwitch),
freeSwitchTotal:s.freeSwitchTotal+Number(freeSwitch),
freeSwitches:switching?s.freeSwitches-Number(freeSwitch):s.freeSwitches,
cost:s.cost+switchCost};
function threshold(level,gained,p){
if(level===50){
finalize(50,gained+1,p);
return;
}
if(level===10 && start>=10){threshold(25,gained,p);return;}
if(level===25 && start>=25){threshold(50,gained,p);return;}
const chance=level===10?.2:.4;
if(strategy==='stop-on-target'&&gained>=s.need[target]){finalize(level,gained,p);return;}
threshold(level===10?25:50,gained,p*(1-chance));
const got=gained+1;
if(strategy==='stop-on-target'&&got>=s.need[target])finalize(level,got,p*chance);
else threshold(level===10?25:50,got,p*chance);
}
function finalize(end,gain,p){
const count=end-start,freeUsed=Math.min(s.freeRemaining,count),ticketUsed=Math.min(s.tickets,count-freeUsed);
const credit=Math.min(s.need[target],gain);
const need={...s.need,[target]:s.need[target]-credit};
recurse({...base,need,p:s.p*p,gauge:end===50?0:end,
freeSwitches:end===50?1:base.freeSwitches,mayDiscardGauge:end!==50&&gain>=s.need[target],
freeRemaining:s.freeRemaining-freeUsed,tickets:s.tickets-ticketUsed,
cost:base.cost+(count-freeUsed-ticketUsed)*300,
draws:s.draws+count,freeTotal:s.freeTotal+freeUsed,ticketTotal:s.ticketTotal+ticketUsed,
rounds:s.rounds+1,surplus:{...s.surplus,[target]:s.surplus[target]+gain-credit}},week,round+1);
}
threshold(start<10?10:start<25?25:50,0,1);
}
const beginning=Object.fromEntries(RELICS.map(id=>[id,needs[id]||0]));
recurse({need:beginning,selected:startSelected,gauge:startGauge,mayDiscardGauge:false,freeSwitches:freeSwitchesRemaining,
freeRemaining:firstWeekFreeDraws,tickets,p:1,cost:0,draws:0,freeTotal:0,ticketTotal:0,
paidSwitchTotal:0,freeSwitchTotal:0,rounds:0,surplus:Object.fromEntries(RELICS.map(id=>[id,0]))},1,0);
return {completedMass,weekMoment,expenseMoment,drawMoment,freeMoment,ticketMoment,paidSwitchMoment,
freeSwitchMoment,roundMoment,surplusMoments,perWeek};
}
const cases=[];
for(const needs of [{chalice:1},{chalice:1,medal:1},{chalice:2,medal:1},
{chalice:1,medal:1,wing:1},{chalice:2,medal:2}]) {
for(const strategy of ['stop-on-target','complete-cycle']) {
cases.push({needs,strategy,roundsPerWeek:2,weeks:2,firstWeekFreeDraws:5,laterWeekFreeDraws:7,tickets:3});
cases.push({needs,strategy,roundsPerWeek:3,weeks:1,firstWeekFreeDraws:0,tickets:7});
}
}
cases.push({needs:{chalice:1,medal:1},roundsPerWeek:2,weeks:2,startGauge:25,startSelected:'chalice',tickets:4});
cases.push({needs:{medal:1,wing:1},roundsPerWeek:2,weeks:2,startGauge:49,startSelected:'chalice',abandonPartialGauge:true,freeSwitchesRemaining:0});
for(const [index,setup] of cases.entries()){
const actual=forecast(setup),reference=brute(setup);
near('case'+index+' mass',actual.probabilityFinished,reference.completedMass);
near('case'+index+' spent',actual.expectedDiamondsSpent,reference.expenseMoment);
near('case'+index+' draws',actual.expectedDraws,reference.drawMoment);
near('case'+index+' freebies',actual.expectedFreeDraws,reference.freeMoment);
near('case'+index+' tickets',actual.expectedTicketsUsed,reference.ticketMoment);
near('case'+index+' paidSwitches',actual.expectedPaidSwitches,reference.paidSwitchMoment);
near('case'+index+' freeSwitches',actual.expectedFreeSwitches,reference.freeSwitchMoment);
near('case'+index+' rounds',actual.expectedRounds,reference.roundMoment);
for(const relic of RELICS)near('case'+index+' surplus '+relic+'',actual.expectedSurplusByRelic[relic],reference.surplusMoments[relic]);
if(actual.completedGuarantee)near('case'+index+' week',actual.expectedCompletionWeek,reference.weekMoment);
for(let w=0;w<setup.weeks;w++)near('case'+index+' week mass '+w+'',actual.exactWeek[w].probability,reference.perWeek[w]);
}
console.log('PASS '+checks+' multi-stop probability checks');
