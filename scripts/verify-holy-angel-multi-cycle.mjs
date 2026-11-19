import assert from 'node:assert/strict';
import {forecastMultiRelicFullCycles as forecast, HOLY_ANGEL_RELIC_IDS as TYPES} from '../js/holy-angel-multi-cycle.mjs';
let checks=0;
const near=(label,a,b,eps=1e-7)=>{assert.ok(a!==null&&Math.abs(a-b)<=eps,`${label}: got ${a} instead of ${b}`);checks++;};
const equal=(label,a,b)=>{assert.deepEqual(a,b,label);checks++;};
const invalid=(label,fn,pattern)=>{assert.throws(fn,pattern,label);checks++;};
const f=(needs,opts={})=>forecast({needs,...opts});

// Known hand-worked, independent of the implementation's state/moment merging.
const m=f({chalice:1,medal:1},{cyclesPerWeek:2,weeks:1});
near('two distinct: guaranteed same week',m.probabilityFinished,1);
near('two distinct: 100 draws',m.expectedDraws,100);
near('two distinct: 7 free once',m.expectedFreeDraws,7);
near('two distinct: 27,900 diamonds',m.expectedDiamondsToComplete,27900);
near('two distinct: 1.6 relics avg each',m.expectedSurplusByRelic.chalice,0.6);
near('two distinct: free switch',m.expectedFreeSwitches,1);
const four=f({chalice:1,medal:1,wing:1,fruit:1},{cyclesPerWeek:2,weeks:2});
near('four types: week one not complete',four.exactWeek[0].probability,0);
near('four types: week two guaranteed',four.exactWeek[1].cumulativeProbability,1);
near('four types: 200 draws',four.expectedDraws,200);
near('four types: 14 free total',four.expectedFreeDraws,14);
near('four types: 55,800 diamonds',four.expectedDiamondsToComplete,55800);
const twoOne=f({chalice:2,medal:1},{cyclesPerWeek:2,weeks:2});
near('two+one: first week 52%',twoOne.exactWeek[0].probability,0.52);
near('two+one: second week 100%',twoOne.exactWeek[1].cumulativeProbability,1);
near('two+one: average 1.48 weeks',twoOne.expectedCompletionWeek,1.48);
near('two+one: 34,092 diamonds',twoOne.expectedDiamondsToComplete,34092);
near('two+one: 124 draws',twoOne.expectedDraws,124);
const twoOneFast=f({chalice:2,medal:1},{cyclesPerWeek:3,weeks:1});
near('up to three cycles same week: guaranteed',twoOneFast.exactWeek[0].cumulativeProbability,1);
near('three-cycle plan 35,100 diamonds',twoOneFast.expectedDiamondsToComplete,35100);
const incomplete=f({chalice:2,medal:1},{cyclesPerWeek:2,weeks:1});
near('unfinished probability 48%',incomplete.probabilityUnfinished,0.48);
equal('unfinished cannot claim completion cost',incomplete.expectedDiamondsToComplete,null);
equal('unfinished cannot claim completion week',incomplete.expectedCompletionWeek,null);
near('horizon spending includes incomplete paths',incomplete.expectedDiamondsSpent,27900);
const p25=f({chalice:1},{cyclesPerWeek:1,weeks:1,startGauge:25,startSelected:'chalice'});
near('gauge25 to50 exactly25 draws',p25.expectedDraws,25);
near('gauge25 no repeated earlier rewards',p25.expectedSurplusByRelic.chalice,0);
near('gauge25 use at most available free 7',p25.expectedDiamondsToComplete,5400);
const p10=f({chalice:1},{startGauge:10,startSelected:'chalice'});
near('gauge10 to50 exactly40 draws',p10.expectedDraws,40);
near('gauge10 only 25 checkpoint has 40%',p10.expectedSurplusByRelic.chalice,0.4);
const p49=f({chalice:1},{startGauge:49,startSelected:'chalice'});
near('gauge49 one free draw',p49.expectedDraws,1);
near('gauge49 no required diamonds when free remains',p49.expectedDiamondsToComplete,0);
near('gauge49 used free and no tickets',f({chalice:1},{startGauge:49,startSelected:'chalice',firstWeekFreeDraws:0}).expectedDiamondsToComplete,300);
invalid('nonmatching partial gauge rejected',()=>f({wing:1},{startGauge:49,startSelected:'chalice'}),/abandonPartialGauge/);
near('explicit abandonment and paid switch 300',f({wing:1},{startGauge:49,startSelected:'chalice',abandonPartialGauge:true,freeSwitchesRemaining:0}).expectedDiamondsToComplete,13200);
near('explicit abandonment and free switch',f({wing:1},{startGauge:49,startSelected:'chalice',abandonPartialGauge:true,freeSwitchesRemaining:1}).expectedDiamondsToComplete,12900);
near('one relic with 20 tickets',f({chalice:1},{tickets:20}).expectedDiamondsToComplete,6900);
near('two distinct relics 20 shared tickets',f({chalice:1,medal:1},{cyclesPerWeek:2,weeks:1,tickets:20}).expectedDiamondsToComplete,21900);
near('first week zero free',f({chalice:1,medal:1},{cyclesPerWeek:2,weeks:1,firstWeekFreeDraws:0}).expectedDiamondsToComplete,30000);
near('zero targets',f({}).probabilityFinished,1);
invalid('unknown relic',()=>f({abc:1}),/Unknown relic/);
invalid('invalid cycles per week',()=>f({chalice:1},{cyclesPerWeek:4}),/cyclesPerWeek/);
invalid('negative needs',()=>f({chalice:-1}),/needs.chalice/);
invalid('noninteger needs',()=>f({chalice:0.3}),/needs.chalice/);
invalid('missing selected when partial',()=>f({chalice:1},{startGauge:4}),/startSelected/);
invalid('duplicate order',()=>f({chalice:1},{order:['chalice','chalice','wing','fruit']}),/order/);
invalid('free counts 8',()=>f({chalice:1},{firstWeekFreeDraws:8}),/firstWeekFreeDraws/);
invalid('no weeks',()=>f({chalice:1},{weeks:0}),/weeks/);

// Brute-force paths, no merging of outcomes and no reuse of production logic.
const allOutcomes=[{g:1,p:.48,a:0,b:0},{g:2,p:.12,a:1,b:0},{g:2,p:.32,a:0,b:1},{g:3,p:.08,a:1,b:1}];
function brute({needs,order=TYPES,cyclesPerWeek=2,weeks=2,startGauge=0,
  startSelected=null,freeSwitchesRemaining=1,abandonPartialGauge=false,
  firstWeekFreeDraws=7,laterWeekFreeDraws=7,tickets=0}){
  let totals={finished:0,spent:0,draws:0,free:0,ticket:0,week:0,surplus:Object.fromEntries(TYPES.map(k=>[k,0]))};
  const begin=Object.fromEntries(TYPES.map(k=>[k,needs[k]||0]));
  function step(state,week,cycle){
    if(TYPES.every(k=>state.rem[k]===0)){
      totals.finished+=state.prob;totals.spent+=state.prob*state.cost;
      totals.draws+=state.prob*state.draws;totals.free+=state.prob*state.free;
      totals.ticket+=state.prob*state.taken;totals.week+=state.prob*week;
      for(const k of TYPES)totals.surplus[k]+=state.prob*state.surplus[k];return;
    }
    if(week>weeks){
      totals.spent+=state.prob*state.cost;totals.draws+=state.prob*state.draws;
      totals.free+=state.prob*state.free;totals.ticket+=state.prob*state.taken;
      for(const k of TYPES)totals.surplus[k]+=state.prob*state.surplus[k];return;
    }
    if(cycle>=cyclesPerWeek){step({...state,gauge:0,credit:1,freeLeft:laterWeekFreeDraws},week+1,0);return;}
    const target=order.find(k=>state.rem[k]>0);
    const switching=state.selected!==null&&state.selected!==target;
    const gauge=switching?0:state.gauge;
    const chargedSwitch=switching&&state.credit===0?300:0;
    const draw=50-gauge;
    const freebies=Math.min(draw,state.freeLeft);
    const ticketUsed=Math.min(draw-freebies,state.ticketLeft);
    const cost=(draw-freebies-ticketUsed)*300+chargedSwitch;
    for(const o of allOutcomes){
      if(gauge>=10&&o.a===1)continue;
      if(gauge>=25&&o.b===1)continue;
      const chance=(gauge<10?(o.a===1?.2:.8):1)*(gauge<25?(o.b===1?.4:.6):1);
      const reward=1+(gauge<10?o.a:0)+(gauge<25?o.b:0);
      const consumed=Math.min(state.rem[target],reward);
      const rem={...state.rem,[target]:state.rem[target]-consumed};
      const surplus={...state.surplus,[target]:state.surplus[target]+reward-consumed};
      step({rem,surplus,prob:state.prob*chance,cost:state.cost+cost,draws:state.draws+draw,
        free:state.free+freebies,taken:state.taken+ticketUsed,ticketLeft:state.ticketLeft-ticketUsed,
        freeLeft:state.freeLeft-freebies,credit:1,gauge:0,selected:target},week,cycle+1);
    }
  }
  step({rem:begin,surplus:Object.fromEntries(TYPES.map(k=>[k,0])),prob:1,cost:0,draws:0,
    free:0,taken:0,ticketLeft:tickets,freeLeft:firstWeekFreeDraws,
    credit:freeSwitchesRemaining,gauge:startGauge,selected:startSelected},1,0);
  return totals;
}
for (const setup of [
  {needs:{chalice:2,medal:1},cyclesPerWeek:2,weeks:2},
  {needs:{chalice:2,medal:1,wing:1},cyclesPerWeek:3,weeks:2},
  {needs:{chalice:3,medal:2,wing:1,fruit:1},cyclesPerWeek:3,weeks:3,tickets:21,firstWeekFreeDraws:2,laterWeekFreeDraws:5},
  {needs:{chalice:2,wing:1},cyclesPerWeek:2,weeks:2,startGauge:25,startSelected:'chalice',tickets:7,firstWeekFreeDraws:0},
  {needs:{wing:2,medal:1},cyclesPerWeek:2,weeks:2,startGauge:49,startSelected:'chalice',abandonPartialGauge:true,freeSwitchesRemaining:0,tickets:9}
]){
  const a=forecast(setup),b=brute(setup);
  near('enumeration finished mass',a.probabilityFinished,b.finished);
  near('enumeration spent',a.expectedDiamondsSpent,b.spent);
  near('enumeration draws',a.expectedDraws,b.draws);
  near('enumeration freebies',a.expectedFreeDraws,b.free);
  near('enumeration tickets',a.expectedTicketsUsed,b.ticket);
  if(a.completedGuarantee)near('enumeration mean week',a.expectedCompletionWeek,b.week);
  for(const k of TYPES)near('enumeration '+k+' surplus',a.expectedSurplusByRelic[k],b.surplus[k]);
}
console.log('PASS '+checks+' multi-relic full-cycle checks');
