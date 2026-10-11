// Holy Angel equipment-parts calculation. No browser state, network or existing tool dependencies.
// Source (secondary): https://ichigogames.net/mementomori/equipment_parts/
// These values describe Michael armor, NOT other armor families or weapons.
export const MICHAEL_CUMULATIVE_PARTS = Object.freeze({
  240:100,250:115,260:130,270:150,280:170,290:190,300:215,
  310:240,320:265,330:290,340:320,350:350,360:380,370:410,
  380:440,390:470,400:500,410:530,420:560,430:590,440:620,
  450:650,460:680,470:710,480:740,490:770,500:800,510:830,
  520:860,530:900
});
export const RELIC_KEYS = Object.freeze(['chalice','medal','wing','fruit']);
export const PART_SLOTS = Object.freeze({
  accessory: Object.freeze(['chalice','medal']),
  arm: Object.freeze(['chalice','medal']),
  feet: Object.freeze(['chalice','medal']),
  head: Object.freeze(['wing','fruit']),
  body: Object.freeze(['wing','fruit'])
});

function assertCount(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(name + ' must be a nonnegative safe integer');
}
function assertLevel(level, name) {
  if (!Number.isSafeInteger(level) || level < 240 || level % 10 !== 0) {
    throw new RangeError(name + ' must be a level from 240 in steps of 10');
  }
}
function cumulative(level, customStepParts) {
  if (level === null) return 0; // Michael armor is not yet owned.
  assertLevel(level, 'level');
  if (level <= 530) return MICHAEL_CUMULATIVE_PARTS[level];
  let value = MICHAEL_CUMULATIVE_PARTS[530];
  for (let next = 540; next <= level; next += 10) {
    const additional = customStepParts?.[next];
    assertCount(additional, 'customStepParts[' + next + ']');
    value += additional;
    if (!Number.isSafeInteger(value)) throw new RangeError('parts sum exceeds safe integer');
  }
  return value;
}

export function standardRemainder(currentLevel, customStepParts = {}) {
  if (currentLevel === null) return 0;
  const total = cumulative(currentLevel, customStepParts);
  return (50 - (total % 50)) % 50;
}

export function planEquipmentParts({
  slot, currentLevel = null, targetLevel, ownedParts,
  customStepParts = {}
}) {
  if (!Object.hasOwn(PART_SLOTS, slot)) throw new RangeError('Unknown Michael armor slot');
  assertLevel(targetLevel, 'targetLevel');
  const fromTotal = cumulative(currentLevel, customStepParts);
  const toTotal = cumulative(targetLevel, customStepParts);
  const held = ownedParts === undefined ? standardRemainder(currentLevel, customStepParts) : ownedParts;
  assertCount(held, 'ownedParts');
  let balance = held;
  let exchanges = 0;
  let required = 0;
  const steps = [];
  if (toTotal > fromTotal) {
    const first = currentLevel === null ? 240 : currentLevel + 10;
    for (let level = first; level <= targetLevel; level += 10) {
      const stepParts = cumulative(level, customStepParts) - cumulative(level === 240 ? null : level - 10, customStepParts);
      const bought = Math.ceil(Math.max(0, stepParts - balance) / 50);
      balance += bought * 50 - stepParts;
      required += stepParts;
      exchanges += bought;
      steps.push({level, requiredParts:stepParts, exchanges:bought, remainingParts:balance});
    }
  }
  const relics = Object.fromEntries(RELIC_KEYS.map(key => [key, PART_SLOTS[slot].includes(key) ? exchanges : 0]));
  return {slot, currentLevel, targetLevel, startingParts:held,
    partsRequired:required, exchanges, acquiredParts:exchanges*50,
    remainingParts:balance, relics, steps};
}

// Same equipmentId denotes successive milestones of ONE physical piece of armor.
// Distinct equipmentIds denote distinct items, even if they occupy the same slot.
export function planCombinedEquipment(plans, ownedRelics = {}) {
  if (!Array.isArray(plans)) throw new TypeError('plans must be an array');
  const remainingRelics = Object.fromEntries(RELIC_KEYS.map(key => {
    const count = ownedRelics[key] ?? 0;
    assertCount(count, 'ownedRelics.' + key);
    return [key, count];
  }));
  const items = new Map();
  for (const p of plans) {
    if (typeof p.equipmentId !== 'string' || p.equipmentId.length === 0) {
      throw new TypeError('Each plan requires a nonempty equipmentId');
    }
    const old = items.get(p.equipmentId);
    if (old) {
      if (old.slot !== p.slot || old.currentLevel !== (p.currentLevel ?? null)
        || old.ownedParts !== p.ownedParts
        || JSON.stringify(old.customStepParts ?? {}) !== JSON.stringify(p.customStepParts ?? {})) {
        throw new Error('Conflicting starting state for equipmentId ' + p.equipmentId);
      }
      if (p.targetLevel > old.targetLevel) old.targetLevel = p.targetLevel;
    } else {
      items.set(p.equipmentId, {...p, currentLevel:p.currentLevel ?? null});
    }
  }
  // Shared slot-part inventory is not yet implemented for multiple physical items.
  // Refuse an unsafe estimate instead of spending the same parts twice.
  const usedSlots = new Set();
  for (const item of items.values()) {
    if (usedSlots.has(item.slot)) throw new Error('Multiple physical items in the same slot require shared-parts planning');
    usedSlots.add(item.slot);
  }
  const totalRelics = Object.fromEntries(RELIC_KEYS.map(key => [key, 0]));
  const perItem = [];
  for (const item of items.values()) {
    const result = planEquipmentParts(item);
    for (const key of RELIC_KEYS) totalRelics[key] += result.relics[key];
    perItem.push({equipmentId:item.equipmentId, ...result});
  }
  const shortages = Object.fromEntries(RELIC_KEYS.map(key => [key, Math.max(0, totalRelics[key] - remainingRelics[key])]));
  return {perItem, totalRelics, ownedRelics:remainingRelics, shortages};
}

export function fixedDrawCost({draws, freeDraws = 0, tickets = 0, paidSwitches = 0}) {
  for (const [key, value] of Object.entries({draws, freeDraws, tickets, paidSwitches})) assertCount(value, key);
  if (freeDraws > draws) throw new RangeError('freeDraws exceeds draws');
  const ticketsUsed = Math.min(tickets, draws - freeDraws);
  const paidDraws = draws - freeDraws - ticketsUsed;
  return {paidDraws, ticketsUsed, drawDiamonds:paidDraws*300,
    switchDiamonds:paidSwitches*300, totalDiamonds:(paidDraws+paidSwitches)*300};
}
