'use strict';

const STORAGE_KEY = 'miresto_dedWeapon_v1';

// Depends on dedicated-weapon-logic.js being loaded before this file.
function defaultState() {
  return {
    version: 1,
    crystals: 0,
    weeklyPullCount: 0,
    usedTodayFree: false,
    gachaTickets: 0,
    pullsUntilGuaranteed: 10,
    weeklyPullsPlan: 35,
    lastUpdated: null
  };
}

function normalizeState(value) {
  const base = defaultState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const ticketValue = value.gachaTickets ?? value.witchTickets;
  return {
    version: 1,
    crystals: Math.max(Number(value.crystals) || 0, 0),
    weeklyPullCount: Math.max(Math.floor(Number(value.weeklyPullCount) || 0), 0),
    usedTodayFree: Boolean(value.usedTodayFree),
    gachaTickets: Math.max(Math.floor(Number(ticketValue) || 0), 0),
    pullsUntilGuaranteed: Math.min(Math.max(Math.floor(Number(value.pullsUntilGuaranteed) || 10), 1), 10),
    weeklyPullsPlan: Math.max(Math.floor(Number(value.weeklyPullsPlan) || 0), 0),
    lastUpdated: value.lastUpdated || base.lastUpdated
  };
}

function applyStateResets(state, now = new Date()) {
  if (!state.lastUpdated) return state;
  const lastUpdated = new Date(state.lastUpdated);
  if (Number.isNaN(lastUpdated.getTime())) return state;

  const lastJst = getJST(lastUpdated);
  if (lastJst < getCurrentWeekStart(now)) {
    state.weeklyPullCount = 0;
  }
  if (lastJst < getCurrentDayStart(now)) {
    state.usedTodayFree = false;
  }
  return state;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? applyStateResets(normalizeState(JSON.parse(raw))) : defaultState();
  } catch (error) {
    console.warn('保存データを読み込めませんでした。', error);
    return defaultState();
  }
}

function saveState(state) {
  const normalized = normalizeState(state);
  normalized.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

function exportJSON(state) {
  const blob = new Blob([JSON.stringify(normalizeState(state), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `dedweapon-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importJSON(file, callback) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (Number(data.version) !== 1) throw new Error('invalid schema');
      callback(null, applyStateResets(normalizeState(data)));
    } catch (error) {
      callback(new Error('JSONの形式が正しくありません。'), null);
    }
  };
  reader.onerror = () => callback(new Error('JSONの読み込みに失敗しました。'), null);
  reader.readAsText(file);
}
