'use strict';

let state = loadState();
let currentWeaponResult = calcWeaponCost(0, 180, 0);
let targetCrystals = currentWeaponResult.totalCrystals;

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('ja-JP', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatDate(value, withTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function futureDateByWeeks(weeks) {
  const date = getJST();
  date.setDate(date.getDate() + weeks * 7);
  return date;
}

function levelLabel(level) {
  return level === 0 ? '未所持' : `Lv${level}`;
}

function optionHTML(value, label, selectedValue) {
  return `<option value="${value}"${Number(selectedValue) === value ? ' selected' : ''}>${escapeHTML(label)}</option>`;
}

function setValueUnlessActive(selector, value) {
  const element = document.querySelector(selector);
  if (document.activeElement !== element) element.value = value;
}

function renderStatus() {
  setValueUnlessActive('#crystalInput', state.crystals);
  setValueUnlessActive('#planCurrentCrystals', state.crystals);
  setValueUnlessActive('#gachaTicketCount', state.gachaTickets);
  setValueUnlessActive('#weeklyPullCount', state.weeklyPullCount);
  document.querySelector('#pullsUntilGuaranteed').value = state.pullsUntilGuaranteed;
  document.querySelector('#usedTodayFree').checked = state.usedTodayFree;
  const nextReward = GACHA.WEEKLY_REWARDS.find((reward) => reward.count > state.weeklyPullCount);
  document.querySelector('#nextWeeklyReward').textContent = nextReward
    ? `${nextReward.count - state.weeklyPullCount}回（${nextReward.crystals}個）`
    : '今週分は達成済み';
  updateClock();
}

function updateClock() {
  const now = getJST();
  document.querySelector('#currentJst').textContent = formatDateWithWeekday(now);
  document.querySelector('#nextReset').textContent = formatDate(getNextReset(), true);
  document.querySelector('#untilReset').textContent = formatTimeUntilReset();
  document.querySelector('#remainingFree').textContent = `${remainingFreeThisWeek(state.usedTodayFree)}回`;
}

function formatDateWithWeekday(value) {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function renderCurrentLevelOptions() {
  const select = document.querySelector('#currentWeaponLevel');
  const currentValue = Number(select.value) || 180;
  const validLevels = VALID_WEAPON_LEVELS.filter((level) => level > 0);
  const selected = validLevels.includes(currentValue) ? currentValue : 180;
  select.innerHTML = validLevels.map((level) => optionHTML(level, `Lv${level}`, selected)).join('');
}

function renderTargetLevelOptions() {
  const currentLevel = currentWeaponLevel();
  const select = document.querySelector('#targetWeaponLevel');
  const previous = Number(select.value) || 180;
  const validTargets = VALID_WEAPON_LEVELS.filter((level) => level > currentLevel);
  const selected = validTargets.includes(previous) ? previous : validTargets[0];
  select.innerHTML = validTargets.map((level) => optionHTML(level, `Lv${level}`, selected)).join('');
}

function currentWeaponLevel() {
  return weaponStatusValue() === 'none'
    ? 0
    : Number(document.querySelector('#currentWeaponLevel').value);
}

function weaponStatusValue() {
  return document.querySelector('input[name="weaponStatusChoice"]:checked')?.value || 'none';
}

function shouldShowAwakeningWarning(currentLevel, targetLevel) {
  return currentLevel <= 240 && targetLevel > 240;
}

function renderWeaponCost() {
  const status = weaponStatusValue();
  document.querySelector('#currentLevelWrap').hidden = status === 'none';
  renderTargetLevelOptions();

  const currentLevel = currentWeaponLevel();
  const targetLevel = Number(document.querySelector('#targetWeaponLevel').value);
  const ownedParts = toNonNegativeInteger(document.querySelector('#ownedWeaponParts').value);
  currentWeaponResult = calcWeaponCost(currentLevel, targetLevel, ownedParts);

  const result = currentWeaponResult;
  document.querySelector('#weaponFromTo').textContent = `${levelLabel(currentLevel)} → ${levelLabel(targetLevel)}`;
  if (!result) {
    document.querySelector('#weaponTotalParts').textContent = '-';
    document.querySelector('#weaponNeededCrystals').textContent = '-';
    document.querySelector('#weaponRemainingParts').textContent = '-';
    document.querySelector('#weaponCostError').hidden = false;
    document.querySelector('#weaponAwakeningWarning').hidden = !shouldShowAwakeningWarning(currentLevel, targetLevel);
    return;
  }

  document.querySelector('#weaponCostError').hidden = true;
  document.querySelector('#weaponTotalParts').textContent = `${formatNumber(result.totalParts)}個`;
  document.querySelector('#weaponNeededCrystals').textContent = `${formatNumber(result.totalCrystals)}個`;
  document.querySelector('#weaponRemainingParts').textContent = `${formatNumber(result.remainingParts)}個`;
  document.querySelector('#weaponAwakeningWarning').hidden = !shouldShowAwakeningWarning(currentLevel, targetLevel);
}

function weeklyPlanValue() {
  return toNonNegativeInteger(state.weeklyPullsPlan);
}

function renderGachaPlan() {
  const plan = weeklyPlanValue();
  const remainingPulls = Math.max(plan - state.weeklyPullCount, 0);
  const result = calcCrystalEV(remainingPulls, state.weeklyPullCount + remainingPulls, state.pullsUntilGuaranteed);
  const freePulls = Math.min(remainingFreeThisWeek(state.usedTodayFree), remainingPulls);
  const ticketPulls = Math.min(state.gachaTickets, Math.max(remainingPulls - freePulls, 0));
  const paidPulls = Math.max(remainingPulls - freePulls - ticketPulls, 0);
  const guaranteedTotal = result.guaranteed + result.weeklyReward;

  document.querySelector('#weeklyPlanPreset').value = [15, 25, 35].includes(plan) ? String(plan) : 'custom';
  setValueUnlessActive('#weeklyPlanCustom', plan);
  document.querySelector('#weeklyPlanCustomWrap').hidden = [15, 25, 35].includes(plan);
  setValueUnlessActive('#targetCrystals', targetCrystals);
  document.querySelector('#planRemainingPulls').textContent = `${remainingPulls}回`;
  document.querySelector('#planTicketPulls').textContent = `${ticketPulls}回`;
  document.querySelector('#planPaidPulls').textContent = `${paidPulls}回`;
  document.querySelector('#planDiamonds').textContent = `${formatNumber(paidPulls * GACHA.DIAMOND_PER_PULL)}個`;
  document.querySelector('#planGuaranteed').textContent = `${formatNumber(guaranteedTotal)}個`;
  document.querySelector('#planExpected').textContent = `${formatNumber(result.normal, 2)}個`;
  document.querySelector('#planExpectedTotal').textContent = `${formatNumber(result.total, 2)}個`;

  const shortage = Math.max(targetCrystals - state.crystals, 0);
  const longTermPlan = calcWeeksAndDiamonds(shortage, plan, state.usedTodayFree, state.gachaTickets);
  const weeksNeeded = longTermPlan?.weeksNeeded || 0;
  const totalPaidPulls = longTermPlan?.paidPulls || 0;

  document.querySelector('#shortageCrystals').textContent = `${formatNumber(shortage)}個`;
  document.querySelector('#weeksNeeded').textContent = `${formatNumber(weeksNeeded)}週`;
  document.querySelector('#expectedArrivalDate').textContent = weeksNeeded > 0 ? formatDate(futureDateByWeeks(weeksNeeded)) : '到達済み';
  document.querySelector('#estimatedDiamonds').textContent = `${formatNumber(totalPaidPulls * GACHA.DIAMOND_PER_PULL)}個`;

  document.querySelector('#otherRewards').innerHTML = calcByproducts(remainingPulls, state.weeklyPullCount, state.pullsUntilGuaranteed)
    .map((item) => `<li><span>${escapeHTML(item.name)}</span><strong>${formatNumber(item.expected, 2)}${item.unit}</strong></li>`)
    .join('');
}

function renderAll() {
  renderStatus();
  renderWeaponCost();
  renderGachaPlan();
}

function persistAndRender() {
  saveState(state);
  renderAll();
}

function bindStatusEvents() {
  document.querySelector('#crystalInput').addEventListener('input', (event) => {
    state.crystals = toNonNegativeInteger(event.target.value);
    persistAndRender();
  });
  document.querySelector('#planCurrentCrystals').addEventListener('input', (event) => {
    state.crystals = toNonNegativeInteger(event.target.value);
    persistAndRender();
  });
  document.querySelector('#gachaTicketCount').addEventListener('input', (event) => {
    state.gachaTickets = toNonNegativeInteger(event.target.value);
    persistAndRender();
  });
  document.querySelector('#weeklyPullCount').addEventListener('input', (event) => {
    state.weeklyPullCount = toNonNegativeInteger(event.target.value);
    persistAndRender();
  });
  document.querySelector('#usedTodayFree').addEventListener('change', (event) => {
    state.usedTodayFree = event.target.checked;
    persistAndRender();
  });
  document.querySelector('#pullsUntilGuaranteed').addEventListener('change', (event) => {
    state.pullsUntilGuaranteed = Math.min(Math.max(toNonNegativeInteger(event.target.value), 1), 10);
    persistAndRender();
  });
}

function bindWeaponEvents() {
  document.querySelectorAll('input[name="weaponStatusChoice"]').forEach((input) => {
    input.addEventListener('change', () => {
      renderWeaponCost();
      renderGachaPlan();
    });
  });
  document.querySelector('#currentWeaponLevel').addEventListener('change', () => {
    renderTargetLevelOptions();
    renderWeaponCost();
    renderGachaPlan();
  });
  document.querySelector('#targetWeaponLevel').addEventListener('change', () => {
    renderWeaponCost();
    renderGachaPlan();
  });
  document.querySelector('#ownedWeaponParts').addEventListener('input', () => {
    renderWeaponCost();
    renderGachaPlan();
  });
  document.querySelector('#addTenParts').addEventListener('click', () => {
    const input = document.querySelector('#ownedWeaponParts');
    input.value = toNonNegativeInteger(input.value) + 10;
    renderWeaponCost();
    renderGachaPlan();
  });
  document.querySelector('#applyWeaponCrystals').addEventListener('click', () => {
    if (!currentWeaponResult) return;
    targetCrystals = currentWeaponResult.totalCrystals;
    document.querySelector('#targetCrystals').value = targetCrystals;
    document.querySelector('#targetCrystalsNote').hidden = false;
    renderGachaPlan();
  });
}

function bindPlanEvents() {
  document.querySelector('#targetCrystals').addEventListener('input', (event) => {
    targetCrystals = toNonNegativeInteger(event.target.value);
    document.querySelector('#targetCrystalsNote').hidden = true;
    renderGachaPlan();
  });
  document.querySelector('#weeklyPlanPreset').addEventListener('change', (event) => {
    if (event.target.value !== 'custom') {
      state.weeklyPullsPlan = Number(event.target.value);
      persistAndRender();
    } else {
      document.querySelector('#weeklyPlanCustomWrap').hidden = false;
      document.querySelector('#weeklyPlanCustom').focus();
    }
  });
  document.querySelector('#weeklyPlanCustom').addEventListener('input', (event) => {
    state.weeklyPullsPlan = toNonNegativeInteger(event.target.value);
    persistAndRender();
  });
}

function bindDataEvents() {
  document.querySelector('#exportData').addEventListener('click', () => exportJSON(state));
  document.querySelector('#importData').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    importJSON(file, (error, imported) => {
      event.target.value = '';
      if (error) return alert(error.message);
      if (!confirm('現在の保存データを読み込んだバックアップで置き換えますか？')) return;
      state = imported;
      renderAll();
      saveState(state);
    });
  });
  document.querySelector('#deleteData').addEventListener('click', () => {
    if (!confirm('保存中の入力値をすべて削除します。この操作は元に戻せません。')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    targetCrystals = currentWeaponResult?.totalCrystals || 0;
    renderAll();
  });
}

function initialize() {
  renderCurrentLevelOptions();
  renderTargetLevelOptions();
  bindStatusEvents();
  bindWeaponEvents();
  bindPlanEvents();
  bindDataEvents();
  renderAll();
  setInterval(updateClock, 1000);
}

document.addEventListener('DOMContentLoaded', initialize);
