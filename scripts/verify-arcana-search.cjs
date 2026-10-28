#!/usr/bin/env node
const assert = require('node:assert/strict');
const index = require('../data/arcana-index.json');
const api = require('../js/arcana-search.js');
const deps = { ...require('../js/gacha-status.js'), ...require('../js/search-normalize.js') };
const now = '2026-10-28T12:00';
let ok = 0, ng = 0;
function check(name, fn) {
  try { fn(); ok++; console.log(`${name} OK`); }
  catch (error) { ng++; console.log(`${name} NG: ${error.message}`); }
}
const state = patch => ({ ...api.defaultState(), ...patch });
const rows = patch => api.filterArcana(index, state(patch), now, deps);
const ids = patch => rows(patch).map(a => a.id);
const includes = (patch, id) => assert.ok(ids(patch).includes(id), id);
const excludes = (patch, id) => assert.ok(!ids(patch).includes(id), id);
check('N01 半角カナ', () => assert.deepEqual(deps.normalizeVariants('ﾌﾛｰﾚﾝｽ'), deps.normalizeVariants('フローレンス')));
check('N02 ヴとば行', () => {
  for (const a of ['ばるりーで', 'ゔぁるりーで', 'ヴァルリーデ'])
    for (const b of ['ばるりーで', 'ゔぁるりーで', 'ヴァルリーデ'])
      assert.ok(deps.normalizeVariants(a).some(v => deps.normalizeVariants(b).includes(v)));
});
check('N03 濁点を区別', () => assert.notDeepEqual(deps.normalizeVariants('ハ'), deps.normalizeVariants('バ')));
check('E01 回避×全キャラ×LR', () => {
  for (const id of ['A003', 'A017']) includes({ effect: ['evasion'], target: ['all'] }, id);
});
check('E02a 同じ段階・効果行で種類と対象を判定', () => {
  const fixture = { characters: {}, arcana: [{ id: 'test', name: '試験', members: [], stages: [
    { label: 'UR', effects: [{ statKey: 'attack', target: 'members' }] },
    { label: 'LR', effects: [{ statKey: 'hp', target: 'all' }] }
  ] }] };
  for (const stage of ['lr', 'any']) assert.equal(api.filterArcana(fixture,
    state({ effect: ['attack'], target: ['all'], stage }), now, deps).length, 0);
  const result = api.filterArcana(fixture, state({ effect: ['attack'], target: ['members'], stage: 'any' }), now, deps);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].matchedStages, ['UR']);
});
check('E02b 実データのLR攻撃力×全キャラ集合', () => {
  const expected = index.arcana.filter(a => a.stages.some(s => s.label === 'LR' && !s.pending &&
    s.effects.some(e => !e.pending && e.statKey === 'attack' && e.target === 'all'))).map(a => a.id);
  console.log(`  実データ集合: ${expected.length}件`);
  assert.equal(expected.length, 19);
  assert.deepEqual(ids({ effect: ['attack'], target: ['all'] }), expected);
});
check('E03 物理防御力と確認中段階', () => {
  includes({ effect: ['physical_defense'], target: ['all'] }, 'A017');
  const a = rows({ effect: ['physical_defense'], target: ['all'], stage: 'any' }).find(a => a.id === 'A017');
  assert.ok(a && !a.matchedStages.includes('LR+6'));
});
check('E04 確認中効果', () => {
  excludes({ effect: ['strength'] }, 'A009');
  includes({ effect: ['counter'] }, 'A101');
  excludes({ effect: ['strength'] }, 'A101');
});
check('C01 読みで通常版と別衣装', () => {
  const candidates = api.matchCharacters(index, 'ふぃあー', deps);
  for (const name of ['フィアー', '[在りし日の面影]フィアー']) {
    const c = candidates.find(c => c.name === name);
    assert.ok(c, name);
    assert.ok(rows({ cn: 'ふぃあー' }).some(a => a.members.includes(c.id)));
  }
});
check('C02 1体に固定', () => assert.deepEqual(ids({ character: 'fia_trace' }), ['A092', 'A093']));
check('C03 必要人数', () => {
  assert.equal(rows({ count: ['4'] }).length, 6);
  assert.equal(rows({ count: ['2', '3'] }).length, 95);
});
check('G01 開催中', () => includes({ status: ['ongoing'] }, 'A101'));
check('G02 全員恒常に未特定枠を含めない', () => {
  for (const id of ['A100', 'A101']) excludes({ status: ['permanent'], scope: 'all' }, id);
});
check('G03 補完キャラの履歴未確認', () => {
  for (const id of ['A057', 'A069', 'A082']) includes({ status: ['history_unknown'], scope: 'all' }, id);
});
check('G04 状態と日数は同じ枠', () => {
  const fixture = { characters: {
    a: { name: '甲', pageSlug: 'a', pickupHistory: [{ date: '2026-10-20', endDate: '2026-11-01', kind: '復刻' }] },
    b: { name: '乙', pageSlug: 'b', pickupHistory: [{ date: '2026-04-01', endDate: '2026-04-10', kind: '復刻' }] }
  }, arcana: [{ id: 'test', name: '試験', members: ['a', 'b'], stages: [] }] };
  const summaries = api.summarizeCharacters(fixture, now, deps);
  assert.equal(summaries.a.state, 'ongoing');
  assert.equal(summaries.b.state, 'waiting');
  assert.equal(summaries.b.daysSinceEnd, 200);
  assert.equal(api.filterArcana(fixture, state({ status: ['ongoing'], minDays: '180' }), now, deps).length, 0);
});
check('D01 終了後12日の境界', () => {
  includes({ status: ['waiting'], minDays: '0', maxDays: '12' }, 'A017');
  excludes({ status: ['waiting'], minDays: '0', maxDays: '11' }, 'A017');
});
check('D02 日数入力の検証', () => {
  assert.equal(api.validateDays(state({ minDays: '12', maxDays: '11' })).error, '最小日数が最大日数を超えています');
  assert.deepEqual(ids({ minDays: '12', maxDays: '11' }), ids({}));
  for (const value of ['-1', '1.5', '100000', 'x']) assert.ok(api.validateDays(state({ minDays: value })).error);
  for (const value of ['0', '99999']) assert.equal(api.validateDays(state({ minDays: value })).error, '');
});
check('S01 日数順・null末尾・同値は管理番号', () => {
  const summaries = api.summarizeCharacters(index, now, deps);
  const sorted = api.sortArcana(rows({}), state({ sort: 'days_desc' }), summaries);
  const maximum = a => Math.max(-1, ...a.members.map(id => summaries[id]?.daysSinceEnd ?? -1));
  assert.ok(sorted.some(a => maximum(a) === -1));
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(maximum(sorted[i - 1]) >= maximum(sorted[i]));
    if (maximum(sorted[i - 1]) === maximum(sorted[i])) assert.ok(sorted[i - 1].id < sorted[i].id);
  }
});
check('E05 対象未確認の例外・種類だけ・対象だけ', () => {
  const fixture = { characters: {}, arcana: [{ id: 'test', name: '試験', members: [], stages: [
    { label: 'LR', effects: [{ statKey: 'attack', target: 'unknown', pending: false },
      { statKey: 'hp', target: 'all', pending: true }] }
  ] }] };
  const search = patch => api.filterArcana(fixture, state(patch), now, deps);
  assert.equal(search({ target: ['unknown'] }).length, 1);
  assert.equal(search({ effect: ['attack'] }).length, 1);
  assert.equal(search({ target: ['all'] }).length, 0);
  assert.equal(search({ effect: ['hp'] }).length, 0);
});
check('G05 namedは名前一致枠だけ・start基準', () => {
  const fixture = { characters: {
    a: { name: '甲', pageSlug: 'a', pickupHistory: [{ date: '2026-10-20', endDate: '2026-11-01', kind: '復刻' }] },
    b: { name: '乙', pageSlug: 'b', pickupHistory: [{ date: '2026-04-01', endDate: '2026-04-10', kind: '復刻' }] }
  }, arcana: [{ id: 'test', name: '試験', members: ['a', 'b'], stages: [] }] };
  const search = patch => api.filterArcana(fixture, state(patch), now, deps);
  assert.equal(search({ cn: '甲', status: ['waiting'], scope: 'named' }).length, 0);
  assert.equal(search({ cn: '甲', status: ['waiting'], scope: 'any' }).length, 1);
  assert.equal(search({ cn: '甲', scope: 'named', basis: 'start', minDays: '8', maxDays: '8' }).length, 1);
  assert.equal(search({ cn: '甲', scope: 'named', basis: 'end', minDays: '8', maxDays: '8' }).length, 0);
});
check('S02 名前順・人数順・入力不変', () => {
  const snapshot = JSON.stringify(index);
  for (const sort of ['name', 'count']) {
    const sorted = api.sortArcana(rows({}), state({ sort }));
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const order = sort === 'name' ? a.name.normalize('NFKC').localeCompare(b.name.normalize('NFKC'), 'ja') : a.members.length - b.members.length;
      assert.ok(order < 0 || (order === 0 && a.id < b.id));
    }
  }
  assert.equal(JSON.stringify(index), snapshot);
});
console.log(`=== 結果: ${ok}件OK / ${ng}件NG ===`);
process.exitCode = ng ? 1 : 0;
