/**
 * Actual Holy Angel gacha events: a pure, OFFLINE replay of user-confirmed facts.
 * Predictions must never change inventory. Unclaimed 10/25/50 rewards are not
 * counted as obtained. Weekly resets are explicit to avoid hidden data loss.
 * Do NOT expose this as live gameplay truth until receipt/reset behavior is
 * checked against the game's latest screens.
 */
import {gameDayJst,gameWeekMondayJst,parseJstLocal} from './holy-angel-calendar.mjs';
export const ACTUAL_RELICS=Object.freeze(['chalice','medal','wing','fruit']);
export const ACTUAL_SLOTS=Object.freeze({
  arm:Object.freeze(['chalice','medal']),feet:Object.freeze(['chalice','medal']),
  accessory:Object.freeze(['chalice','medal']),
  head:Object.freeze(['wing','fruit']),body:Object.freeze(['wing','fruit'])
});
const MAX_EVENTS=300,slots=Object.keys(ACTUAL_SLOTS);
function integer(name,n,max=1000000){
  if(!Number.isSafeInteger(n)||n<0||n>max)throw new RangeError(name+' must be an integer in 0..'+max);
  return n;
}
function checkedText(name,s,max=80){
  if(typeof s!=='string'||s.length===0||s.length>max)throw new TypeError(name+' must be a nonempty string');
  return s;
}
function quantities(name,raw,keys){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError(name+' must be an object');
  if(Object.keys(raw).some(k=>!keys.includes(k)))throw new RangeError('Unknown '+name+' resource');
  return Object.fromEntries(keys.map(k=>[k,integer(name+'.'+k,raw[k]??0)]));
}
function checkpointBits(values,gauge){
  if(!Array.isArray(values)||values.some(n=>n!==10&&n!==25)||new Set(values).size!==values.length)
    throw new RangeError('claimedCheckpoints may contain 10 and 25 once');
  if(values.some(n=>gauge<n))throw new RangeError('Cannot claim a checkpoint beyond gauge');
  return {10:values.includes(10),25:values.includes(25)};
}
function pending(state){
  return [10,25].filter(n=>state.gauge>=n&&!state.claimed[n]).concat(state.gauge===50?[50]:[]);
}
function start(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new TypeError('snapshot must be an object');
  const at=checkedText('snapshot.at',snapshot.at,16),ms=parseJstLocal(at);
  const relics=quantities('relics',snapshot.relics,ACTUAL_RELICS);
  const partsBySlot=quantities('partsBySlot',snapshot.partsBySlot,slots);
  const tickets=integer('tickets',snapshot.tickets);
  const diamonds=snapshot.diamonds===undefined?null:integer('diamonds',snapshot.diamonds,1000000000);
  const gauge=integer('gauge',snapshot.gauge,49);
  if(!ACTUAL_RELICS.includes(snapshot.selected))throw new RangeError('snapshot.selected must be one relic ID');
  const freeSwitches=integer('freeSwitches',snapshot.freeSwitches,1);
  if(typeof snapshot.usedFreeToday!=='boolean')throw new TypeError('usedFreeToday must be boolean');
  return {at,lastMs:ms,gameWeek:gameWeekMondayJst(at),gameDay:gameDayJst(at),
    relics,partsBySlot,tickets,diamonds,gauge,selected:snapshot.selected,freeSwitches,
    usedFreeDays:new Set(snapshot.usedFreeToday?[gameDayJst(at)]:[]),
    claimed:checkpointBits(snapshot.claimedCheckpoints??[],gauge),
    diamondsSpent:0,diamondsByMonth:{},diamondsByWeek:{},draws:0,eventsApplied:0};
}
function apply(state,event){
  if(!event||typeof event!=='object'||Array.isArray(event))throw new TypeError('Event must be an object');
  const at=checkedText('event.at',event.at,16),ms=parseJstLocal(at);
  if(ms<state.lastMs)throw new RangeError('Events are not chronological');
  const nextWeek=gameWeekMondayJst(at);
  if(event.type!=='weekly-reset'&&nextWeek!==state.gameWeek)
    throw new Error('Week changed: explicit weekly-reset event required before more actions');
  const costBefore=state.diamondsSpent;
  switch(event.type){
    case 'weekly-reset':{
      if(nextWeek===state.gameWeek)throw new Error('Cannot reset inside the same game week');
      if(pending(state).length)throw new Error('Resolve or confirm forfeiture of pending rewards before weekly reset');
      if(!ACTUAL_RELICS.includes(event.selected))throw new RangeError('weekly-reset selected relic required');
      state.gameWeek=nextWeek;state.gauge=0;state.freeSwitches=1;state.selected=event.selected;
      state.claimed={10:false,25:false};
      break;
    }
    case 'draw':{
      const count=integer('draw.count',event.count,50);
      if(!count||state.gauge+count>50)throw new RangeError('Draw crosses the 50 milestone; split into a new cycle');
      if(typeof event.free!=='boolean')throw new TypeError('draw.free must be explicit boolean');
      const gameDay=gameDayJst(at);
      if(event.free&&state.usedFreeDays.has(gameDay))throw new Error('Daily free draw already used for this game day');
      const ticketsUsed=integer('draw.ticketsUsed',event.ticketsUsed??0);
      if(ticketsUsed>state.tickets||ticketsUsed>count-Number(event.free))
        throw new RangeError('Not enough tickets or tickets exceed charged draws');
      const spent=(count-Number(event.free)-ticketsUsed)*300;
      if(state.diamonds!==null&&state.diamonds<spent)throw new RangeError('Insufficient recorded diamonds; reconcile snapshot before draw');
      if(event.free)state.usedFreeDays.add(gameDay);
      if(state.diamonds!==null)state.diamonds-=spent;
      state.diamondsSpent+=spent;state.tickets-=ticketsUsed;state.draws+=count;state.gauge+=count;
      break;
    }
    case 'claim':{
      const level=event.milestone;
      if(![10,25,50].includes(level))throw new RangeError('Invalid milestone');
      if(state.gauge<level)throw new Error('Cannot claim milestone before drawing to it');
      if(level!==50&&state.claimed[level])throw new Error('Milestone reward claimed twice');
      if(typeof event.won!=='boolean')throw new TypeError('claim.won is required');
      if(level===50&&!event.won)throw new Error('50-draw relic reward is guaranteed');
      if(level===50&&pending(state).some(x=>x!==50))throw new Error('Earlier milestone claims still pending');
      if(event.won)state.relics[state.selected]++;
      if(level===50){state.gauge=0;state.claimed={10:false,25:false};state.freeSwitches=1;}
      else state.claimed[level]=true;
      break;
    }
    case 'switch':{
      if(!ACTUAL_RELICS.includes(event.to)||event.to===state.selected)throw new RangeError('Choose a different known relic');
      if(pending(state).length&&event.abandonPending!==true)
        throw new Error('Unclaimed milestone rewards may be lost; explicit abandonPending required');
      if(!['free','paid'].includes(event.method))throw new RangeError('switch.method must be free or paid');
      if(event.method==='free'){
        if(state.freeSwitches<1)throw new Error('No free switch remains');
        state.freeSwitches--;
      }else{
        if(state.diamonds!==null&&state.diamonds<300)throw new RangeError('Insufficient diamonds to switch');
        if(state.diamonds!==null)state.diamonds-=300;
        state.diamondsSpent+=300;
      }
      state.selected=event.to;state.gauge=0;state.claimed={10:false,25:false};
      break;
    }
    case 'exchange':{
      if(!Object.hasOwn(ACTUAL_SLOTS,event.slot))throw new RangeError('Unknown equipment part slot');
      const count=integer('exchange.count',event.count,100);
      if(!count)throw new RangeError('At least one 50-part exchange required');
      const [a,b]=ACTUAL_SLOTS[event.slot];
      if(state.relics[a]<count||state.relics[b]<count)
        throw new Error('Insufficient actual relics to exchange parts');
      state.relics[a]-=count;state.relics[b]-=count;state.partsBySlot[event.slot]+=50*count;
      break;
    }
    default:throw new RangeError('Unknown event.type');
  }
  const spent=state.diamondsSpent-costBefore;
  if(spent){
    const month=at.slice(0,7),week=gameWeekMondayJst(at);
    state.diamondsByMonth[month]=(state.diamondsByMonth[month]??0)+spent;
    state.diamondsByWeek[week]=(state.diamondsByWeek[week]??0)+spent;
  }
  state.at=at;state.lastMs=ms;state.gameDay=gameDayJst(at);state.eventsApplied++;
}
/** Returns new state only, preserving the input snapshot and event array. */
export function replayHolyAngelActuals({snapshot,events}){
  const state=start(snapshot);
  if(!Array.isArray(events)||events.length>MAX_EVENTS)throw new RangeError('Event log must contain 0..'+MAX_EVENTS+' events');
  const ids=new Map();
  for(const event of events){
    const id=checkedText('event.id',event?.id),data=JSON.stringify(event);
    if(ids.has(id)){
      if(ids.get(id)!==data)throw new Error('Conflicting duplicate event ID: '+id);
      continue; // exact duplicate cannot charge or reward twice
    }
    ids.set(id,data);
    apply(state,event);
  }
  return {at:state.at,gameDay:state.gameDay,gameWeek:state.gameWeek,
    relics:{...state.relics},partsBySlot:{...state.partsBySlot},
    tickets:state.tickets,diamonds:state.diamonds,diamondsSpent:state.diamondsSpent,
    diamondsByMonth:{...state.diamondsByMonth},diamondsByWeek:{...state.diamondsByWeek},
    draws:state.draws,gauge:state.gauge,selected:state.selected,freeSwitches:state.freeSwitches,
    usedFreeToday:state.usedFreeDays.has(state.gameDay),
    claimedCheckpoints:[10,25].filter(n=>state.claimed[n]),
    pendingClaims:pending(state),eventsApplied:state.eventsApplied};
}
