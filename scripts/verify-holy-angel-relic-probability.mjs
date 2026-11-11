import assert from 'node:assert/strict';
import {forecastSingleRelic} from '../js/holy-angel-relic-probability.mjs';

let checks=0;
function close(label,a,b,tol=1e-8) {
  assert.ok(Math.abs(a-b)<tol,`${label}: expected ${b} got ${a}`);checks++;
}
function eq(label,a,b){assert.deepEqual(a,b,label);checks++;}
function throws(label,fn,pattern){assert.throws(fn,pattern,label);checks++;}

const f=(n,strategy='stop-on-target',other={})=>forecastSingleRelic({requiredRelics:n,strategy,...other});
const one=f(1), two=f(2), full=f(2,'complete-cycle');
eq('assumption flag',one.assumption,'independent 10/25 reward checkpoints');
close('single one average draws',one.expectedDraws,34);
close('single one expected cost week-end 7 free',one.expectedDiamonds,8100);
close('one week when 1 selected relic needed',one.exactWeek[0].cumulativeProbability,1);
close('two expected draws stop',two.expectedDraws,64.32);
close('two expected diamonds stop',two.expectedDiamonds,16188);
close('two expected weeks',two.expectedCompletionWeek,1.48);
close('two week one completion',two.exactWeek[0].probability,0.52);
close('two week two completion',two.exactWeek[1].probability,0.48);
close('two cumulative completion',two.exactWeek[1].cumulativeProbability,1);
close('two no unfinished probability',two.probabilityUnfinished,0);
close('two full cycle average draws',full.expectedDraws,74);
close('two full cycle expected diamonds',full.expectedDiamonds,19092);
close('two full cycle guarantee worst cost',full.worstCaseDiamonds,25800);
close('two full cycles have positive surplus',full.expectedSurplusRelics,0.368);
close('stop has zero surplus',two.expectedSurplusRelics,0);
close('free0 means draws *300',f(2,'stop-on-target',{freeDrawsPerWeek:0}).expectedDiamonds,64.32*300);
close('free7 consumed first week0',f(1,'stop-on-target',{freeDrawsFirstWeek:0}).expectedDiamonds,34*300);
close('20 tickets first week',f(1,'complete-cycle',{tickets:20}).expectedDiamonds,(50-7-20)*300);
close('tickets used once, not each week',f(2,'complete-cycle',{tickets:20}).expectedDiamonds,
  (50-7-20)*300 + 0.48*(50-7)*300);
close('complete 1 always finish cycle',f(1,'complete-cycle').expectedDraws,50);
close('complete 1 expected extra relics',f(1,'complete-cycle').expectedSurplusRelics,0.6);
eq('already enough means no action',f(0).expectedDraws,0);
throws('bad strategy',()=>f(1,'invented'),/strategy/);
throws('negative requirement',()=>f(-1),/requiredRelics/);
throws('fractional requirement',()=>f(1.5),/requiredRelics/);
throws('free >7',()=>f(1,'stop-on-target',{freeDrawsPerWeek:8}),/freeDrawsPerWeek/);
throws('noninteger tickets',()=>f(1,'stop-on-target',{tickets:0.5}),/tickets/);

// Reference independent enumeration for small N, without the DP/moment merging
// used by the production implementation.
function reference(required,strategy,weeklyFree,firstFree,tickets){
  const result={prob:0,cost:0,draws:0,weeks:0,surplus:0};
  function recur(owned,week,leftTickets,p,spent,drawTotal){
    if(owned>=required){result.prob+=p;result.cost+=spent*p;result.draws+=drawTotal*p;
      result.weeks+=week*p;result.surplus+=(owned-required)*p;return;}
    const free=week===0?firstFree:weeklyFree;
    for(const [a,pa] of [[0,0.8],[1,0.2]]){
      for(const [b,pb] of [[0,0.6],[1,0.4]]){
        let count=a+b+1,draws=50;
        if(strategy==='stop-on-target'){
          if(owned+a>=required){count=a;draws=10;}
          else if(owned+a+b>=required){count=a+b;draws=25;}
        }
        const f=Math.min(free,draws), t=Math.min(leftTickets,draws-f);
        const added=(draws-f-t)*300;
        recur(owned+count,week+1,leftTickets-t,p*pa*pb,spent+added,drawTotal+draws);
      }
    }
  }
  recur(0,0,tickets,1,0,0);
  return result;
}
for(let n=1;n<=4;n++) for(const strategy of ['stop-on-target','complete-cycle']) for(const free of [0,3,7]) {
  const actual=f(n,strategy,{freeDrawsPerWeek:free,freeDrawsFirstWeek:free,tickets:5});
  const expected=reference(n,strategy,free,free,5);
  close(`reference cost n=${n} ${strategy} free=${free}`,actual.expectedDiamonds,expected.cost,1e-6);
  close(`reference draws n=${n} ${strategy} free=${free}`,actual.expectedDraws,expected.draws,1e-8);
  close(`reference weeks n=${n} ${strategy} free=${free}`,actual.expectedCompletionWeek,expected.weeks,1e-8);
  close(`reference surplus n=${n} ${strategy} free=${free}`,actual.expectedSurplusRelics,expected.surplus,1e-8);
  close(`reference probability n=${n} ${strategy} free=${free}`,expected.prob,1,1e-8);
}
for(const n of [1,2,5,10,40,70,100]){
  const forecast=f(n,'stop-on-target',{tickets:53});
  let prev=0;
  for(const row of forecast.exactWeek){
    assert.ok(row.cumulativeProbability+1e-12>=prev);
    prev=row.cumulativeProbability;
  }
  checks++;
  close('all mass guaranteed n='+n,forecast.exactWeek.at(-1).cumulativeProbability,1,1e-8);
}
console.log('PASS '+checks+' Holy Angel relic probability checks');
