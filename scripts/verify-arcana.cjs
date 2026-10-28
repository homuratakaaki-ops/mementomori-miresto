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

function main() {
  // パス指定はカレントディレクトリ基準。未指定時はリポジトリのデータを読む。
  const metaPath = process.env.ARCANA_META_PATH || path.join(ROOT, 'data/arcana-character-meta.json');
  const canonicalPath = process.env.ARCANA_CANONICAL_PATH || path.join(ROOT, 'data/mementomori-skills.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
  if (!isObject(meta) || !isObject(meta.characters)) throw new Error('charactersはオブジェクトが必要');
  if (!isObject(canonical) || !Array.isArray(canonical.characters)) throw new Error('正本のcharactersは配列が必要');
  const entries = Object.entries(meta.characters);
  if (entries.some(([, value]) => !isObject(value))) throw new Error('各キャラの値はオブジェクトが必要');
  if (canonical.characters.some(value => !isObject(value) || typeof value.id !== 'string' || !value.id)) throw new Error('正本のidが不正');
  const canonicalIds = canonical.characters.map(value => value.id);
  const results = [verifyV01(entries, canonicalIds), verifyV02(entries, canonicalIds), verifyV03(entries), verifyV04(entries, meta)];
  for (const { code, counts, errors } of results) {
    console.log(`${code} ${errors.length ? 'NG' : 'OK'}: ${counts}`);
    for (const error of errors) console.log(`  ${error}`);
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

module.exports = { verifyV01, verifyV02, verifyV03, verifyV04 };
