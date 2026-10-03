#!/usr/bin/env node
/**
 * キャラページの事前生成（プリレンダリング）。
 *
 *   node scripts/build-character-pages.mjs
 *
 * data/*.json の内容を公開前に HTML へ書き込み、JSを無効にしても本文が読める状態にする。
 * 描画ロジックは js/render-character.js / js/render-character-index.js と共有し、
 * ブラウザ側と二重管理にしない。
 *
 * データの唯一の正は data/mementomori-skills.json。data/*-overlay.json は参照しない。
 *
 * 出力:
 *   pages/characters/{pageSlug}.html  … 全キャラの詳細ページ（上書き）
 *   pages/characters/index.html       … キャラ一覧のカード部分を差し替え
 *
 * data/*.json を変更したら必ず実行し、JSONとHTMLを同じコミットに含めること。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const PAGES_DIR = join(ROOT, "pages", "characters");

const renderer = require(join(ROOT, "js", "render-character.js"));
const indexRenderer = require(join(ROOT, "js", "render-character-index.js"));

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** 既存のHTMLに合わせて改行をCRLFへ揃える（core.autocrlf=true の作業ツリーと同じ状態にする）。 */
function toCrlf(text) {
  return text.replace(/\r\n|\r|\n/g, "\r\n");
}

function writeIfChanged(path, content) {
  const normalized = toCrlf(content);
  const previous = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (previous === normalized) return false;
  writeFileSync(path, normalized, "utf8");
  return true;
}

/**
 * キャラ詳細ページのHTML。マークアップは従来のページと同一で、
 * JSが埋めていた箇所（roleMemo / characterMeta / skillList / notePanel）を
 * 生成時に埋めてある。
 */
function characterPageHtml({ character, metaHtml, skillListHtml, description }) {
  const notePanel = character.noteUrl
    ? `    <section class="note-panel" id="notePanel">
      <strong>評価・運用メモはnoteへ</strong><br>
      このページでは検証済みデータと出典整理に絞ります。評価や編成判断は外部記事で確認してください。<br>
      <a id="noteLink" href="${renderer.escapeHtml(character.noteUrl)}" target="_blank" rel="noopener">ミレストのnote記事を開く</a>
    </section>`
    : `    <section class="note-panel" id="notePanel" hidden>
      <strong>評価・運用メモはnoteへ</strong><br>
      このページでは検証済みデータと出典整理に絞ります。評価や編成判断は外部記事で確認してください。<br>
      <a id="noteLink" href="#" target="_blank" rel="noopener">ミレストのnote記事を開く</a>
    </section>`;

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${renderer.escapeHtml(renderer.pageTitle(character))}</title>
  <meta name="description" content="${renderer.escapeHtml(description)}">
  <link rel="canonical" href="${renderer.escapeHtml(renderer.canonicalUrl(character))}">
  <link rel="stylesheet" href="../../assets/character-page.css">
  <script src="../../js/render-character.js" defer></script>
  <script src="../../js/character-page.js" defer></script>
</head>
<body data-character-page data-character-id="${renderer.escapeHtml(character.id)}" data-attribute="${renderer.escapeHtml(character.attribute || "")}" data-prerendered>
  <header class="page-header">
    <div class="header-inner">
      <a class="top-link" href="./index.html">キャラ一覧へ戻る</a>
      <p class="eyebrow">CHARACTER SKILL DATA</p>
      <h1 id="characterName">${renderer.escapeHtml(character.name)}</h1>
      <p class="role" id="roleMemo">${renderer.escapeHtml(renderer.roleMemoText(character))}</p>
      <div class="meta-row" id="characterMeta">${metaHtml}</div>
    </div>
  </header>

  <main>
${notePanel}
    <section class="skill-list" id="skillList">${skillListHtml}</section>
  </main>

  <footer>
    <div class="footer-inner">
      <span>ミレストのメメントモリ分析データ室 / 非公式ファンサイト</span>
      <a href="../../compare-prototype.html">スキル比較DB</a>
    </div>
  </footer>
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      window.MirestoCharacterPage.init().catch((error) => {
        document.querySelector('#roleMemo').textContent = error.message;
        console.error(error);
      });
    });
  </script>
</body>
</html>
`;
}

/** index.html のカード部分だけを差し替える（巨大なインラインCSS/JSはそのまま残す）。 */
function patchIndexHtml(html, { gridHtml, countText }) {
  const replacements = [
    {
      name: "body[data-prerendered]",
      pattern: /<body(?![^>]*\sdata-prerendered)([^>]*)>/,
      value: (match, attrs) => `<body${attrs} data-prerendered>`
    },
    {
      name: "#countText",
      pattern: /(<p id="countText">)[\s\S]*?(<\/p>)/,
      value: (match, open, close) => `${open}${countText}${close}`
    },
    {
      name: "#characterGrid",
      pattern: /(<section class="grid" id="characterGrid">)[\s\S]*?(<\/section>)/,
      value: (match, open, close) => `${open}${gridHtml}${close}`
    }
  ];

  let output = html;
  for (const { name, pattern, value } of replacements) {
    if (!pattern.test(output)) {
      if (name === "body[data-prerendered]") continue; // 既に付いている
      throw new Error(`index.html の差し替え対象が見つかりません: ${name}`);
    }
    output = output.replace(pattern, value);
  }
  return output;
}

/**
 * flow（いつ・誰に・何が起きる？）の生成時アサーション。
 * AGENTS.md「flow の分解ルール」を機械的に点検できる範囲で検査し、違反があれば生成を止める。
 */
const FLOW_WHEN_PATTERNS = [
  /^バトル開始時$/,
  /^[0-9]+(?:[・,、][0-9]+)*ターン目(?:の)?開始時$/,
  /^ターン開始時$/,
  /^ターン終了時$/,
  /^行動開始時$/,
  /^スキル発動時$/,
  /^攻撃前$/,
  /^攻撃時$/,
  /^攻撃後$/,
  /^最後の攻撃後$/,
  /を受けたとき$/,
  /戦闘不能になったとき$/,
  /^常時$/,
  /^[0-9]+ターン目以降$/
];

const FLOW_MODES = new Set(["sequence", "simultaneous", "passive", "conditional", "release"]);

// 倍率チップは「チップ単独で意味が通るダメージ倍率」だけに使う（回復量・バフ量は text 側）。
const FLOW_MULTIPLIER_PATTERN = /^(?:攻撃力×|物理|魔法|腕力×|魔力×|技力×)[0-9]+(?:\.[0-9]+)?%(?:×[0-9]+回)?$/;

/** 旧「継続」カードの継続ターンを取り出す（例: "睡眠1T / 再生4ターン" → ["1", "4"]。「Nターン目」は時点なので除く）。 */
function durationTurns(duration) {
  return [...String(duration || "").matchAll(/([0-9]+)\s*(?:T(?![a-zA-Z])|ターン(?!目))/g)].map((match) => match[1]);
}

function validateFlow(skill, errors) {
  if (!Array.isArray(skill.flow) || skill.flow.length === 0) return;
  const label = `${skill.id} (S${skill.number} ${skill.name})`;
  const frames = new Set();
  const effects = [];

  for (const block of skill.flow) {
    if (!block.when || !block.target) {
      errors.push(`${label}: flow の枠に when / target が無い`);
      continue;
    }
    // ルール2: 同じ「いつ」＋同じ「誰に」の効果は1枠にまとめる
    const frame = `${block.when}|${block.target}`;
    if (frames.has(frame)) errors.push(`${label}: 「${block.when}＋${block.target}」の枠が重複している`);
    frames.add(frame);

    // ルール6: when の語彙
    if (!FLOW_WHEN_PATTERNS.some((pattern) => pattern.test(block.when))) {
      errors.push(`${label}: when「${block.when}」が語彙リストにも複合形にも合致しない`);
    }
    if (!FLOW_MODES.has(block.mode)) errors.push(`${label}: mode「${block.mode}」は未定義`);
    if (block.mode === "sequence" && !block.order) errors.push(`${label}: sequence の枠に order が無い`);

    if (!Array.isArray(block.effects) || block.effects.length === 0) {
      errors.push(`${label}: 「${block.when}」の枠に効果が無い`);
      continue;
    }
    for (const effect of block.effects) {
      effects.push(effect);
      // ルール2(改): 倍率チップがある効果にも本文を残す
      if (!effect.text) errors.push(`${label}: 本文（text）の無い効果がある`);
      // ルール5: 倍率チップはダメージ倍率のみ
      if (effect.multiplier && !FLOW_MULTIPLIER_PATTERN.test(effect.multiplier)) {
        errors.push(`${label}: multiplier「${effect.multiplier}」はダメージ倍率の形ではない`);
      }
      if (effect.damageTotal && !effect.multiplier) {
        errors.push(`${label}: damageTotal は倍率チップのある効果にだけ付ける`);
      }
    }
  }

  // ルール3(改): 合計は「damage が指す攻撃」の行に紐付ける
  const damage = skill.damage;
  const hasMultiplier = effects.some((effect) => effect.multiplier);
  const bases = effects.filter((effect) => effect.damageTotal === "base").length;
  const maxes = effects.filter((effect) => effect.damageTotal === "conditionMax").length;
  if (bases > 1) errors.push(`${label}: damageTotal:"base" の効果が ${bases} 件ある（1件まで）`);
  if (maxes > 1) errors.push(`${label}: damageTotal:"conditionMax" の効果が ${maxes} 件ある（1件まで）`);
  if (damage && !damage.nonAttackMultiplier && damage.baseTotal && hasMultiplier && bases === 0) {
    errors.push(`${label}: 倍率チップはあるのに damageTotal:"base" の効果が無い`);
  }
  if (maxes === 1 && !(damage && damage.conditionMaxTotal > damage.baseTotal)) {
    errors.push(`${label}: conditionMaxTotal が baseTotal を超えないのに damageTotal:"conditionMax" がある`);
  }

  // 旧「継続」カードにあった継続ターンが、flow の継続チップに必ず現れること
  const chips = effects.map((effect) => effect.duration || "").join(" ");
  for (const turns of durationTurns(skill.duration)) {
    if (!chips.includes(`${turns}ターン`)) {
      errors.push(`${label}: 継続「${skill.duration}」の${turns}ターンが flow の継続チップに無い`);
    }
  }
}

/** flow を持つスキルのカードに旧「対象／倍率・火力／継続」が残っていないか（ルール10）。 */
function validateRenderedCard(skill, html, errors) {
  if (/<dt>(?:対象|倍率・火力|継続)<\/dt>/.test(html)) {
    errors.push(`${skill.id}: flow があるのに旧カード（対象／倍率・火力／継続）が出ている`);
  }
  if (!html.includes("いつ・誰に・何が起きる？")) {
    errors.push(`${skill.id}: 生成HTMLに「いつ・誰に・何が起きる？」が含まれていない`);
  }
}
/** 1ファイルも書き出す前に flow を点検する（検証に落ちたら出力を残さない）。 */
function validateAll({ baseData, terms }) {
  const errors = [];
  let flowSkills = 0;
  for (const skill of baseData.skills || []) {
    validateFlow(skill, errors);
    if (Array.isArray(skill.flow) && skill.flow.length > 0) {
      flowSkills += 1;
      validateRenderedCard(skill, renderer.renderSkillCard(skill, terms), errors);
    }
  }
  if (errors.length) {
    for (const message of errors) console.error(`flow検証NG: ${message}`);
    throw new Error(`flow の検証に失敗しました（${errors.length}件）。上のログを確認してください。`);
  }
  return flowSkills;
}

function buildCharacterPages({ baseData, newsData, terms }) {
  const written = [];
  const unchanged = [];
  const slugs = [];

  for (const character of baseData.characters || []) {
    const skills = renderer.selectSkills(baseData, character.id);
    if (skills.length === 0) throw new Error(`スキルが0件です: ${character.id}`);

    // ページのファイル名は既存ページと同じ pageSlug を使う。
    const slug = character.pageSlug || character.id;
    const html = characterPageHtml({
      character: { ...character, pageSlug: slug },
      metaHtml: renderer.renderMetaHtml(character, newsData),
      skillListHtml: renderer.renderSkillList(skills, terms),
      description: renderer.pageDescription(character, skills)
    });

    const path = join(PAGES_DIR, `${slug}.html`);
    slugs.push(slug);
    (writeIfChanged(path, html) ? written : unchanged).push(slug);
  }

  return { written, unchanged, slugs };
}

function buildIndexPage({ baseData }) {
  const characters = baseData.characters || [];
  const path = join(PAGES_DIR, "index.html");
  const html = patchIndexHtml(readFileSync(path, "utf8"), {
    gridHtml: indexRenderer.renderGrid(characters, "all"),
    countText: indexRenderer.countText(characters.length, characters.length)
  });
  return { changed: writeIfChanged(path, html), total: characters.length };
}

function main() {
  const baseData = readJson(join(DATA_DIR, "mementomori-skills.json"), { characters: [], skills: [] });
  const newsData = readJson(join(DATA_DIR, "news.json"), { items: [] });
  const terms = readJson(join(DATA_DIR, "terms.json"), { terms: {} }).terms || {};

  const flowSkills = validateAll({ baseData, terms });
  const pages = buildCharacterPages({ baseData, newsData, terms });
  const index = buildIndexPage({ baseData });

  console.log(`キャラページ: ${pages.slugs.length}件 (更新 ${pages.written.length} / 変更なし ${pages.unchanged.length})`);
  console.log(`flow 付きスキル: ${flowSkills}件（検証OK）`);
  console.log(`キャラ一覧: ${index.total}件のカードを生成${index.changed ? " (更新)" : " (変更なし)"}`);
}

main();
