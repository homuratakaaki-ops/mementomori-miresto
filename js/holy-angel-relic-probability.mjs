/**
 * Forecast the selected Holy Angel relic's 10/25/50 milestone rewards.
 *
 * IMPORTANT: probabilities assume independent 10- and 25-draw rewards,
 * and independent cycles. The game does not explicitly confirm independence.
 * This exact finite-state model handles ONE selected relic, one fresh
 * 0->50 draw cycle at most each week, and a weekly-end draw schedule.
 * No switching, partially completed gauges, same-week multiple cycles,
 * four-relic allocation, or real calendar-day simulation is included.
 *
 * Source observations: 10 draws 20%, 25 draws 40%, 50 draws 100%,
 * one item awarded at each successful checkpoint.
 */

const OUTCOMES = Object.freeze([
  Object.freeze({at10:false, at25:false, probability:0.8*0.6}),
  Object.freeze({at10:true, at25:false, probability:0.2*0.6}),
  Object.freeze({at10:false, at25:true, probability:0.8*0.4}),
  Object.freeze({at10:true, at25:true, probability:0.2*0.4})
]);
export const RELIC_MILESTONE_MODEL = Object.freeze({
  ten:0.2, twentyFive:0.4, fifty:1, assumptions:'independent-checkpoints-forecast'
});

function integer(name, value, max) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer between 0 and ${max}`);
  }
}

function milestoneDecision(owned, required, strategy, outcome) {
  const n10 = owned + Number(outcome.at10);
  if (strategy === 'stop-on-target' && n10 >= required) {
    return {draws:10, newlyAcquired:Number(outcome.at10)};
  }
  const n25 = n10 + Number(outcome.at25);
  if (strategy === 'stop-on-target' && n25 >= required) {
    return {draws:25, newlyAcquired:Number(outcome.at10)+Number(outcome.at25)};
  }
  return {draws:50, newlyAcquired:1+Number(outcome.at10)+Number(outcome.at25)};
}

/**
 * One selected relic, one 50-draw cycle per game week (Mon 04:00 JST).
 * Free draws are assumed available to use *before* the week's milestone
 * draws finish, i.e. draws are scheduled toward the week's end.
 * Returns exact probability-weighted expectations for this restricted model.
 */
export function forecastSingleRelic({
  requiredRelics,
  strategy='stop-on-target',
  freeDrawsPerWeek=7,
  freeDrawsFirstWeek=freeDrawsPerWeek,
  tickets=0
}) {
  integer('requiredRelics',requiredRelics,100);
  integer('freeDrawsPerWeek',freeDrawsPerWeek,7);
  integer('freeDrawsFirstWeek',freeDrawsFirstWeek,7);
  integer('tickets',tickets,1000000);
  if (!['stop-on-target','complete-cycle'].includes(strategy)) {
    throw new RangeError('strategy must be stop-on-target or complete-cycle');
  }
  if (requiredRelics === 0) {
    return {strategy,requiredRelics,assumption:'independent 10/25 reward checkpoints',
      exactWeek:[{week:0,probability:1,cumulativeProbability:1}],
      probabilityUnfinished:0,expectedCompletionWeek:0,expectedDraws:0,
      expectedDiamonds:0,expectedFreeDraws:0,expectedTicketsUsed:0,
      expectedSurplusRelics:0,worstCaseDiamonds:0};
  }

  // Moments are unconditional probability-weighted cumulative totals.
  // Paths with the same obtained amount + remaining tickets can be merged.
  let active = new Map();
  active.set(`0|${tickets}`, {obtained:0,ticketsRemaining:tickets,p:1,
    cost:0,draws:0,free:0,ticketsUsed:0,maxCost:0});
  const totals = {cost:0,draws:0,free:0,ticketsUsed:0,surplus:0,weeks:0,
    worstCaseDiamonds:0};
  const exactWeek = [];
  let cumulative = 0;

  // Every unfinished 50-draw cycle awards at least one selected relic.
  // Thus requiredRelics cycles guarantee completion under this plan.
  for (let week=1; week<=requiredRelics; week++) {
    const freeAvailable = week === 1 ? freeDrawsFirstWeek : freeDrawsPerWeek;
    const next = new Map();
    let finishedHere = 0;
    for (const item of active.values()) {
      for (const outcome of OUTCOMES) {
        const probability = outcome.probability;
        const {draws,newlyAcquired} = milestoneDecision(item.obtained,requiredRelics,strategy,outcome);
        const obtained = item.obtained + newlyAcquired;
        const free = Math.min(freeAvailable,draws);
        const ticketsUsed = Math.min(item.ticketsRemaining,draws-free);
        const ticketsRemaining = item.ticketsRemaining - ticketsUsed;
        const diamonds = (draws-free-ticketsUsed)*300;
        const p = item.p * probability;
        const cost = probability*(item.cost + item.p*diamonds);
        const drawMoment = probability*(item.draws + item.p*draws);
        const freeMoment = probability*(item.free + item.p*free);
        const ticketMoment = probability*(item.ticketsUsed + item.p*ticketsUsed);
        const maxCost = item.maxCost + diamonds;
        if (obtained >= requiredRelics) {
          finishedHere += p;
          totals.cost += cost;
          totals.draws += drawMoment;
          totals.free += freeMoment;
          totals.ticketsUsed += ticketMoment;
          totals.surplus += p*(obtained-requiredRelics);
          totals.weeks += p*week;
          totals.worstCaseDiamonds = Math.max(totals.worstCaseDiamonds,maxCost);
        } else {
          const key = `${obtained}|${ticketsRemaining}`;
          let state = next.get(key);
          if (!state) {
            state = {obtained,ticketsRemaining,p:0,cost:0,draws:0,
              free:0,ticketsUsed:0,maxCost:0};
            next.set(key,state);
          }
          state.p += p;
          state.cost += cost;
          state.draws += drawMoment;
          state.free += freeMoment;
          state.ticketsUsed += ticketMoment;
          state.maxCost = Math.max(state.maxCost,maxCost);
        }
      }
    }
    cumulative += finishedHere;
    exactWeek.push({week,probability:finishedHere,
      cumulativeProbability:Math.min(1,cumulative)});
    active = next;
    if (active.size === 0) break;
  }
  const unfinished = [...active.values()].reduce((sum,state)=>sum+state.p,0);
  // Prevent silent underestimation if a future change removes the guarantee.
  if (unfinished > 1e-9 || Math.abs(cumulative-1) > 1e-9) {
    throw new Error('Incomplete forecast: probability mass remains after guarantee horizon');
  }
  return {strategy,requiredRelics,assumption:'independent 10/25 reward checkpoints',
    exactWeek,probabilityUnfinished:unfinished,
    expectedCompletionWeek:totals.weeks,expectedDraws:totals.draws,
    expectedDiamonds:totals.cost,expectedFreeDraws:totals.free,
    expectedTicketsUsed:totals.ticketsUsed,
    expectedSurplusRelics:totals.surplus,
    worstCaseDiamonds:totals.worstCaseDiamonds};
}
