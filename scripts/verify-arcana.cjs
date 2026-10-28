'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const READING_PATTERN = /^[ぁ-ゖー・]+$/;
const SUPPLEMENTAL_ID_PATTERN = /^supp-(r|n)-\d{3}$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function result(code, counts, errors) {
  return { code, counts, errors };
}

function verifyV01(entries, canonicalIds) {
  const ids = entries.filter(([, value]) => value.origin === 'canonical').map(([id]) => id);
  const expected = new Set(canonicalIds);
  const actual = new Set(ids);
  const missing = [...expected].filter(id => !actual.has(id));
  const extra = ids.filter(id => !expected.has(id));
  const errors = [];
  if (ids.length !== 120 || canonicalIds.length !== 120 || expected.size !== 120) errors.push('canonical/正本は重複なく120件必要');
  if (missing.length) errors.push(`不足: ${missing.join(', ')}`);
  if (extra.length) errors.push(`余剰: ${extra.join(', ')}`);
  return result('V01', `canonical=${ids.length}, 正本=${canonicalIds.length}, 不足=${missing.length}, 余剰=${extra.length}`, errors);
}

function verifyV02(entries, canonicalIds) {
  const supplemental = entries.filter(([, value]) => value.origin === 'supplemental');
  const canonical = new Set(canonicalIds);
  const invalid = supplemental.filter(([id]) => !SUPPLEMENTAL_ID_PATTERN.test(id));
  const collisions = supplemental.filter(([id]) => canonical.has(id));
  const errors = [];
  if (supplemental.length !== 16) errors.push('supplementalは16件必要');
  if (invalid.length) errors.push(`ID形式不正: ${invalid.map(([id]) => id).join(', ')}`);
  if (collisions.length) errors.push(`正本IDと衝突: ${collisions.map(([id]) => id).join(', ')}`);
  return result('V02', `supplemental=${supplemental.length}, ID形式不正=${invalid.length}, 衝突=${collisions.length}`, errors);
}

function verifyV03(entries) {
  const errors = [];
  let supplemental = 0;
  let canonical = 0;
  const attributes = new Set(['藍', '紅', '翠', '黄', '天', '冥']);
  for (const [id, value] of entries) {
    if (value.origin === 'canonical') {
      canonical++;
      for (const key of ['name', 'reading', 'attribute', 'pageSlug']) {
        if (has(value, key)) errors.push(`${id}: canonicalに${key}は置けない`);
      }
    } else if (value.origin === 'supplemental') {
      supplemental++;
      if (typeof value.name !== 'string' || !value.name.trim()) errors.push(`${id}: nameが必要`);
      if (!isObject(value.reading) || typeof value.reading.name !== 'string' || !READING_PATTERN.test(value.reading.name)) errors.push(`${id}: reading.nameが不正`);
      if (!attributes.has(value.attribute)) errors.push(`${id}: attributeが不正`);
      if (value.pageSlug !== null) errors.push(`${id}: pageSlugはnullが必要`);
    }
  }
  return result('V03', `supplemental確認=${supplemental}, canonical確認=${canonical}, 違反=${errors.length}`, errors);
}

function verifyV04(entries, meta) {
  const errors = [];
  const classes = new Set(['normal', 'seasonal', 'collaboration', 'other', 'unknown']);
  const rarities = new Set(['SR', 'R', 'N']);
  const origins = new Set(['canonical', 'supplemental']);
  const commonKeys = ['origin', 'initialRarity', 'releaseClass'];
  if (meta.schema !== 'miresto_arcana_character_meta_v1') errors.push('schemaが不正');
  if (typeof meta.note !== 'string' || !meta.note.trim()) errors.push('noteが必要');
  for (const key of Object.keys(meta)) {
    if (!['schema', 'note', 'characters'].includes(key)) errors.push(`未定義の項目: ${key}`);
  }
  for (const [id, value] of entries) {
    if (!origins.has(value.origin)) errors.push(`${id}: originが列挙外`);
    if (!classes.has(value.releaseClass)) errors.push(`${id}: releaseClassが列挙外`);
    if (!rarities.has(value.initialRarity)) errors.push(`${id}: initialRarityが列挙外`);
    if (value.origin === 'canonical' && value.initialRarity !== 'SR') errors.push(`${id}: canonicalはSRが必要`);
    if (value.origin === 'supplemental') {
      const match = id.match(SUPPLEMENTAL_ID_PATTERN);
      if (match && value.initialRarity !== match[1].toUpperCase()) errors.push(`${id}: IDとinitialRarityが不一致`);
    }
    const allowed = value.origin === 'supplemental' ? [...commonKeys, 'name', 'reading', 'attribute', 'pageSlug'] : commonKeys;
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) errors.push(`${id}: 未定義の項目 ${key}`);
    }
    if (isObject(value.reading)) {
      for (const key of Object.keys(value.reading)) {
        if (key !== 'name') errors.push(`${id}: readingの未定義の項目 ${key}`);
      }
    }
  }
  return result('V04', `確認=${entries.length}, 違反=${errors.length}`, errors);
}

const RARITY_PATTERN = /^(SR|UR|LR|LR\+[5-9]|LR\+1[0-9])$/;
const VERIFICATIONS = ['game_record', 'reference_agreed', 'reference_single', 'conflict', 'unknown'];
const STAT_KEYS = 'attack hp defense physical_defense magical_defense strength dexterity magic stamina critical critical_resistance critical_damage physical_critical_mitigation magical_critical_mitigation accuracy evasion debuff_accuracy debuff_resistance hp_drain counter physical_penetration physical_magical_penetration penetration party_level_cap member_awakening_cap'.split(' ');
const GAME_RECORDS = {
  'A003:LR': [['evasion', 'flat', 1500], ['defense', 'percent', 1]],
  'A015:LR': [['stamina', 'per_character_level', 30], ['defense', 'per_character_level', 15]],
  'A017:LR': [['evasion', 'per_character_level', 50], ['physical_defense', 'percent', 2]],
  'A036:LR': [['critical', 'per_character_level', 70], ['attack', 'percent', 2]],
  'A098:LR': [['stamina', 'per_character_level', 30], ['attack', 'percent', 2]]
};

function verifySchema(data) {
  const errors = [];
  function object(value, keys, where, optional = []) {
    if (!isObject(value)) { errors.push(`${where}: オブジェクトが必要`); return false; }
    for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${where}: 未定義の項目 ${key}`);
    for (const key of keys) if (!optional.includes(key) && !has(value, key)) errors.push(`${where}: ${key}が必要`);
    return true;
  }
  function array(value, where) {
    if (!Array.isArray(value)) { errors.push(`${where}: 配列が必要`); return []; }
    return value;
  }
  function text(value, where) {
    if (typeof value !== 'string' || !value.trim()) errors.push(`${where}: 空でない文字列が必要`);
  }
  function strings(value, where) { for (const item of array(value, where)) text(item, where); }
  function enumeration(value, allowed, where) { if (!allowed.includes(value)) errors.push(`${where}: 列挙外`); }
  if (!object(data, ['schema', 'schemaVersion', 'updatedAt', 'note', 'arcana', 'evidence'], 'root')) return result('SCHEMA', `違反=${errors.length}`, errors);
  if (data.schema !== 'miresto_arcana_v1' || data.schemaVersion !== 1) errors.push('schema/schemaVersionが不正');
  if (typeof data.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.updatedAt) || !Number.isFinite(Date.parse(data.updatedAt)) || new Date(data.updatedAt).toISOString().slice(0, 10) !== data.updatedAt) errors.push('updatedAtが不正');
  text(data.note, 'note');
  for (const a of array(data.arcana, 'arcana')) {
    if (!object(a, ['id', 'name', 'aliases', 'nameVerification', 'members', 'stages', 'evidenceIds'], 'arcana')) continue;
    text(a.id, 'arcana.id'); text(a.name, `${a.id}.name`);
    strings(a.aliases, `${a.id}.aliases`); strings(a.evidenceIds, `${a.id}.evidenceIds`);
    enumeration(a.nameVerification, VERIFICATIONS, `${a.id}.nameVerification`);
    for (const m of array(a.members, `${a.id}.members`)) {
      if (!object(m, ['slot', 'characterId', 'resolutionStatus'], `${a.id}.member`)) continue;
      enumeration(m.resolutionStatus, ['resolved', 'unresolved'], `${a.id}.resolutionStatus`);
      if (!Number.isInteger(m.slot)) errors.push(`${a.id}: slotは整数が必要`);
      if (m.characterId !== null) text(m.characterId, `${a.id}.characterId`);
    }
    for (const s of array(a.stages, `${a.id}.stages`)) {
      if (!object(s, ['id', 'label', 'condition', 'effects'], `${a.id}.stage`)) continue;
      text(s.id, `${a.id}.stage.id`);
      if (typeof s.label !== 'string' || !RARITY_PATTERN.test(s.label)) errors.push(`${s.id}: labelが不正`);
      if (s.id !== `${a.id}:${s.label}`) errors.push(`${s.id}: stage.idが不一致`);
      const c = s.condition;
      if (object(c, ['kind', 'rarity', 'displayText', 'verification'], `${s.id}.condition`)) {
        enumeration(c.kind, ['all_members_rarity', 'other', 'unknown'], `${s.id}.condition.kind`);
        enumeration(c.verification, VERIFICATIONS, `${s.id}.condition.verification`);
        text(c.displayText, `${s.id}.condition.displayText`);
        if (c.rarity !== null && (typeof c.rarity !== 'string' || !RARITY_PATTERN.test(c.rarity))) errors.push(`${s.id}: rarityが不正`);
        if (c.kind === 'all_members_rarity' && (c.rarity === null || c.rarity !== s.label)) errors.push(`${s.id}: rarityはlabelとの一致が必要`);
      }
      for (const e of array(s.effects, `${s.id}.effects`)) {
        if (!object(e, ['id', 'statKey', 'target', 'displayText', 'value', 'verification', 'evidenceIds'], `${s.id}.effect`)) continue;
        text(e.id, `${s.id}.effect.id`);
        if (typeof e.id !== 'string' || !e.id.startsWith(`${s.id}:`) || e.id.length <= s.id.length + 1) errors.push(`${s.id}: effect.idの接頭辞が不正`);
        enumeration(e.statKey, STAT_KEYS, `${e.id}.statKey`);
        enumeration(e.target, ['all', 'members', 'party', 'other', 'unknown'], `${e.id}.target`);
        enumeration(e.verification, VERIFICATIONS, `${e.id}.verification`);
        text(e.displayText, `${e.id}.displayText`); strings(e.evidenceIds, `${e.id}.evidenceIds`);
        if (object(e.value, ['mode', 'amount', 'coefficient'], `${e.id}.value`, ['amount', 'coefficient'])) enumeration(e.value.mode, ['flat', 'percent', 'per_character_level', 'text', 'unknown'], `${e.id}.value.mode`);
      }
    }
  }
  for (const e of array(data.evidence, 'evidence')) {
    if (!object(e, ['id', 'sourceKind', 'covers'], 'evidence')) continue;
    text(e.id, 'evidence.id'); strings(e.covers, `${e.id}.covers`);
    enumeration(e.sourceKind, ['official_rule', 'game_image_review_record', 'third_party'], `${e.id}.sourceKind`);
  }
  return result('SCHEMA', `違反=${errors.length}`, errors);
}

function verifyV06({ meta, arcana, metaText, arcanaText }) {
  const errors = [];
  // 生テキストと復号済み文字列の両方を点検し、Unicodeエスケープによる混入も拒否する。
  const forbidden = /sourceUrl|https?:\/\/|notion|libfile|sha256|夢爽|シオン|ネネ|ひなた|ミコト|ツムギ|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/i;
  function scan(value, where) {
    if (typeof value === 'string') {
      if (forbidden.test(value)) errors.push(`${where}: 禁止文字列を検出`);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) { scan(key, where); scan(child, where); }
    }
  }
  for (const [label, raw, data] of [['meta', metaText, meta], ['arcana', arcanaText, arcana]]) {
    scan(raw, `${label}生テキスト`); scan(data, `${label}データ`);
  }
  return result('V06', `対象=2, 違反=${errors.length}`, errors);
}

function verifyData(arcana, meta, expectFull) {
  const checks = Object.fromEntries(['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'V05', 'V07'].map(code => [code, result(code, '', [])]));
  const fail = (code, message) => checks[code].errors.push(message);
  const list = value => Array.isArray(value) ? value.filter(isObject) : [];
  const rows = list(arcana?.arcana);
  const evidence = list(arcana?.evidence);
  const evidenceMap = new Map();
  const stageIds = new Set();
  const effectIds = new Set();
  const arcanaIds = new Set();
  const reverse = new Map();
  const sizes = { 2: 0, 3: 0, 4: 0 };
  let slots = 0, unresolved = 0, known = 0, stages = 0, effects = 0, conflicts = 0, gameStages = 0, gameEffects = 0, awakening = 0, uncertain = 0, refs = 0, covers = 0;
  checks.D06.warnings = [];
  for (const e of evidence) {
    if (evidenceMap.has(e.id)) fail('V07', `${e.id}: evidence.id重複`);
    evidenceMap.set(e.id, e);
  }
  function references(ids, where) {
    for (const id of Array.isArray(ids) ? ids : []) {
      refs++;
      if (!evidenceMap.has(id)) fail('V07', `${where}: 存在しないevidenceId ${id}`);
    }
  }
  for (const a of rows) {
    if (typeof a.id !== 'string' || !/^A\d{3}$/.test(a.id) || arcanaIds.has(a.id)) fail('D01', `${a.id}: id形式不正または重複`);
    arcanaIds.add(a.id);
    const members = list(a.members);
    if (members.length < 2 || members.length > 4) fail('D01', `${a.id}: membersは2〜4枠必要`);
    if (has(sizes, members.length)) sizes[members.length]++;
    const memberIds = new Set();
    members.forEach((m, i) => {
      slots++;
      if (m.slot !== i + 1) fail('D01', `${a.id}: slotは1始まり連番が必要`);
      if (m.resolutionStatus === 'unresolved') {
        unresolved++;
        if (m.characterId !== null) fail('D01', `${a.id}: unresolvedはcharacterId:nullが必要`);
      } else if (m.resolutionStatus === 'resolved') {
        if (typeof m.characterId !== 'string' || !has(meta.characters, m.characterId)) fail('D01', `${a.id}: 存在しないcharacterId ${m.characterId}`);
        else {
          known++;
          if (!reverse.has(m.characterId)) reverse.set(m.characterId, new Set());
          reverse.get(m.characterId).add(a.id);
        }
      } else fail('D01', `${a.id}: resolutionStatusが列挙外`);
      if (m.characterId !== null && m.characterId !== undefined) {
        if (memberIds.has(m.characterId)) fail('D01', `${a.id}: characterId重複 ${m.characterId}`);
        memberIds.add(m.characterId);
      }
    });
    references(a.evidenceIds, a.id);
    const labels = new Set();
    let awakeningSum = 0, hasAwakening = false, hasParty = false;
    for (const s of list(a.stages)) {
      stages++;
      if (labels.has(s.label)) fail('D04', `${a.id}: label重複 ${s.label}`);
      labels.add(s.label); stageIds.add(s.id);
      const stageEffects = list(s.effects);
      const needsConflict = (['A009', 'A010', 'A033'].includes(a.id) && s.label === 'LR+7') || (a.id === 'A071' && s.label === 'LR+5');
      if (needsConflict) {
        conflicts++;
        if (s.condition?.verification !== 'conflict' || stageEffects.some(e => e.verification !== 'conflict')) fail('D04', `${s.id}: 条件と全効果にconflictが必要`);
      }
      const expected = has(GAME_RECORDS, s.id) ? GAME_RECORDS[s.id] : null;
      if (expected) {
        gameStages++;
        const actual = stageEffects.map(e => JSON.stringify([e.statKey, e.target, e.value?.mode, e.value?.mode === 'per_character_level' ? e.value?.coefficient : e.value?.amount])).sort();
        const wanted = expected.map(([stat, mode, number]) => JSON.stringify([stat, 'all', mode, number])).sort();
        if (JSON.stringify(actual) !== JSON.stringify(wanted) || stageEffects.some(e => e.verification !== 'game_record')) fail('D05', `${s.id}: 確認済み効果集合と不一致`);
      }
      for (const e of stageEffects) {
        effects++;
        if (effectIds.has(e.id)) fail('D04', `${e.id}: effect.id重複`);
        effectIds.add(e.id);
        references(e.evidenceIds, e.id);
        if (e.verification === 'game_record') {
          gameEffects++;
          if (!expected) fail('D05', `${s.id}: 許可されていないgame_record`);
          if (!Array.isArray(e.evidenceIds) || !e.evidenceIds.some(id => evidenceMap.get(id)?.sourceKind === 'game_image_review_record')) fail('D05', `${e.id}: game_image_review_recordの参照が必要`);
        }
        const v = isObject(e.value) ? e.value : {};
        const numericKey = v.mode === 'per_character_level' ? 'coefficient' : ['flat', 'percent'].includes(v.mode) ? 'amount' : null;
        if (numericKey && (typeof v[numericKey] !== 'number' || !Number.isFinite(v[numericKey]))) fail('D06', `${e.id}: ${numericKey}は有限の数値が必要`);
        for (const key of ['amount', 'coefficient']) if (key !== numericKey && has(v, key)) fail('D06', `${e.id}: ${v.mode}に${key}は置けない`);
        if (v.mode === 'percent' && Number.isFinite(v.amount) && Math.abs(v.amount * 10 - Math.round(v.amount * 10)) > Number.EPSILON * Math.max(1, Math.abs(v.amount * 10)) * 4) checks.D06.warnings.push(`${e.id}: percentのamountに小数第2位以下の値`);
        if (['conflict', 'unknown'].includes(e.verification)) {
          uncertain++;
          if (v.mode !== 'unknown') fail('V05', `${e.id}: ${e.verification}はvalue.mode:unknownが必要`);
        }
        if (e.statKey === 'member_awakening_cap') {
          awakening++; hasAwakening = true;
          if (v.mode !== 'flat') fail('D07', `${e.id}: member_awakening_capはflatが必要`);
          if (Number.isFinite(v.amount)) awakeningSum += v.amount;
        }
        if (e.statKey === 'party_level_cap') hasParty = true;
      }
    }
    if (awakeningSum > 1) fail('D07', `${a.id}: member_awakening_cap合計=${awakeningSum}（上限1）`);
    if (hasAwakening && hasParty) fail('D07', `${a.id}: party_level_capとmember_awakening_capの混在`);
  }
  for (const e of evidence) for (const id of Array.isArray(e.covers) ? e.covers : []) {
    covers++;
    if (!stageIds.has(id)) fail('V07', `${e.id}: 存在しないcovers ${id}`);
  }
  const supplementalN = [...reverse].filter(([id]) => id.startsWith('supp-n-')).reduce((sum, [, ids]) => sum + ids.size, 0);
  if (expectFull) {
    for (const [code, label, actual, expected] of [
      ['D01', 'アルカナ', rows.length, 101], ['D01', '枠', slots, 230], ['D01', '未特定', unresolved, 2], ['D01', '既知参照', known, 228],
      ['D02', '所属キャラ', reverse.size, 132], ['D02', 'supp-n所属', supplementalN, 0],
      ['D02', '2人', sizes[2], 79], ['D02', '3人', sizes[3], 16], ['D02', '4人', sizes[4], 6]
    ]) if (actual !== expected) fail(code, `全件モード: ${label}=${actual}, 期待=${expected}`);
    for (const id of Object.keys(GAME_RECORDS)) if (!stageIds.has(id)) fail('D05', `全件モード: ${id}が必要`);
  }
  checks.D01.counts = `アルカナ=${rows.length}, 枠=${slots}, 未特定=${unresolved}, 既知参照=${known}`;
  checks.D01.metrics = { arcana: rows.length, slots, unresolved, known };
  checks.D02.counts = `所属キャラ=${reverse.size}, supp-n所属=${supplementalN}, 2人=${sizes[2]}, 3人=${sizes[3]}, 4人=${sizes[4]}`;
  checks.D02.reverseIndex = Object.fromEntries([...reverse].map(([id, ids]) => [id, [...ids]]));
  checks.D03.counts = '書き込み処理=0（生成物の不変性はビルド比較で確認）';
  checks.D04.counts = `stage=${stages}, 要conflict=${conflicts}, effect ID=${effectIds.size}`;
  checks.D05.counts = `対象LR=${gameStages}/5, game_record効果=${gameEffects}`;
  checks.D06.counts = `効果=${effects}, 警告=${checks.D06.warnings.length}`;
  checks.D07.counts = `アルカナ=${rows.length}, 覚醒上限効果=${awakening}`;
  checks.V05.counts = `conflict/unknown効果=${uncertain}`;
  checks.V07.counts = `evidence=${evidence.length}, 参照=${refs}, covers=${covers}`;
  return Object.values(checks);
}

function runArcanaChecks({ meta, arcana, canonical, metaText, arcanaText, expectFull = false }) {
  if (!isObject(meta) || !isObject(meta.characters)) throw new Error('charactersはオブジェクトが必要');
  if (!isObject(canonical) || !Array.isArray(canonical.characters)) throw new Error('正本のcharactersは配列が必要');
  const entries = Object.entries(meta.characters);
  if (entries.some(([, value]) => !isObject(value))) throw new Error('各キャラの値はオブジェクトが必要');
  if (canonical.characters.some(value => !isObject(value) || typeof value.id !== 'string' || !value.id)) throw new Error('正本のidが不正');
  const canonicalIds = canonical.characters.map(value => value.id);
  return [verifyV01(entries, canonicalIds), verifyV02(entries, canonicalIds), verifyV03(entries), verifyV04(entries, meta),
    verifySchema(arcana), ...verifyData(arcana, meta, expectFull), verifyV06({ meta, arcana, metaText, arcanaText })];
}

function main() {
  // パス指定はカレントディレクトリ基準。未指定時はリポジトリのデータを読む。
  const metaPath = process.env.ARCANA_META_PATH || path.join(ROOT, 'data/arcana-character-meta.json');
  const canonicalPath = process.env.ARCANA_CANONICAL_PATH || path.join(ROOT, 'data/mementomori-skills.json');
  const arcanaPath = process.env.ARCANA_PATH || path.join(ROOT, 'data/arcana.json');
  const metaText = fs.readFileSync(metaPath, 'utf8');
  const arcanaText = fs.readFileSync(arcanaPath, 'utf8');
  const meta = JSON.parse(metaText);
  const arcana = JSON.parse(arcanaText);
  const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  const results = runArcanaChecks({ meta, arcana, canonical, metaText, arcanaText, expectFull: process.argv.includes('--expect-full') || process.env.ARCANA_EXPECT_FULL === '1' });
  for (const { code, counts, errors, warnings = [] } of results) {
    console.log(`${code} ${errors.length ? 'NG' : 'OK'}: ${counts}`);
    for (const error of errors) console.log(`  ${error}`);
    for (const warning of warnings) console.log(`${code} WARN: ${warning}`);
  }
  if (results.some(value => value.errors.length)) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`INPUT NG: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyV01, verifyV02, verifyV03, verifyV04, runArcanaChecks };
