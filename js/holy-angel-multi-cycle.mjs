/**
 * Sequential four-relic forecasts with whole 50-draw cycles.
 *
 * Strict, deliberately limited model:
 * - User chooses an ordered list of distinct relics and their shortfalls.
 * - One selected relic per completed 50-draw cycle, always finishing the cycle.
 * - Up to cyclesPerWeek completed cycles in a game week (Mon 04 JST reset).
 * - The first cycle can resume a current gauge 0..49. All rewards at
 *   previously reached 10/25 thresholds must already have been claimed.
 * - Free draws are assumed usable ahead of the planned draws within each week
 *   (a week-end schedule). This is NOT a day-by-day clock simulation.
 * - At completion of each cycle, the gauge resets and one free relic switch
 *   becomes available. At the weekly boundary the gauge and free switch reset.
 * - 10/25 checkpoint results are INDEPENDENT for this forecasting model;
 *   game sources do not confirm this independence.
 *
 * No automatic partial-cycle target stopping, no equipment-evolution materials,
 * no actual calendar-day scheduling, no Cloudflare or user-data modification.
 */

export const HOLY_ANGEL_RELIC_IDS = Object.freeze(['chalice','medal','wing','fruit']);
const OUTCOMES = Object.freeze([
  {a:0,b:0,p:0.8*0.6}, {a:1,b:0,p:0.2*0.6},
  {a:0,b:1,p:0.8*0.4}, {a:1,b:1,p:0.2*0.4}
]);
function uint(name, n, max) {
  if (!Number.isSafeInteger(n) || n < 0 || n > max) {
    throw new RangeError(name + ' must be an integer between 0 and ' + max);
  }
}
function amount(name, n) { uint(name,n,1_000_000); }
function currentIndex(rem,order) { return order.find(key=>rem[key]>0) ?? null; }
function moments() { return {p:0,cost:0,draws:0,free:0,tickets:0,switches:0,
  surplus:Object.fromEntries(HOLY_ANGEL_RELIC_IDS.map(k=>[k,0])),maxCost:0}; }
function key(state) {return JSON.stringify([
  HOLY_ANGEL_RELIC_IDS.map(k=>state.remaining[k]),state.ticketsRemaining,
  state.freeRemaining,state.freeSwitchRemaining,state.selected,state.gauge
]);}
function merge(map,state){
  const k=key(state);
  const old=map.get(k);
  if(!old){map.set(k,state);return;}
  for(const f of ['p','cost','draws','free','tickets','switches']) old[f]+=state[f];
  for(const relic of HOLY_ANGEL_RELIC_IDS) old.surplus[relic]+=state.surplus[relic];
  old.maxCost=Math.max(old.maxCost,state.maxCost);
}
function advance(state,relic,draws,gains,p,switchCost,switchFree) {
  const freeUsed=Math.min(state.freeRemaining,draws);
  const ticketUsed=Math.min(state.ticketsRemaining,draws-freeUsed);
  const diamond=(draws-freeUsed-ticketUsed)*300+switchCost;
  const w=state.p*p;
  const missing=state.remaining[relic],credited=Math.min(missing,gains);
  const surplus=Object.fromEntries(HOLY_ANGEL_RELIC_IDS.map(k=>[k,state.surplus[k]*p]));
  surplus[relic]+=w*(gains-credited);
  return {
    remaining:{...state.remaining,[relic]:missing-credited},
    selected:relic,gauge:0,freeSwitchRemaining:1,
    ticketsRemaining:state.ticketsRemaining-ticketUsed,
    freeRemaining:state.freeRemaining-freeUsed,
    p:w,cost:state.cost*p+w*diamond,draws:state.draws*p+w*draws,
    free:state.free*p+w*freeUsed,tickets:state.tickets*p+w*ticketUsed,
    switches:state.switches*p+w*(switchFree?1:0),
    surplus,maxCost:state.maxCost+diamond
  };
}

/**
 * Forecasts costs spent within the requested week horizon.
 * Completion averages are returned ONLY if all probability mass finishes.
 * @param {object} plan
 * @param {object} plan.needs -- deficits by relic; unspecified keys mean zero.
 * @param {string[]} plan.order -- priority order, exactly four unique relic ids.
 * @param {number} plan.cyclesPerWeek -- 1..3 complete cycles allowed per week.
 * @param {number} plan.weeks -- 1..52, finite horizon to display.
 * @param {number} plan.startGauge -- 0..49, rewards already claimed.
 * @param {string} [plan.startSelected] -- actual relic selected in partial cycle.
 * @param {boolean} [plan.abandonPartialGauge=false] -- explicit forfeiture if switching.
 * @param {number} [plan.freeSwitchesRemaining=1] -- 0 or 1.
 * @param {number} [plan.firstWeekFreeDraws=7] -- 0..7, includes only unused free days.
 * @param {number} [plan.laterWeekFreeDraws=7] -- 0..7.
 * @param {number} [plan.tickets=0] -- shared ticket stock, consumed once.
 */
export function forecastMultiRelicFullCycles({
  needs, order=HOLY_ANGEL_RELIC_IDS, cyclesPerWeek=1,weeks=1,
  startGauge=0,startSelected=null,abandonPartialGauge=false,
  freeSwitchesRemaining=1,firstWeekFreeDraws=7,laterWeekFreeDraws=7,
  tickets=0
}) {
  if(!needs || typeof needs!=='object' || Array.isArray(needs)) throw new TypeError('needs must be an object');
  if(!Array.isArray(order) || order.length!==4 || new Set(order).size!==4 ||
      order.some(k=>!HOLY_ANGEL_RELIC_IDS.includes(k))) throw new RangeError('order must include four distinct relic IDs');
  if(Object.keys(needs).some(k=>!HOLY_ANGEL_RELIC_IDS.includes(k))) throw new RangeError('Unknown relic');
  const remaining={};for(const k of HOLY_ANGEL_RELIC_IDS){amount('needs.'+k,needs[k]??0);remaining[k]=needs[k]??0;}
  uint('cyclesPerWeek',cyclesPerWeek,3);if(cyclesPerWeek===0)throw new RangeError('cyclesPerWeek must be 1..3');
  uint('weeks',weeks,52);if(weeks===0)throw new RangeError('weeks must be 1..52');
  uint('startGauge',startGauge,49);
  uint('freeSwitchesRemaining',freeSwitchesRemaining,1);
  uint('firstWeekFreeDraws',firstWeekFreeDraws,7);
  uint('laterWeekFreeDraws',laterWeekFreeDraws,7);
  amount('tickets',tickets);
  if(typeof abandonPartialGauge!=='boolean') throw new TypeError('abandonPartialGauge must be boolean');
  if(startSelected!==null&&!HOLY_ANGEL_RELIC_IDS.includes(startSelected))throw new RangeError('startSelected must be a relic ID or null');
  if(startGauge>0&&startSelected===null)throw new RangeError('startSelected is needed for a partial gauge');
  const first=currentIndex(remaining,order);
  if(startGauge>0 && startSelected!==first && !abandonPartialGauge && first!==null){
    throw new Error('Partial gauge targets another relic: explicit abandonPartialGauge required');
  }
  if(first===null){const surplus=Object.fromEntries(HOLY_ANGEL_RELIC_IDS.map(k=>[k,0]));
    return {assumption:'independent 10/25; complete 50-draw cycles; week-end free use',
      exactWeek:[{week:0,probability:1,cumulativeProbability:1}],
      probabilityFinished:1,probabilityUnfinished:0,expectedCompletionWeek:0,
      expectedDiamondsSpent:0,expectedDiamondsToComplete:0,worstCaseDiamondsToComplete:0,
      expectedDraws:0,expectedFreeDraws:0,expectedTicketsUsed:0,
      expectedFreeSwitches:0,expectedSurplusByRelic:surplus,completedGuarantee:true};}
  let active=new Map();
  const initial={remaining,selected:startSelected,gauge:startGauge,
    ticketsRemaining:tickets,freeRemaining:firstWeekFreeDraws,
    freeSwitchRemaining:freeSwitchesRemaining, ...moments()};initial.p=1;
  active.set(key(initial),initial);
  const totals=moments();
  const exactWeek=[];
  let finishedProbability=0,expectedWeek=0,largestFinishedCost=0;
  for(let week=1;week<=weeks;week++){
    if(week>1){let weekly=new Map();
      for(const st of active.values()){
        const copy={...st,gauge:0,freeRemaining:laterWeekFreeDraws,freeSwitchRemaining:1};
        merge(weekly,copy);
      }
      active=weekly;
    }
    let doneHere=0;
    for(let cycle=0;cycle<cyclesPerWeek;cycle++){
      if(active.size===0)break;
      const next=new Map();
      for(const st of active.values()){
        const relic=currentIndex(st.remaining,order);
        if(relic===null)throw new Error('internal: completed path left in active states');
        const switching=st.selected!==null && st.selected!==relic;
        const switchingFromPartial=switching&&st.gauge>0;
        if(switchingFromPartial && !abandonPartialGauge){
          throw new Error('Partial gauge has no current target; cannot switch automatically');
        }
        const switchFree=switching && st.freeSwitchRemaining>0;
        const switchCost=switching && !switchFree ? 300:0;
        const gauge=switching?0:st.gauge;
        const length=50-gauge;
        const eligible10=gauge<10,eligible25=gauge<25;
        // Probability mass for already passed milestone rewards is 1, not a resampling.
        for(const outcome of OUTCOMES){
          if(!eligible10&&outcome.a!==0)continue;
          if(!eligible25&&outcome.b!==0)continue;
          const p=(eligible10?(outcome.a?0.2:0.8):1) *
                  (eligible25?(outcome.b?0.4:0.6):1);
          const gains=1+outcome.a+outcome.b;
          const result=advance(st,relic,length,gains,p,switchCost,switchFree);
          if(currentIndex(result.remaining,order)===null){
            doneHere+=result.p;
            totals.p+=result.p;
            for(const f of ['cost','draws','free','tickets','switches'])totals[f]+=result[f];
            for(const k of HOLY_ANGEL_RELIC_IDS)totals.surplus[k]+=result.surplus[k];
            expectedWeek+=result.p*week;
            largestFinishedCost=Math.max(largestFinishedCost,result.maxCost);
          }else merge(next,result);
        }
      }
      active=next;
    }
    finishedProbability+=doneHere;
    exactWeek.push({week,probability:doneHere,cumulativeProbability:Math.min(1,finishedProbability)});
  }
  const unfinished=[...active.values()].reduce((acc,st)=>acc+st.p,0);
  const spentCost=totals.cost+[...active.values()].reduce((acc,st)=>acc+st.cost,0);
  const expectedDraws=totals.draws+[...active.values()].reduce((acc,st)=>acc+st.draws,0);
  const expectedFreeDraws=totals.free+[...active.values()].reduce((acc,st)=>acc+st.free,0);
  const expectedTicketsUsed=totals.tickets+[...active.values()].reduce((acc,st)=>acc+st.tickets,0);
  const expectedFreeSwitches=totals.switches+[...active.values()].reduce((acc,st)=>acc+st.switches,0);
  const surplus=Object.fromEntries(HOLY_ANGEL_RELIC_IDS.map(k=>[k,
    totals.surplus[k]+[...active.values()].reduce((acc,st)=>acc+st.surplus[k],0)]));
  if(Math.abs(finishedProbability+unfinished-1)>1e-9) throw new Error('probability mass not conserved');
  const completedGuarantee=unfinished<1e-9;
  return {assumption:'independent 10/25; complete 50-draw cycles; week-end free use',
    exactWeek,probabilityFinished:finishedProbability,probabilityUnfinished:unfinished,
    expectedCompletionWeek:completedGuarantee?expectedWeek:null,
    expectedDiamondsSpent:spentCost,
    expectedDiamondsToComplete:completedGuarantee?spentCost:null,
    worstCaseDiamondsToComplete:completedGuarantee?largestFinishedCost:null,
    expectedDraws,expectedFreeDraws,expectedTicketsUsed,expectedFreeSwitches,
    expectedSurplusByRelic:surplus,completedGuarantee};
}
