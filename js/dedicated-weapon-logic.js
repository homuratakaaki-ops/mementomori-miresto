'use strict';

const GACHA = {
  DIAMOND_PER_PULL: 300,
  RESET_DAY: 1,
  RESET_HOUR: 4,
  GUARANTEED_EVERY: 10,
  GUARANTEED_CRYSTALS: 10,
  NORMAL_CRYSTAL_EV: 0.12,
  WEEKLY_REWARDS: [
    { count: 4, crystals: 2 },
    { count: 15, crystals: 2 },
    { count: 25, crystals: 3 },
    { count: 35, crystals: 3 }
  ],
  BYPRODUCTS: [
    { name: '魔装香油', ev: 0.20, unit: '個' },
    { name: '魔装高級香油', ev: 0.08, unit: '個' },
    { name: '無窮の塔チケット', ev: 0.51, unit: '枚' },
    { name: 'ボスチケット', ev: 0.60, unit: '枚' },
    { name: 'ルーンチケット', ev: 3.51, unit: '枚' }
  ]
};

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(Math.floor(parsed), 0) : 0;
}

function getCostSteps(currentLevel, targetLevel) {
  if (currentLevel >= targetLevel) return [];
  const steps = [];
  let level = currentLevel;

  while (level < targetLevel) {
    const step = WEAPON_COST_TABLE.find((item) => item.from === level);
    if (!step || step.to > targetLevel) return null;
    steps.push(step);
    level = step.to;
  }
  return steps;
}

function calcWeaponCost(currentLevel, targetLevel, ownedParts) {
  const safeParts = toNonNegativeInteger(ownedParts);
  const steps = getCostSteps(Number(currentLevel), Number(targetLevel));
  if (steps === null) return null;
  if (steps.length === 0) {
    return { totalParts: 0, totalCrystals: 0, remainingParts: safeParts, stepResults: [] };
  }

  let remainingParts = safeParts;
  let totalCrystals = 0;
  const stepResults = [];

  for (const step of steps) {
    const shortage = Math.max(step.parts - remainingParts, 0);
    const exchanges = Math.ceil(shortage / PARTS_PER_EXCHANGE);
    const crystalsUsed = exchanges * CRYSTALS_PER_EXCHANGE;
    const partsAfterUpgrade = remainingParts + exchanges * PARTS_PER_EXCHANGE - step.parts;

    stepResults.push({
      from: step.from,
      to: step.to,
      requiredParts: step.parts,
      ownedBeforeStep: remainingParts,
      exchanges,
      crystalsUsed,
      partsAfterUpgrade
    });
    totalCrystals += crystalsUsed;
    remainingParts = partsAfterUpgrade;
  }

  return {
    totalParts: steps.reduce((sum, step) => sum + step.parts, 0),
    totalCrystals,
    remainingParts,
    stepResults
  };
}

function normalDrawCount(pullCount, previousWeeklyCount = 0) {
  const pulls = toNonNegativeInteger(pullCount);
  const previous = toNonNegativeInteger(previousWeeklyCount);
  const guaranteedBefore = Math.floor(previous / GACHA.GUARANTEED_EVERY);
  const guaranteedAfter = Math.floor((previous + pulls) / GACHA.GUARANTEED_EVERY);
  return pulls - (guaranteedAfter - guaranteedBefore);
}

function guaranteedDrawCount(pullCount, pullsUntilGuaranteed = GACHA.GUARANTEED_EVERY) {
  const pulls = toNonNegativeInteger(pullCount);
  const until = Math.min(Math.max(toNonNegativeInteger(pullsUntilGuaranteed), 1), GACHA.GUARANTEED_EVERY);
  if (pulls < until) return 0;
  return 1 + Math.floor((pulls - until) / GACHA.GUARANTEED_EVERY);
}

function normalDrawCountFromCounter(pullCount, pullsUntilGuaranteed) {
  const pulls = toNonNegativeInteger(pullCount);
  return pulls - guaranteedDrawCount(pulls, pullsUntilGuaranteed);
}

function calcCrystalEV(pullCount, weeklyCount, pullsUntilGuaranteed = null) {
  const pulls = toNonNegativeInteger(pullCount);
  const currentTotal = Math.max(toNonNegativeInteger(weeklyCount), pulls);
  const previousCount = Math.max(currentTotal - pulls, 0);
  const guaranteedSlots = pullsUntilGuaranteed === null
    ? Math.floor(currentTotal / GACHA.GUARANTEED_EVERY) - Math.floor(previousCount / GACHA.GUARANTEED_EVERY)
    : guaranteedDrawCount(pulls, pullsUntilGuaranteed);
  const guaranteed = guaranteedSlots * GACHA.GUARANTEED_CRYSTALS;
  const normalDraws = pullsUntilGuaranteed === null
    ? normalDrawCount(pulls, previousCount)
    : normalDrawCountFromCounter(pulls, pullsUntilGuaranteed);
  const normal = normalDraws * GACHA.NORMAL_CRYSTAL_EV;
  const weeklyReward = GACHA.WEEKLY_REWARDS.reduce((sum, reward) => (
    previousCount < reward.count && currentTotal >= reward.count
      ? sum + reward.crystals
      : sum
  ), 0);

  return {
    guaranteed,
    normal,
    weeklyReward,
    total: guaranteed + normal + weeklyReward,
    normalDraws
  };
}

function calcByproducts(pullCount, previousWeeklyCount = 0, pullsUntilGuaranteed = null) {
  const draws = pullsUntilGuaranteed === null
    ? normalDrawCount(pullCount, previousWeeklyCount)
    : normalDrawCountFromCounter(pullCount, pullsUntilGuaranteed);
  return GACHA.BYPRODUCTS.map((item) => ({
    name: item.name,
    unit: item.unit,
    expected: Number((draws * item.ev).toFixed(2))
  }));
}

function getJST(now = new Date()) {
  return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
}

function getCurrentWeekStart(now = new Date()) {
  const jst = getJST(now);
  const day = jst.getDay();
  const hour = jst.getHours();
  const daysBack = day === GACHA.RESET_DAY && hour < GACHA.RESET_HOUR
    ? 7
    : (day - GACHA.RESET_DAY + 7) % 7;
  const weekStart = new Date(jst);
  weekStart.setDate(jst.getDate() - daysBack);
  weekStart.setHours(GACHA.RESET_HOUR, 0, 0, 0);
  return weekStart;
}

function getNextReset(now = new Date()) {
  const next = getCurrentWeekStart(now);
  next.setDate(next.getDate() + 7);
  return next;
}

function remainingFreeThisWeek(usedTodayFree, now = new Date()) {
  const jst = getJST(now);
  const next = getNextReset(now);
  const today = new Date(jst);
  today.setHours(0, 0, 0, 0);
  const resetDay = new Date(next);
  resetDay.setHours(0, 0, 0, 0);
  let days = Math.round((resetDay - today) / 86400000);
  if (jst.getHours() < GACHA.RESET_HOUR) days += 1;
  if (usedTodayFree) days -= 1;
  return Math.max(days, 0);
}

function formatTimeUntilReset(now = new Date()) {
  const diff = getNextReset(now) - getJST(now);
  if (diff <= 0) return 'まもなくリセット';
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `${hours}時間${minutes}分`;
}

function calcWeeksAndDiamonds(crystalsNeeded, weeklyPullsPlan, usedTodayFree) {
  const needed = Math.max(Number(crystalsNeeded) || 0, 0);
  const plan = toNonNegativeInteger(weeklyPullsPlan);
  if (needed <= 0) return { weeksNeeded: 0, totalPulls: 0, paidPulls: 0, diamonds: 0, arrivalDate: getJST() };
  if (plan <= 0) return null;

  const ev = calcCrystalEV(plan, plan);
  if (ev.total <= 0) return null;
  const weeksNeeded = Math.ceil(needed / ev.total);
  const totalPulls = weeksNeeded * plan;
  const totalFree = Math.max(weeksNeeded * 7 - (usedTodayFree ? 1 : 0), 0);
  const paidPulls = Math.max(totalPulls - totalFree, 0);
  const diamonds = paidPulls * GACHA.DIAMOND_PER_PULL;
  const arrivalDate = getJST();
  arrivalDate.setDate(arrivalDate.getDate() + weeksNeeded * 7);
  return { weeksNeeded, totalPulls, paidPulls, diamonds, arrivalDate };
}
