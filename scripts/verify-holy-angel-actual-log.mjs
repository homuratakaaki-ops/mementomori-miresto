import assert from 'node:assert/strict';
import {replayHolyAngelActuals as replay} from '../js/holy-angel-actual-log.mjs';
const relics=()=>({chalice:0,medal:0,wing:0,fruit:0});
const parts=()=>({arm:0,feet:0,accessory:0,head:0,body:0});
const start=()=>({at:'2026-10-11T18:00',relics:relics(),partsBySlot:parts(),
  tickets:20,diamonds:12000,gauge:0,selected:'chalice',
  freeSwitches:1,usedFreeToday:false,claimedCheckpoints:[]});
const e=(id,type,fields={})=>({id,type,at:'2026-10-11T18:05',...fields});
let n=0;
const eq=(a,b)=>{assert.deepEqual(a,b);n++;};
const bad=(fn,re)=>{assert.throws(fn,re);n++;};
const events=[
 e('a','draw',{count:10,free:true,ticketsUsed:9}),
 e('b','claim',{milestone:10,won:true}),
 e('c','draw',{count:15,free:false,ticketsUsed:11}),
 e('d','claim',{milestone:25,won:false}),
 e('f','draw',{count:25,free:false}),
 e('g','claim',{milestone:50,won:true}),
 e('h','switch',{to:'medal',method:'free'}),
 e('i','draw',{count:10,free:false}),
 e('j','claim',{milestone:10,won:true}),
 e('k','exchange',{slot:'arm',count:1})
];
const r=replay({snapshot:start(),events});
eq([r.relics.chalice,r.relics.medal,r.partsBySlot.arm],[1,0,50]);
eq([r.diamonds,r.diamondsSpent,r.tickets,r.draws],[300,11700,0,60]);
eq([r.gauge,r.freeSwitches,r.eventsApplied],[10,0,10]);
eq(r.diamondsByMonth,{'2026-10':11700});
eq(r.diamondsByWeek,{'2026-10-05':11700});
eq(replay({snapshot:start(),events:[...events,events[0]]}).diamondsSpent,11700);
eq(replay({snapshot:start(),events:[...events,events[0]]}).eventsApplied,10);
bad(()=>replay({snapshot:start(),events:[...events,{...events[0],count:8}]}),/Conflicting duplicate/);
const raw=JSON.stringify([start(),events]);replay({snapshot:start(),events});
eq(JSON.stringify([start(),events]),raw);
bad(()=>replay({snapshot:start(),events:[e('a','draw',{count:1,free:true}),e('b','draw',{count:1,free:true})]}),/Daily free/);
bad(()=>replay({snapshot:{...start(),diamonds:30000},events:[e('a','draw',{count:50,free:false}),e('b','draw',{count:1,free:false})]}),/crosses the 50/);
bad(()=>replay({snapshot:start(),events:[e('a','claim',{milestone:10,won:true})]}),/before drawing/);
bad(()=>replay({snapshot:start(),events:[e('a','draw',{count:10,free:false}),e('b','claim',{milestone:10,won:true}),e('c','claim',{milestone:10,won:false})]}),/claimed twice/);
bad(()=>replay({snapshot:{...start(),diamonds:30000},events:[e('a','draw',{count:50,free:false}),e('b','claim',{milestone:50,won:false})]}),/guaranteed/);
bad(()=>replay({snapshot:{...start(),diamonds:30000},events:[e('a','draw',{count:50,free:false}),e('b','claim',{milestone:50,won:true})]}),/Earlier milestone/);
bad(()=>replay({snapshot:start(),events:[e('a','draw',{count:10,free:false}),e('b','switch',{to:'medal',method:'free'})]}),/explicit abandonPending/);
eq(replay({snapshot:start(),events:[e('a','draw',{count:10,free:false}),e('b','switch',{to:'medal',method:'free',abandonPending:true})]}).gauge,0);
bad(()=>replay({snapshot:{...start(),diamonds:299},events:[e('a','switch',{to:'medal',method:'paid'})]}),/Insufficient diamonds/);
bad(()=>replay({snapshot:start(),events:[e('a','switch',{to:'medal',method:'free'}),e('b','switch',{to:'fruit',method:'free'})]}),/No free switch/);
bad(()=>replay({snapshot:start(),events:[e('a','draw',{count:10,free:false,ticketsUsed:11})]}),/tickets exceed/);
bad(()=>replay({snapshot:start(),events:[e('a','draw',{count:1})]}),/explicit boolean/);
bad(()=>replay({snapshot:{...start(),diamonds:300},events:[e('a','draw',{count:2,free:false})]}),/Insufficient recorded/);
bad(()=>replay({snapshot:start(),events:[e('a','draw',{count:1,free:true,at:'2026-10-12T04:00'})]}),/explicit weekly-reset/);
bad(()=>replay({snapshot:start(),events:[e('a','weekly-reset',{selected:'wing'})]}),/same game week/);
bad(()=>replay({snapshot:start(),events:[e('a','draw',{count:10,free:false}),e('b','weekly-reset',{at:'2026-10-12T04:00',selected:'wing'})]}),/pending/);
const monday=replay({snapshot:start(),events:[
 e('a','draw',{count:10,free:true}),
 e('b','claim',{milestone:10,won:false}),
 e('c','weekly-reset',{at:'2026-10-12T04:00',selected:'wing'}),
 e('d','draw',{at:'2026-10-12T04:01',count:1,free:true})
]});
eq([monday.gauge,monday.gameWeek,monday.selected,monday.usedFreeToday],[1,'2026-10-12','wing',true]);
bad(()=>replay({snapshot:start(),events:[e('a','exchange',{slot:'arm',count:1})]}),/Insufficient actual relics/);
bad(()=>replay({snapshot:start(),events:[e('a','exchange',{slot:'weapon',count:1})]}),/Unknown equipment/);
bad(()=>replay({snapshot:start(),events:[e('a','draw',{count:1,free:false,at:'2026-02-30T10:00'})]}),/Invalid/);
bad(()=>replay({snapshot:start(),events:[
 e('a','draw',{count:1,free:false,at:'2026-10-11T19:00'}),
 e('b','draw',{count:1,free:false,at:'2026-10-11T18:59'})
]}),/chronological/);
const noBalance=start();delete noBalance.diamonds;
eq(replay({snapshot:noBalance,events:[e('a','draw',{count:10,free:false})]}).diamonds,null);
eq(replay({snapshot:noBalance,events:[e('a','draw',{count:10,free:false})]}).diamondsSpent,3000);
console.log('PASS '+n+' actual Holy Angel gacha replay checks');
