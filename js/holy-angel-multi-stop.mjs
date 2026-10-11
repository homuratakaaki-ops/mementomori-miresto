export const RELICS = Object.freeze(['chalice', 'medal', 'wing', 'fruit']);
export const CHECKPOINT_DISTRIBUTION = Object.freeze([
Object.freeze({at10:0,at25:0,probability:0.48}),
Object.freeze({at10:1,at25:0,probability:0.12}),
Object.freeze({at10:0,at25:1,probability:0.32}),
Object.freeze({at10:1,at25:1,probability:0.08}),
]);
function integer(name, value, maximum) {
if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
throw new RangeError(name+' must be an integer from 0 to '+maximum);
}
}
function cloneCounts(source) { return Object.fromEntries(RELICS.map(k => [k, source[k]])); }
function initialSurplus() { return Object.fromEntries(RELICS.map(k => [k, 0])); }
function firstNeeded(needs, order) { return order.find(k => needs[k] > 0) ?? null; }
function stateKey(s) {
return JSON.stringify([RELICS.map(k => s.needs[k]), s.tickets, s.free,
s.freeSwitches, s.selected, s.gauge, s.mayDiscardGauge]);
}
function mergeStates(destination, state) {
const key = stateKey(state);
const previous = destination.get(key);
if (!previous) { destination.set(key, state); return; }
for (const k of ['probability','costMoment','drawMoment','freeMoment',
'ticketMoment','paidSwitchMoment','freeSwitchMoment','roundMoment']) {
previous[k] += state[k];
}
for (const k of RELICS) previous.surplusMoment[k] += state.surplusMoment[k];
previous.maximumCost = Math.max(previous.maximumCost, state.maximumCost);
}
function newState(needs, tickets, free, freeSwitches, selected, gauge) {
return {
needs, tickets, free, freeSwitches, selected, gauge, mayDiscardGauge:false,
probability:1, costMoment:0, drawMoment:0, freeMoment:0, ticketMoment:0,
paidSwitchMoment:0, freeSwitchMoment:0, roundMoment:0,
surplusMoment:initialSurplus(), maximumCost:0
};
}
function enumerateAttempt(state, relic, strategy, abandonPartialGauge) {
const switching = state.selected !== null && state.selected !== relic;
if (switching && state.gauge > 0 && !state.mayDiscardGauge && !abandonPartialGauge) {
throw new Error('Switching from a partial gauge requires abandonPartialGauge=true');
}
const startingGauge = switching ? 0 : state.gauge;
const freeSwitch = switching && state.freeSwitches > 0;
const paidSwitch = switching && !freeSwitch;
const switchCost = paidSwitch ? 300 : 0;
const eligible10 = startingGauge < 10;
const eligible25 = startingGauge < 25;
const outcomes = [];
for (const outcome of CHECKPOINT_DISTRIBUTION) {
if (!eligible10 && outcome.at10) continue;
if (!eligible25 && outcome.at25) continue;
const probability = (eligible10 ? (outcome.at10 ? .2 : .8) : 1) *
(eligible25 ? (outcome.at25 ? .4 : .6) : 1);
let gained = 0, end = 50;
if (eligible10) {
gained += outcome.at10;
if (strategy === 'stop-on-target' && gained >= state.needs[relic]) end = 10;
}
if (end === 50 && eligible25) {
gained += outcome.at25;
if (strategy === 'stop-on-target' && gained >= state.needs[relic]) end = 25;
}
if (end === 50) gained += 1;
const draws = end - startingGauge;
const freeUsed = Math.min(draws, state.free);
const ticketsUsed = Math.min(draws-freeUsed, state.tickets);
const diamonds = (draws-freeUsed-ticketsUsed)*300 + switchCost;
const credited = Math.min(gained, state.needs[relic]);
const weight = state.probability * probability;
const surplusMoment = Object.fromEntries(RELICS.map(key => [key, state.surplusMoment[key] * probability]));
surplusMoment[relic] += weight * (gained - credited);
outcomes.push({
needs:{...state.needs, [relic]:state.needs[relic]-credited},
selected:relic,
gauge:end === 50 ? 0 : end,
mayDiscardGauge:end !== 50 && credited === state.needs[relic],
freeSwitches:end === 50 ? 1 : (switching ? state.freeSwitches - Number(freeSwitch) : state.freeSwitches),
free:state.free-freeUsed, tickets:state.tickets-ticketsUsed,
probability:weight,
costMoment:state.costMoment*probability + weight*diamonds,
drawMoment:state.drawMoment*probability + weight*draws,
freeMoment:state.freeMoment*probability + weight*freeUsed,
ticketMoment:state.ticketMoment*probability + weight*ticketsUsed,
paidSwitchMoment:state.paidSwitchMoment*probability + weight*Number(paidSwitch),
freeSwitchMoment:state.freeSwitchMoment*probability + weight*Number(freeSwitch),
roundMoment:state.roundMoment*probability + weight,
surplusMoment, maximumCost:state.maximumCost+diamonds
});
}
return outcomes;
}
function emptyTotals() {
return {probability:0, costMoment:0, drawMoment:0, freeMoment:0,
ticketMoment:0, paidSwitchMoment:0, freeSwitchMoment:0, roundMoment:0,
surplusMoment:initialSurplus(), maximumCost:0};
}
function totalInto(totals, state) {
for (const k of ['probability','costMoment','drawMoment','freeMoment',
'ticketMoment','paidSwitchMoment','freeSwitchMoment','roundMoment']) totals[k] += state[k];
for (const k of RELICS) totals.surplusMoment[k] += state.surplusMoment[k];
totals.maximumCost = Math.max(totals.maximumCost,state.maximumCost);
}
export function forecastMultiRelicWithStopping({
needs, order=RELICS, strategy='stop-on-target', roundsPerWeek=1, weeks=1,
startGauge=0, startSelected=null, abandonPartialGauge=false,
freeSwitchesRemaining=1, firstWeekFreeDraws=7, laterWeekFreeDraws=7,
tickets=0
}) {
if (!needs || typeof needs !== 'object' || Array.isArray(needs)) throw new TypeError('needs must be an object');
if (Object.keys(needs).some(k => !RELICS.includes(k))) throw new RangeError('Unknown relic ID in needs');
if (!Array.isArray(order) || order.length !== 4 || new Set(order).size !== 4 ||
order.some(k => !RELICS.includes(k))) throw new RangeError('order must contain four distinct relic IDs');
if (!['stop-on-target','complete-cycle'].includes(strategy)) throw new RangeError('Unknown strategy');
const deficits = {};
for (const id of RELICS) { const n = needs[id] ?? 0; integer('needs.'+id,n,50); deficits[id] = n; }
integer('roundsPerWeek',roundsPerWeek,3);
if (roundsPerWeek === 0) throw new RangeError('roundsPerWeek must be at least 1');
integer('weeks',weeks,26);
if (weeks === 0) throw new RangeError('weeks must be at least 1');
integer('startGauge',startGauge,49);
integer('freeSwitchesRemaining',freeSwitchesRemaining,1);
integer('firstWeekFreeDraws',firstWeekFreeDraws,7);
integer('laterWeekFreeDraws',laterWeekFreeDraws,7);
integer('tickets',tickets,1_000_000);
if (typeof abandonPartialGauge !== 'boolean') throw new TypeError('abandonPartialGauge must be boolean');
if (startSelected !== null && !RELICS.includes(startSelected)) throw new RangeError('startSelected must be a known relic ID');
if (startGauge > 0 && startSelected === null) throw new RangeError('startSelected is required with a partial gauge');
if (startGauge > 0 && deficits[startSelected] === 0 && firstNeeded(deficits,order) !== null && !abandonPartialGauge) {
throw new Error('Partial gauge must be explicitly abandoned to change selected relic');
}
const first = firstNeeded(deficits,order);
if (!first) return {
assumption:'independent 10/25 checkpoints; week-end free draws; user-chosen ordered attempts',
strategy, roundsPerWeek, exactWeek:[{week:0,probability:1,cumulativeProbability:1}],
probabilityFinished:1, probabilityUnfinished:0, completedGuarantee:true,
expectedCompletionWeek:0, expectedDiamondsSpent:0, expectedDiamondsToComplete:0,
worstCaseDiamondsToComplete:0, expectedDraws:0, expectedFreeDraws:0,
expectedTicketsUsed:0, expectedPaidSwitches:0, expectedFreeSwitches:0,
expectedRounds:0, expectedSurplusByRelic:initialSurplus()
};
let states = new Map();
const origin = newState(deficits,tickets,firstWeekFreeDraws,freeSwitchesRemaining,startSelected,startGauge);
states.set(stateKey(origin),origin);
const finishedTotals = emptyTotals();
let finishedProbability=0, expectedWeek=0, maxCostFinished=0;
const exactWeek=[];
const MAX_STATES=25_000;
for (let week=1; week<=weeks; week++) {
if (week>1) {
const reset = new Map();
for (const state of states.values()) mergeStates(reset,{
...state, selected:null,gauge:0,mayDiscardGauge:false,free:laterWeekFreeDraws,freeSwitches:1
});
states=reset;
}
let finishedWeek=0;
for (let attempt=0; attempt<roundsPerWeek; attempt++) {
if (!states.size) break;
const next = new Map();
for (const state of states.values()) {
const focus = firstNeeded(state.needs,order);
if (!focus) throw new Error('Internal forecast error: completed plan in active state');
for (const outcome of enumerateAttempt(state,focus,strategy,abandonPartialGauge)) {
if (firstNeeded(outcome.needs,order) === null) {
finishedWeek += outcome.probability;
totalInto(finishedTotals,outcome);
expectedWeek += outcome.probability*week;
maxCostFinished=Math.max(maxCostFinished,outcome.maximumCost);
} else mergeStates(next,outcome);
}
}
states=next;
if (states.size>MAX_STATES) throw new RangeError('Forecast too complex; reduce weeks or relic targets (no approximation used)');
}
finishedProbability+=finishedWeek;
exactWeek.push({week, probability:finishedWeek,cumulativeProbability:Math.min(1,finishedProbability)});
}
const unfinishedTotals=emptyTotals();
for(const state of states.values()) totalInto(unfinishedTotals,state);
if (Math.abs(finishedProbability+unfinishedTotals.probability-1)>1e-9) {
throw new Error('Probability mass does not sum to one');
}
const guarantee=unfinishedTotals.probability<1e-9;
const add=(field)=>finishedTotals[field]+unfinishedTotals[field];
return {
assumption:'independent 10/25 checkpoints; week-end free draws; user-chosen ordered attempts',
strategy, roundsPerWeek, exactWeek, probabilityFinished:finishedProbability,
probabilityUnfinished:unfinishedTotals.probability,completedGuarantee:guarantee,
expectedCompletionWeek:guarantee?expectedWeek:null,
expectedDiamondsSpent:add('costMoment'), expectedDiamondsToComplete:guarantee?add('costMoment'):null,
worstCaseDiamondsToComplete:guarantee?maxCostFinished:null,
expectedDraws:add('drawMoment'), expectedFreeDraws:add('freeMoment'),
expectedTicketsUsed:add('ticketMoment'),expectedPaidSwitches:add('paidSwitchMoment'),
expectedFreeSwitches:add('freeSwitchMoment'), expectedRounds:add('roundMoment'),
expectedSurplusByRelic:Object.fromEntries(RELICS.map(k=>[k,
finishedTotals.surplusMoment[k]+unfinishedTotals.surplusMoment[k]]))
};
}
