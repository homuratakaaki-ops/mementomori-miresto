/** JST game-clock helpers for Holy Angel planning. No browser or network APIs. */
const JST_MS = 9 * 3600000;
const GAME_START_HOUR = 4;
const MS_DAY = 86400000;

/** Strict Japanese local wall-clock timestamp, with minute precision. */
export function parseJstLocal(value) {
  if (typeof value !== 'string') throw new TypeError('JST time must be a string');
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)$/.exec(value);
  if (!m) throw new RangeError('Expected YYYY-MM-DDTHH:mm in JST');
  const [y,mo,d,hh,mm] = m.slice(1).map(Number);
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) throw new RangeError('Invalid JST datetime');
  const localMs = Date.UTC(y,mo-1,d,hh,mm);
  const roundTrip = new Date(localMs).toISOString().slice(0,16);
  if (roundTrip !== value) throw new RangeError('Invalid calendar date');
  return localMs - JST_MS;
}
function isoDay(utcMs) { return new Date(utcMs).toISOString().slice(0,10); }
export function gameDayJst(localDateTime) {
  return isoDay(parseJstLocal(localDateTime) + JST_MS - GAME_START_HOUR*3600000);
}
/** Returns the Monday game-day ID, even between midnight and 03:59 JST. */
export function gameWeekMondayJst(localDateTime) {
  const id = gameDayJst(localDateTime);
  const t = Date.parse(id+'T00:00:00Z');
  const weekday = new Date(t).getUTCDay();
  const back = (weekday + 6) % 7;
  return isoDay(t - back*MS_DAY);
}
/** Monday 04:00 JST, represented as the local wall-clock identifier. */
export function weekStartLabel(localDateTime) {
  return gameWeekMondayJst(localDateTime) + 'T04:00';
}
/** Number of free game-day pulls left this week, assuming future days are used. */
export function remainingFreeThisWeek(localDateTime, {freeUsedThisGameDay=false}={}) {
  if (typeof freeUsedThisGameDay !== 'boolean') throw new TypeError('freeUsedThisGameDay must be boolean');
  const gameDay = gameDayJst(localDateTime);
  const weekday = new Date(gameDay+'T00:00:00Z').getUTCDay();
  const daysUntilSunday = (7-weekday)%7;
  return daysUntilSunday + (freeUsedThisGameDay ? 0 : 1);
}
export function getForecastFreeSchedule(localDateTime,{freeUsedThisGameDay=false,laterWeekFreeDraws=7}={}){
  if (!Number.isSafeInteger(laterWeekFreeDraws) || laterWeekFreeDraws<0 || laterWeekFreeDraws>7) throw new RangeError('laterWeekFreeDraws must be 0..7');
  return {startGameDay:gameDayJst(localDateTime),startWeekMonday:gameWeekMondayJst(localDateTime),
    firstWeekFreeDraws:remainingFreeThisWeek(localDateTime,{freeUsedThisGameDay}),laterWeekFreeDraws,
    note:'Remaining future daily free draws are assumed to be used before weekly attempts finish; not an actual draw-date schedule.'};
}
/**
 * An explicit time-ordered event ledger. This is different from a forecast:
 * every event has an actual planned JST datetime and optional free usage.
 * Weekly free counters are per JST game day (04:00->03:59), not per 50 cycle.
 * Diamonds are attributed to the actual Gregorian JST month of the event.
 */
export function scheduledDrawLedger({startAt,freeUsedThisGameDay=false,tickets=0,events=[]}){
  const startMs=parseJstLocal(startAt);
  if (typeof freeUsedThisGameDay !== 'boolean') throw new TypeError('freeUsedThisGameDay must be boolean');
  if (!Number.isSafeInteger(tickets)||tickets<0||tickets>1000000) throw new RangeError('tickets must be a nonnegative integer');
  if (!Array.isArray(events) || events.length>4000) throw new RangeError('events must be an array of at most 4000');
  const freeDays=new Set(freeUsedThisGameDay?[gameDayJst(startAt)]:[]);
  const rows=[],byMonth={},byWeek={};
  let ticketBalance=tickets,lastMs=startMs,total=0;
  for(const event of events){
    if (!event || typeof event!=='object') throw new TypeError('Each event must be an object');
    const at=event.at;
    const ms=parseJstLocal(at);
    if(ms<startMs || ms<lastMs) throw new RangeError('Events must be chronological and not before startAt');
    const draws=event.draws;
    const paidSwitches=event.paidSwitches??0;
    if(!Number.isSafeInteger(draws)||draws<0||draws>1000000) throw new RangeError('draws must be a nonnegative integer');
    if(!Number.isSafeInteger(paidSwitches)||paidSwitches<0||paidSwitches>1000000) throw new RangeError('paidSwitches must be a nonnegative integer');
    if(event.useFree!==undefined && typeof event.useFree!=='boolean') throw new TypeError('useFree must be boolean');
    const day=gameDayJst(at);
    const freeDraws=draws>0 && event.useFree!==false && !freeDays.has(day)?1:0;
    if(freeDraws) freeDays.add(day);
    const ticketsUsed=Math.min(draws-freeDraws,ticketBalance);
    ticketBalance-=ticketsUsed;
    const paidDraws=draws-freeDraws-ticketsUsed;
    const diamonds=paidDraws*300+paidSwitches*300;
    if(!Number.isSafeInteger(diamonds) || !Number.isSafeInteger(total+diamonds)) throw new RangeError('diamond total overflow');
    const week=gameWeekMondayJst(at),month=at.slice(0,7);
    byMonth[month]=(byMonth[month]??0)+diamonds;
    byWeek[week]=(byWeek[week]??0)+diamonds;
    rows.push({at,gameDay:day,weekMonday:week,draws,freeDraws,ticketsUsed,paidDraws,paidSwitches,diamonds,ticketsRemaining:ticketBalance});
    total+=diamonds;lastMs=ms;
  }
  return {rows,byMonth,byWeek,totalDiamonds:total,ticketsRemaining:ticketBalance,
    freeGameDaysUsed:[...freeDays].sort()};
}
