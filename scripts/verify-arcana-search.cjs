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
check('U01 URL往復一致・入力不変', () => {
  const cases = [state({}), state({ an: '星 & 月', cn: 'ふぃあー', scope: 'named', open: 'A092' }),
    state({ character: 'fia_trace', cn: 'フィアー', scope: 'any', sort: 'name' }),
    state({ effect: ['attack', 'evasion'], target: ['all', 'members'], stage: 'any', count: ['2', '4'],
      status: ['ongoing', 'waiting'], basis: 'start', minDays: '0', maxDays: '99999', scope: 'all', sort: 'days_desc' }),
    state({ cn: 'ふぃあー', scope: 'any', sort: 'count' })];
  for (const original of cases) {
    const snapshot = JSON.stringify(original);
    const parsed = api.resolveQuery(api.parseQuery(api.formatQuery(original)), index);
    // URLは判定に不要なscopeと、characterから復元できる表示名を省略する。
    const expected = { ...original };
    if (!original.status.length && !api.validateDays(original).active)
      expected.scope = original.character || original.cn.trim() ? 'named' : 'any';
    if (original.character) expected.cn = index.characters[original.character].name;
    assert.deepEqual(parsed.state, expected);
    assert.deepEqual(api.filterArcana(index, parsed.state, now, deps).map(a => a.id),
      api.filterArcana(index, original, now, deps).map(a => a.id));
    assert.equal(parsed.warning, false);
    assert.equal(JSON.stringify(original), snapshot);
  }
});
check('U02 未知の値を破棄して警告', () => {
  const parsed = api.parseQuery('?effect=foo,attack&target=no&count=9&status=no&stage=no&basis=no&scope=no&sort=no&open=bad&minDays=-1&maxDays=100000&now=2000');
  assert.equal(parsed.warning, true);
  assert.deepEqual(parsed.state, state({ effect: ['attack'] }));
  assert.equal(api.parseQuery('?sort=name&sort=count').warning, true);
  assert.equal(api.resolveQuery(api.parseQuery('?open=A999'), index).warning, true);
});
check('U03 URLの日数逆転は日数条件を無効化', () => {
  const parsed = api.parseQuery('?minDays=12&maxDays=11&status=waiting');
  assert.equal(api.validateDays(parsed.state).active, false);
  assert.equal(api.validateDays(parsed.state).error, '最小日数が最大日数を超えています');
  assert.deepEqual(api.filterArcana(index, parsed.state, now, deps).map(a => a.id), ids({ status: ['waiting'] }));
});
check('U04 初期値はURLに書かない', () => {
  assert.equal(api.formatQuery(state({})), '');
  assert.equal(api.formatQuery(api.parseQuery('?stage=lr&basis=end&scope=any&sort=catalog').state), '');
});
check('U05 複数値の重複除去・固定順', () => {
  const parsed = api.parseQuery('?effect=evasion,attack,evasion&target=members,all,all&count=4,2,4&status=waiting,ongoing&effect=hp');
  assert.equal(parsed.warning, false);
  assert.equal(api.formatQuery(parsed.state), '?effect=attack,hp,evasion&target=all,members&count=2,4&status=ongoing,waiting');
  assert.equal(api.formatQuery(state({ effect: ['evasion', 'attack', 'attack'] })), '?effect=attack,evasion');
});
check('U06 character優先・存在しないIDの通知', () => {
  const parsed = api.resolveQuery(api.parseQuery('?character=fia_trace&cn=別の名前&open=A092'), index);
  assert.equal(parsed.state.cn, index.characters.fia_trace.name);
  assert.equal(parsed.state.scope, 'named');
  assert.equal(parsed.state.open, 'A092');
  assert.deepEqual(api.filterArcana(index, parsed.state, now, deps).map(a => a.id), ['A092', 'A093']);
  const missing = api.resolveQuery(api.parseQuery('?character=missing&cn=別の名前'), index);
  assert.equal(missing.characterMissing, true);
  assert.equal(missing.state.character, '');
  assert.equal(missing.state.cn, '');
  assert.equal(missing.state.scope, 'any');
});
check('U07 scope明示は名前入力の初期値より優先', () => {
  for (const scope of ['any', 'all', 'named']) {
    const parsed = api.resolveQuery(api.parseQuery(`?character=fia_trace&scope=${scope}`), index);
    assert.equal(parsed.scopeExplicit, true);
    assert.equal(parsed.state.scope, scope);
    assert.equal(api.parseQuery(api.formatQuery({ ...parsed.state, status: ['waiting'] })).state.scope, scope);
  }
  assert.equal(api.parseQuery('?cn=fia').state.scope, 'named');
  assert.equal(api.parseQuery('?cn=fia&scope=any').state.scope, 'any');
});
check('U08 全選択肢の往復・日数の整数化', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'build-arcana-pages.mjs'), 'utf8');
  const groups = source.slice(source.indexOf('const EFFECT_GROUPS'), source.indexOf('function choices'));
  const used = new Set(index.arcana.flatMap(a => a.stages.flatMap(s => s.effects.map(e => e.statKey))));
  const keys = [...groups.matchAll(/\["([a-z_]+)",/g)].map(m => m[1]).filter(key => used.has(key));
  assert.equal(keys.length, 24);
  const parsed = api.parseQuery(`?effect=${keys.join(',')}&minDays=00012`);
  assert.equal(parsed.warning, false);
  assert.deepEqual(parsed.state.effect, keys);
  assert.equal(parsed.state.minDays, '12');
});
check('T01 現在時刻の再判定と共通の開催文言', () => {
  const { statusText } = require('../js/render-arcana.js');
  const fixture = { characters: { a: { name: '甲', pageSlug: 'a', pickupHistory: [
    { date: '2026-10-28', startTime: '12:00', endDate: '2026-10-28', endTime: '12:01', kind: '復刻', announced: true }
  ] } }, arcana: [{ id: 'test', name: '試験', members: ['a'], stages: [] }] };
  const times = ['2026-10-28T11:59:00+09:00', '2026-10-28T12:00:00+09:00', '2026-10-28T12:02:00+09:00'];
  const states = ['upcoming', 'ongoing', 'waiting'];
  times.forEach((time, i) => {
    const date = new Date(time), summary = api.summarizeCharacters(fixture, date).a;
    assert.equal(summary.state, states[i]);
    assert.equal(api.filterArcana(fixture, state({ status: ['ongoing'] }), date).length, i === 1 ? 1 : 0);
    assert.ok(require('../js/render-arcana.js').renderMember(fixture.characters.a, summary).includes(statusText(summary)));
  });
});
check('U09 名前だけでは範囲チップ・適用数・URLを省略', () => {
  for (const scope of ['any', 'all', 'named']) {
    const current = state({ cn: 'ふぃあー', scope });
    const chips = api.activeFilterChips(current);
    assert.deepEqual(chips.map(chip => chip.key), ['cn']);
    assert.equal(chips.filter(chip => ['count', 'status', 'basis', 'minDays', 'maxDays', 'scope'].includes(chip.key)).length, 0);
    assert.equal(new URLSearchParams(api.formatQuery(current)).has('scope'), false);
    assert.equal(current.scope, scope);
  }
});
check('U10 開催状況・有効な日数で範囲を適用、解除で省略', () => {
  for (const condition of [{ status: ['waiting'] }, { minDays: '0' }, { maxDays: '12' }]) {
    const current = state({ cn: 'ふぃあー', scope: 'named', ...condition });
    assert.ok(api.activeFilterChips(current).some(chip => chip.key === 'scope'));
    assert.equal(api.activeFilterChips(current).filter(chip => ['status', 'minDays', 'maxDays', 'scope'].includes(chip.key)).length, 2);
    assert.equal(api.parseQuery(api.formatQuery(current)).state.scope, 'named');
    const cleared = { ...current, status: [], minDays: '', maxDays: '' };
    assert.deepEqual(api.activeFilterChips(cleared).map(chip => chip.key), ['cn']);
  }
  const invalid = state({ cn: 'ふぃあー', scope: 'all', minDays: '12', maxDays: '11' });
  assert.ok(!api.activeFilterChips(invalid).some(chip => chip.key === 'scope'));
  assert.equal(new URLSearchParams(api.formatQuery(invalid)).has('scope'), false);
  invalid.status = ['waiting'];
  assert.ok(api.activeFilterChips(invalid).some(chip => chip.key === 'scope'));
  assert.equal(new URLSearchParams(api.formatQuery(invalid)).get('scope'), 'all');
});
check('U11 固定キャラのcn省略と表示名復元', () => {
  const current = state({ character: 'fia_trace', cn: index.characters.fia_trace.name, scope: 'named', open: 'A092' });
  const query = api.formatQuery(current);
  assert.equal(query, '?character=fia_trace&open=A092');
  const restored = api.resolveQuery(api.parseQuery(query), index).state;
  assert.deepEqual(restored, current);
  assert.equal(new URLSearchParams(api.formatQuery(state({ cn: 'ふぃあー' }))).get('cn'), 'ふぃあー');
});
check('U12 所属直リンク往復・明示scope保持と後からの条件適用', () => {
  const parsed = api.resolveQuery(api.parseQuery('?character=fia_trace&scope=named&open=A092'), index);
  assert.equal(parsed.scopeExplicit, true);
  assert.equal(parsed.state.scope, 'named');
  assert.deepEqual(api.activeFilterChips(parsed.state).map(chip => chip.key), ['cn']);
  const restored = api.resolveQuery(api.parseQuery(api.formatQuery(parsed.state)), index).state;
  for (const current of [parsed.state, restored]) {
    assert.equal(current.open, 'A092');
    assert.deepEqual(api.filterArcana(index, current, now, deps).map(a => a.id), ['A092', 'A093']);
    for (const condition of [{ status: ['waiting'] }, { minDays: '0' }]) {
      const selected = { ...current, ...condition };
      assert.ok(api.activeFilterChips(selected).some(chip => chip.key === 'scope'));
      assert.deepEqual(api.filterArcana(index, selected, now, deps).map(a => a.id), ids({ character: 'fia_trace', scope: 'named', ...condition }));
    }
  }
});
check('X01 冥を含むアルカナを除外・実データ件数', () => {
  const excluded = index.arcana.filter(a => a.members.some(id => index.characters[id]?.attribute === '冥'));
  const result = rows({ xattr: ['dark'] });
  assert.equal(result.length, index.arcana.length - excluded.length);
  assert.ok(result.every(a => a.members.every(id => index.characters[id]?.attribute !== '冥')));
  console.log(`  冥を含む${excluded.length}件 / 残り${result.length}件`);
});
check('X02 天・冥を含むアルカナを除外・実データ件数', () => {
  const excluded = index.arcana.filter(a => a.members.some(id => ['天', '冥'].includes(index.characters[id]?.attribute)));
  const result = rows({ xattr: ['light', 'dark'] });
  assert.equal(result.length, index.arcana.length - excluded.length);
  assert.ok(result.every(a => a.members.every(id => !['天', '冥'].includes(index.characters[id]?.attribute))));
  console.log(`  天・冥を含む${excluded.length}件 / 残り${result.length}件`);
});
check('X03 未特定枠だけは除外しない・補完キャラは属性で除外', () => {
  const fixture = { characters: { 'supp-test': { name: '補完', attribute: '冥', pageSlug: null } }, arcana: [
    { id: 'unknown', name: '未特定', members: [null, null], stages: [] },
    { id: 'known', name: '混在', members: [null, 'supp-test'], stages: [] }
  ] };
  assert.deepEqual(api.filterArcana(fixture, state({ xattr: ['dark'] }), now, deps).map(a => a.id), ['unknown']);
  assert.equal(api.filterArcana(fixture, state({ xattr: ['light'] }), now, deps).length, 2);
});
check('X04 属性URLの正規化・重複除去・不正値警告', () => {
  const parsed = api.parseQuery('?xattr=dark,blue,dark&xattr=wrong');
  assert.equal(parsed.warning, true);
  assert.deepEqual(parsed.state.xattr, ['blue', 'dark']);
  assert.equal(api.formatQuery(parsed.state), '?xattr=blue,dark');
  assert.deepEqual(api.parseQuery(api.formatQuery(parsed.state)).state, parsed.state);
  assert.equal(api.parseQuery('?xattr=light,dark').warning, false);
});
check('X05 属性チップ・初期値で解除・他条件との併用', () => {
  assert.deepEqual(api.activeFilterChips(state({ xattr: ['dark'] })), [{ key: 'xattr', value: 'dark', label: '冥を除外' }]);
  assert.deepEqual(api.defaultState().xattr, []);
  assert.equal(api.formatQuery(api.defaultState()), '');
  const expected = rows({ effect: ['attack'] }).filter(a => a.members.every(id => index.characters[id]?.attribute !== '冥'));
  assert.deepEqual(rows({ effect: ['attack'], xattr: ['dark'] }), expected);
});
check('X06 選択肢にない効果を無視・警告、一覧はデータから集計', () => {
  const keys = api.availableEffectKeys(index);
  const used = [...new Set(index.arcana.flatMap(a => a.stages.flatMap(s => s.effects.map(e => e.statKey))))].sort();
  assert.deepEqual([...keys].sort(), used);
  const parsed = api.resolveQuery(api.parseQuery('?effect=physical_penetration,attack'), index);
  assert.equal(parsed.warning, true);
  assert.deepEqual(parsed.state.effect, ['attack']);
  assert.deepEqual(api.filterArcana(index, parsed.state, now, deps), rows({ effect: ['attack'] }));
  assert.equal(api.parseQuery('?effect=physical_penetration', keys).warning, true);
  const fixture = { characters: {}, arcana: [{ stages: [{ effects: [{ statKey: 'hp' }] }] }] };
  assert.deepEqual(api.availableEffectKeys(fixture), ['hp']);
  assert.deepEqual(api.resolveQuery(api.parseQuery('?effect=attack,hp'), fixture).state.effect, ['hp']);
});
console.log(`=== 結果: ${ok}件OK / ${ng}件NG ===`);
process.exitCode = ng ? 1 : 0;
