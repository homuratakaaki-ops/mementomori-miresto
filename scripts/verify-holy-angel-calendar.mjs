import assert from 'node:assert/strict';
import {parseJstLocal,gameDayJst,gameWeekMondayJst,remainingFreeThisWeek,getForecastFreeSchedule,scheduledDrawLedger} from '../js/holy-angel-calendar.mjs';
let checks=0;const eq=(label,a,b)=>{assert.deepEqual(a,b,label);checks++};const bad=(label,fn,regex)=>{assert.throws(fn,regex,label);checks++};
eq('Sunday game day',gameDayJst('2026-10-11T23:59'),'2026-10-11');
eq('Monday just before 04 belongs Sunday',gameDayJst('2026-10-12T03:59'),'2026-10-11');
eq('Monday at reset',gameDayJst('2026-10-12T04:00'),'2026-10-12');
eq('Sunday belongs prior Monday',gameWeekMondayJst('2026-10-11T23:59'),'2026-10-05');
eq('Monday at reset next week',gameWeekMondayJst('2026-10-12T04:00'),'2026-10-12');
eq('Sunday pre-midnight F1',remainingFreeThisWeek('2026-10-11T18:30'),1);
eq('Sunday used F0',remainingFreeThisWeek('2026-10-11T18:30',{freeUsedThisGameDay:true}),0);
eq('Monday 3:59 still Sunday',remainingFreeThisWeek('2026-10-12T03:59'),1);
eq('Monday 4:00 F7',remainingFreeThisWeek('2026-10-12T04:00'),7);
eq('Thu F4',remainingFreeThisWeek('2026-10-08T08:00'),4);
eq('Wed F5',remainingFreeThisWeek('2026-10-07T09:00'),5);
eq('Friday used F2',remainingFreeThisWeek('2026-10-09T12:00',{freeUsedThisGameDay:true}),2);
eq('forecast fields',getForecastFreeSchedule('2026-10-11T20:10',{freeUsedThisGameDay:true}).firstWeekFreeDraws,0);
eq('JST offset validation',new Date(parseJstLocal('2026-10-12T04:00')).toISOString(),'2026-10-11T19:00:00.000Z');
for(const txt of ['2026-02-30T08:00','2026-13-01T07:00','2026-01-01T24:00','2026-1-01T07:00','2026-11-31T10:40'])bad('invalid date '+txt,()=>parseJstLocal(txt),/Invalid|Expected/);
const l=scheduledDrawLedger({startAt:'2026-10-11T18:30',tickets:20,events:[
{at:'2026-10-11T19:00',draws:30},
{at:'2026-10-11T20:00',draws:20},
{at:'2026-10-12T03:59',draws:5},
{at:'2026-10-12T04:00',draws:1},
{at:'2026-10-31T23:59',draws:1,paidSwitches:1},
{at:'2026-11-01T00:01',draws:1},
]});
eq('first event free',l.rows[0].freeDraws,1);
eq('second same day no free',l.rows[1].freeDraws,0);
eq('third 03:59 same game day no free',l.rows[2].freeDraws,0);
eq('Monday 04:00 free again',l.rows[3].freeDraws,1);
eq('one free on each future game day',l.rows[4].freeDraws,1);
eq('Nov 1 00:01 still same game-day, free not refreshed',l.rows[5].freeDraws,0);
eq('tickets used once',l.rows.map(r=>r.ticketsUsed),[20,0,0,0,0,0]);
eq('October total',l.byMonth['2026-10'],10500);
eq('November total',l.byMonth['2026-11'],300);
eq('cost ledger total matches month sum',l.totalDiamonds,Object.values(l.byMonth).reduce((a,b)=>a+b,0));
eq('week split',Object.keys(l.byWeek),['2026-10-05','2026-10-12','2026-10-26']);
const before=scheduledDrawLedger({startAt:'2026-10-11T23:45',freeUsedThisGameDay:true,events:[{at:'2026-10-12T02:59',draws:1},{at:'2026-10-12T04:01',draws:1}]});
eq('usedToday 3am costs 300',before.rows[0].diamonds,300);
eq('Monday new game day free',before.rows[1].diamonds,0);
bad('out of order',()=>scheduledDrawLedger({startAt:'2026-10-11T18:00',events:[{at:'2026-10-12T12:00',draws:1},{at:'2026-10-12T11:00',draws:1}]}),/chronological/);
bad('before start',()=>scheduledDrawLedger({startAt:'2026-10-12T12:00',events:[{at:'2026-10-11T12:00',draws:1}]}),/chronological/);
bad('fraction draws',()=>scheduledDrawLedger({startAt:'2026-10-11T12:00',events:[{at:'2026-10-11T13:00',draws:2.5}]}),/draws/);
bad('bad useFree',()=>scheduledDrawLedger({startAt:'2026-10-11T12:00',events:[{at:'2026-10-11T13:00',draws:1,useFree:4}]}),/useFree/);
for(const date of ['2026-01-31T23:59','2026-02-01T00:00','2028-02-29T03:59','2028-02-29T04:00','2026-12-31T23:59','2027-01-01T00:00']){
 const day=gameDayJst(date),week=gameWeekMondayJst(date);
 assert.ok(day && week);checks++;
}
console.log('PASS '+checks+' JST game calendar and dated diamond-ledger checks');
