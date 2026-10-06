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
 *   index.html                        … トップページのニュース欄を差し替え
 *   pages/status/*.html               … 状態異常ガイド（scripts/build-status-guides.mjs）
 *   広告枠                            … scripts/build-ads.mjs（目印 <!-- ad:bottom --> を置き換え）
 *
 * data/*.json を変更したら必ず実行し、JSONとHTMLを同じコミットに含めること。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildStatusGuides } from "./build-status-guides.mjs";
import { buildAds } from "./build-ads.mjs";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const PAGES_DIR = join(ROOT, "pages", "characters");

const renderer = require(join(ROOT, "js", "render-character.js"));
const indexRenderer = require(join(ROOT, "js", "render-character-index.js"));
const gachaStatus = require(join(ROOT, "js", "gacha-status.js"));
const newsRenderer = require(join(ROOT, "js", "render-news.js"));
const adRenderer = require(join(ROOT, "js", "render-ad-slot.js"));

// 開催状況の判定に使う「今日」。1回のビルド内で全ページ同じ日付になるように
// ここで1度だけ決める（日付が変わる瞬間にビルドが走っても食い違わないため）。
// MIRESTO_TODAY で差し替えられる（検証用。YYYY-MM-DD）。
const TODAY = (() => {
  const override = (process.env.MIRESTO_TODAY || "").trim();
  if (!override) return gachaStatus.jstToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(override)) throw new Error(`MIRESTO_TODAY は YYYY-MM-DD で指定すること: ${override}`);
  return override;
})();
const GENERATED_AT = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace("Z", "+09:00");

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * 改行を既存ファイルに合わせる。
 * Windows（core.autocrlf=true）の作業ツリーはCRLF、GitHub Actions の Linux はLFになるため、
 * 固定でCRLFにすると Linux 側で毎回「全ファイル更新」と判定されてしまう。
 * リポジトリ内の行末は .gitattributes の `text=auto` でLFに正規化されるので、
 * ここは手元のファイルに合わせるだけでよい（既存ファイルが無ければLF）。
 */
function matchEol(text, previous) {
  const lf = text.replace(/\r\n|\r|\n/g, "\n");
  const useCrlf = previous === null ? false : previous.includes("\r\n");
  return useCrlf ? lf.replace(/\n/g, "\r\n") : lf;
}

function writeIfChanged(path, content) {
  const previous = existsSync(path) ? readFileSync(path, "utf8") : null;
  const normalized = matchEol(content, previous);
  if (previous === normalized) return false;
  writeFileSync(path, normalized, "utf8");
  return true;
}

/**
 * キャラ詳細ページのHTML。マークアップは従来のページと同一で、
 * JSが埋めていた箇所（roleMemo / characterMeta / skillList / notePanel）を
 * 生成時に埋めてある。
 */
function characterPageHtml({ character, metaHtml, skillListHtml, description, ads }) {
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
  <!-- OGP。画像は共通のものを使う（キャラごとの画像生成は未対応） -->
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${renderer.escapeHtml(renderer.TITLE_SUFFIX)}">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${renderer.escapeHtml(renderer.pageTitle(character))}">
  <meta property="og:description" content="${renderer.escapeHtml(description)}">
  <meta property="og:url" content="${renderer.escapeHtml(renderer.canonicalUrl(character))}">
  <meta property="og:image" content="${renderer.escapeHtml(renderer.SITE_ORIGIN)}/assets/ogp/ogp-common.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/png" href="../../assets/miresto/miresto-icon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="../../assets/miresto/miresto-icon-180.png">
  <link rel="stylesheet" href="../../assets/character-page.css">
  <script src="../../js/gacha-status.js" defer></script>
  <script src="../../js/render-character.js" defer></script>
  <script src="../../js/character-page.js" defer></script>
${adRenderer.renderAdHead(ads, "  ")}
</head>
<body data-character-page data-character-id="${renderer.escapeHtml(character.id)}" data-attribute="${renderer.escapeHtml(character.attribute || "")}" data-prerendered>
  <header class="page-header">
    <div class="header-inner">
      <a class="top-link" href="/">トップ</a>
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
${adRenderer.renderAdSlot(ads, "    ")}
  </main>

  <footer>
    <div class="footer-inner">
      <span>ミレストのメメントモリ分析データ室 / 非公式ファンサイト</span>
      <nav class="footer-links" aria-label="サイト内のページ">
        <a href="/">トップ</a>
        <a href="./index.html">キャラ一覧</a>
        <a href="../../compare-prototype.html">スキル比較DB</a>
        <a href="/pages/guide/">このサイトでできること</a>
        <a href="/privacy.html">プライバシーポリシー</a>
        <a href="/disclaimer.html">免責事項</a>
        <a href="/about.html">このサイトについて</a>
        <a href="/contact.html">お問い合わせ</a>
      </nav>
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
  /^[0-9]+(?:[・,、][0-9]+)*ターン目(?:の)?(?:ターン|行動)?(?:開始時|終了時)$/,
  /^ターン開始時$/,
  /^ターン終了時$/,
  /^行動開始時$/,
  /^行動終了時$/,
  /^スキル発動時$/,
  /^攻撃前$/,
  /^攻撃時$/,
  /^攻撃後$/,
  /^最後の攻撃後$/,
  /とき$/, // 帯そのものが条件の形（〜を受けたとき / 〜を付与したとき / 〜になったとき など）
  /^常時$/,
  /^[0-9]+ターン目以降$/
];

const FLOW_MODES = new Set(["sequence", "simultaneous", "passive", "conditional", "release"]);

// 倍率チップは「チップ単独で意味が通るダメージ倍率」だけに使う（回復量・バフ量は text 側）。
const FLOW_MULTIPLIER_PATTERN = /^(?:攻撃力×|物理|魔法|腕力×|魔力×|技力×)[0-9]+(?:\.[0-9]+)?%(?:×[0-9]+回)?(?:（[0-9]+(?:\.[0-9]+)?%×[0-9]+(?:\.[0-9]+)?(?:回)?）)?$/;

/**
 * 旧「継続」カードの継続ターンを取り出す（例: "睡眠1T / 再生4ターン" → ["1", "4"]）。
 * 「Nターン目」「N T 終了時」「Nターンまで」は継続ではなく時点なので数えない。
 */
function durationTurns(duration) {
  return [...String(duration || "").matchAll(/([0-9]+)\s*(?:T(?![a-zA-Z])|ターン)(?!目|終了時|開始時|まで|に[0-9]+回)/g)].map((match) => match[1]);
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

/** exclusiveWeapon の文章を「専用LvN」ごとに分ける（renderer の weaponRows と同じ切り方）。 */
const WEAPON_NONE_PATTERN = /^(?:専用武器効果なし|専用武器での直接強化なし|専用武器による強化なし|専用武器での強化なし|専用効果なし)$/;

function exclusiveSourceLevels(skill) {
  const raw = String(skill.exclusiveWeapon || "").trim();
  if (!raw || WEAPON_NONE_PATTERN.test(raw)) return [];
  return raw
    .split(/(?=専用Lv\d:)/)
    .filter(Boolean)
    .map((part) => part.match(/^専用Lv(\d):/))
    .filter(Boolean)
    .map((match) => Number(match[1]));
}

/** flow の中で参照している専用Lv（枠の対象の変更 / 独立枠 / 効果の変更・追加）。 */
function exclusiveFlowLevels(skill) {
  const levels = new Set();
  for (const block of skill.flow || []) {
    if (block.exclusiveLv) levels.add(Number(block.exclusiveLv));
    for (const item of block.exclusiveTarget || []) levels.add(Number(item.lv));
    for (const effect of block.effects || []) {
      for (const item of effect.exclusive || []) {
        levels.add(Number(item.lv));
        for (const nested of item.exclusive || []) levels.add(Number(nested.lv));
      }
    }
  }
  return levels;
}

/** 専用の倍率変更から合計を計算して damage.exclusiveLvNTotal と突き合わせる。 */
function exclusiveMultiplierTotal(skill, item) {
  const match = String(item.multiplier || "").match(/(?:攻撃力×|物理|魔法)([0-9]+(?:\.[0-9]+)?)%(?:×([0-9]+)回)?/);
  if (!match) return null;
  const single = Number(match[1]);
  const hits = match[2] ? Number(match[2]) : item.hits || (skill.damage && skill.damage.hitCount) || 1;
  return Math.round(single * hits * 100) / 100;
}

/**
 * 専用武器効果の分解（統合表示）の検証。
 * exclusiveWeapon の各「専用LvN」は、flow へ統合したか専用武器枠に残したかの
 * どちらかに必ず振り分けられていること（取りこぼし0）を点検する。
 */
function validateExclusive(skill, errors) {
  const label = `${skill.id} (S${skill.number} ${skill.name})`;
  const source = new Set(exclusiveSourceLevels(skill));
  const used = exclusiveFlowLevels(skill);
  const integrated = new Set((skill.exclusiveIntegrated || []).map(Number));
  const rest = skill.exclusiveRest || {};

  for (const lv of used) {
    if (!source.has(lv)) errors.push(`${label}: flow が専用Lv${lv} を参照しているが exclusiveWeapon に無い`);
    if (!integrated.has(lv) && !Object.prototype.hasOwnProperty.call(rest, String(lv))) {
      errors.push(`${label}: 専用Lv${lv} を flow に出しているのに exclusiveIntegrated に入っていない（専用武器枠と二重表示になる）`);
    }
  }
  for (const lv of integrated) {
    if (!source.has(lv)) errors.push(`${label}: exclusiveIntegrated の専用Lv${lv} が exclusiveWeapon に無い`);
    if (!used.has(lv)) errors.push(`${label}: 専用Lv${lv} を統合済みにしているが flow のどこにも出ていない（取りこぼし）`);
  }

  for (const block of skill.flow || []) {
    for (const item of block.exclusiveTarget || []) {
      if (!item.lv || !item.target) errors.push(`${label}: exclusiveTarget に lv / target が無い`);
    }
    for (const effect of block.effects || []) {
      for (const item of effect.exclusive || []) {
        if (!item.lv) errors.push(`${label}: effect.exclusive に lv が無い`);
        if (item.kind !== "change" && item.kind !== "add") {
          errors.push(`${label}: effect.exclusive の kind「${item.kind}」は change / add のみ`);
        }
        if (item.kind === "add" && !item.text) errors.push(`${label}: 専用Lv${item.lv} の追加効果に本文（text）が無い`);
        if (item.kind === "change" && !item.multiplier && !item.duration && !item.chance && !item.text) {
          errors.push(`${label}: 専用Lv${item.lv} の変更に multiplier / duration / chance / text のどれも無い`);
        }
        // 「もし専用なら」「矢印だけ」の表現は使わない（表示ルール4）
        const words = [item.text, item.multiplier, item.duration, item.chance, item.note].filter(Boolean).join(" ");
        if (/→|もし専用/.test(words)) errors.push(`${label}: 専用Lv${item.lv} の文言に矢印または「もし専用」が入っている`);
        // 専用の合計表示が damage.exclusiveLvNTotal と一致すること
        const checkTotal = !item.condition || item.total;
        if (checkTotal && item.kind === "change" && item.multiplier && effect.damageTotal === "base" && skill.damage && !skill.damage.nonAttackMultiplier) {
          const expected = skill.damage[`exclusiveLv${item.lv}Total`];
          const computed = exclusiveMultiplierTotal(skill, item);
          if (computed !== null && expected && computed !== expected) {
            errors.push(`${label}: 専用Lv${item.lv} の倍率「${item.multiplier}」から出る合計 ${computed} が exclusiveLv${item.lv}Total ${expected} と合わない`);
          }
        }
      }
    }
  }
}

/** 専用武器枠に、統合済みの効果や「専用武器効果なし」が残っていないか（表示ルール6）。 */
function validateRenderedWeapon(skill, html, errors) {
  const label = `${skill.id} (S${skill.number} ${skill.name})`;
  if (/専用武器(?:効果|での直接強化|による強化|での強化)なし|専用効果なし/.test(html)) {
    errors.push(`${label}: 生成HTMLに「専用武器効果なし」の枠が残っている`);
  }
  const rows = renderer.weaponRows(skill);
  if (!rows.length && html.includes("専用武器</h3>")) {
    errors.push(`${label}: 残す行が無いのに専用武器枠が出ている`);
  }
  for (const lv of (skill.exclusiveIntegrated || []).map(Number)) {
    if (Object.prototype.hasOwnProperty.call(skill.exclusiveRest || {}, String(lv))) continue;
    if (rows.some((row) => row.head === `専用Lv${lv}`)) {
      errors.push(`${label}: 統合済みの専用Lv${lv} が専用武器枠に重複して出ている`);
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
/**
 * steps / multiplierText に書いた倍率・回数と damage の数値が食い違っていないかを点検する。
 * 数値の正は sourceUrl の原文（専用武器なし・スキルLv最大）で、ここはその転記ミスを拾う網。
 */
function damageTexts(skill) {
  return [skill.multiplierText, ...(skill.steps || []).map((step) => step.text)].join(" ");
}

/** 本文に出てくる倍率（攻撃力×N% / 物理N% / 魔法N%）。 */
function textMultipliers(text) {
  return [...new Set([...text.matchAll(/(?:攻撃力×|物理|魔法)([0-9]+(?:\.[0-9]+)?)%/g)].map((m) => Number(m[1])))];
}

/**
 * 本文から読み取れるヒット数の候補。
 * 「×N回」「N体」のほか、「正面の敵と隣接する敵N体」は N+1 体、
 * 「再発動(最大N回)」があるスキルは発動回数ぶん掛けた数も候補に入れる。
 */
function textHitCounts(text) {
  const perCast = new Set();
  for (const m of text.matchAll(/×([0-9]+)回/g)) perCast.add(Number(m[1]));
  for (const m of text.matchAll(/([0-9]+)回攻撃/g)) perCast.add(Number(m[1]));
  for (const m of text.matchAll(/([0-9]+)体/g)) perCast.add(Number(m[1]));
  for (const m of text.matchAll(/隣接する敵([0-9]+)体/g)) perCast.add(Number(m[1]) + 1);
  const casts = new Set([1]);
  for (const m of text.matchAll(/再発動[^。]{0,12}?([0-9]+)回/g)) casts.add(Number(m[1]) + 1);
  for (const m of text.matchAll(/([0-9]+)\s*回(?:まで)?再発動/g)) casts.add(Number(m[1]) + 1); // 「1回再発動」の語順
  const all = new Set();
  for (const hits of perCast) for (const cast of casts) all.add(hits * cast);
  return [...all];
}

function validateDamageNumbers(skill, errors) {
  const damage = skill.damage;
  if (!damage) return;
  const label = `${skill.id} (S${skill.number} ${skill.name})`;
  const { singleMultiplier, hitCount, baseTotal } = damage;

  // 倍率が混在するスキル（初撃だけ倍率が違う等）は single×hit で表せないので mixedMultiplier を立てる
  if (!damage.mixedMultiplier && singleMultiplier && hitCount && baseTotal && singleMultiplier * hitCount !== baseTotal) {
    errors.push(`${label}: singleMultiplier ${singleMultiplier}% × hitCount ${hitCount} = ${singleMultiplier * hitCount} が baseTotal ${baseTotal} と合わない`);
  }
  if (damage.nonAttackMultiplier) return;

  const text = damageTexts(skill);
  const multipliers = textMultipliers(text);
  if (singleMultiplier && multipliers.length && !multipliers.includes(singleMultiplier)) {
    errors.push(`${label}: singleMultiplier ${singleMultiplier}% が steps/multiplierText の倍率[${multipliers.join(", ")}]%に無い`);
  }
  const counts = textHitCounts(text);
  if (hitCount > 1 && counts.length && !counts.includes(hitCount)) {
    errors.push(`${label}: hitCount ${hitCount} が steps/multiplierText から読み取れる回数[${counts.join(", ")}]に無い`);
  }
}

/**
 * conditionMaxTotal が「原文の倍率・回数・倍加」から説明できるかを点検する。
 * 専用武器ぶんは baseTotal / conditionMaxTotal に混ぜない決まりなので、
 * 説明できない値は専用武器の混入か転記ミスとみなしてエラーにする。
 */
/** 「専用Lv…」に触れている文は、専用武器なしの計算に使わないので落とす。 */
function withoutWeaponClauses(text) {
  return String(text || "").split(/[。/／]/).filter((part) => !part.includes("専用")).join(" ");
}

function conditionMaxExplanation(skill) {
  const g = skill.damage;
  const body = withoutWeaponClauses([skill.condition, ...(skill.steps || []).map((x) => x.text)].join("。"));
  // 倍率候補: 本文は「物理N%」など接頭辞つき、multiplierText は火力欄なので素の N% も拾う
  const nums = new Set([...body.matchAll(/(?:攻撃力×|物理|魔法)([0-9]+(?:\.[0-9]+)?)%/g)].map((m) => Number(m[1])));
  for (const m of withoutWeaponClauses(skill.multiplierText).matchAll(/([0-9]+(?:\.[0-9]+)?)%/g)) nums.add(Number(m[1]));
  for (const m of body.matchAll(/最大([0-9]+(?:\.[0-9]+)?)%/g)) nums.add(Number(m[1])); // 「最大1800%」のような上限値
  const text = `${withoutWeaponClauses(skill.multiplierText)} ${body}`;
  const counts = new Set([1, g.hitCount].filter(Boolean)); // 追加攻撃1回ぶんも候補に入れる
  for (const m of text.matchAll(/×\s*([0-9]+)\s*回/g)) counts.add(Number(m[1]));
  for (const m of text.matchAll(/([0-9]+)\s*回(?:攻撃|発動)/g)) counts.add(Number(m[1]));
  for (const m of text.matchAll(/(?:攻撃回数|回数)[^。]{0,10}?([0-9]+)\s*回/g)) counts.add(Number(m[1]));
  for (const m of text.matchAll(/([0-9]+)\s*体/g)) counts.add(Number(m[1]));
  for (const m of text.matchAll(/隣接する敵([0-9]+)体/g)) counts.add(Number(m[1]) + 1);
  for (const m of text.matchAll(/最大([0-9]+)\s*回/g)) counts.add(Number(m[1]));
  // 本体と追加攻撃が同じ倍率のスキル用に、回数どうしの和も候補に入れる
  const explicit = [...counts].filter((n) => n !== 1);
  for (const a of explicit) for (const b of explicit) counts.add(a + b);
  const casts = new Set([1]);
  for (const m of text.matchAll(/再発動[^。]{0,16}?([0-9]+)\s*回/g)) casts.add(Number(m[1]) + 1);
  for (const m of text.matchAll(/([0-9]+)\s*回(?:まで)?再発動/g)) casts.add(Number(m[1]) + 1); // 「1回再発動」の語順
  const factors = new Set([1]);
  for (const m of text.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*倍/g)) factors.add(Number(m[1]));

  const round = (n) => Math.round(n * 100) / 100;
  const target = g.conditionMaxTotal;
  for (const n of nums) for (const c of counts) for (const k of casts) for (const f of factors) {
    if (round(n * c * k * f) === target) return `${n}%×${c}${k > 1 ? `×${k}発動` : ""}${f > 1 ? `×${f}倍` : ""}`;
    if (round((g.baseTotal + n * c) * k * f) === target) return `基本${g.baseTotal}% + 追加${n}%×${c}${k > 1 ? `、×${k}発動` : ""}${f > 1 ? `、×${f}倍` : ""}`;
  }
  for (const f of factors) for (const k of casts) if (round(g.baseTotal * f * k) === target) return `基本${g.baseTotal}%${f > 1 ? `×${f}倍` : ""}${k > 1 ? `×${k}発動` : ""}`;
  return null;
}

function validateConditionMax(skill, errors) {
  const g = skill.damage;
  if (!g || g.nonAttackMultiplier) return;
  if (!(g.conditionMaxTotal > g.baseTotal)) return;
  if (!conditionMaxExplanation(skill)) {
    errors.push(`${skill.id} (S${skill.number} ${skill.name}): conditionMaxTotal ${g.conditionMaxTotal} を原文の倍率・回数・倍加から説明できない（専用武器ぶんの混入を疑う）`);
  }
}

/** 1ファイルも書き出す前にデータを点検する（検証に落ちたら出力を残さない）。 */
const RELEASE_KIND = "初回実装";
const PICKUP_KINDS = new Set(["PU", "復刻", "星の導き", RELEASE_KIND]);

/**
 * pickupHistory の点検。
 * 出典にある回数（pickupCount）より多い回次を作らない／回次を重複させない／
 * 日付の形を崩さないことを機械で担保する。中間の復刻が出典に無く日付を載せられない
 * 回があるのは想定内なので、件数が回数より少ないことはエラーにしない。
 */
function validatePickupHistory(character, errors) {
  const history = character.pickupHistory;
  if (history === undefined) return;
  const where = `${character.id} の pickupHistory`;
  if (!Array.isArray(history) || history.length === 0) {
    errors.push(`${where}: 空配列・非配列は置かないこと`);
    return;
  }
  const releaseOnly = history.every((item) => item.kind === RELEASE_KIND);
  const rounds = [];
  for (const item of history) {
    if (!item.date) errors.push(`${where}: date が無い項目があります`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) && !/^\d{4}-\d{2}$/.test(item.date)) {
      errors.push(`${where}: date の形式が不正です（${item.date}）。YYYY-MM-DD か YYYY-MM のみ`);
    }
    if (item.endDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.endDate)) errors.push(`${where}: endDate の形式が不正です（${item.endDate}）`);
      else if (item.date && String(item.endDate) < String(item.date)) errors.push(`${where}: endDate が date より前です（${item.date} 〜 ${item.endDate}）`);
    }
    if (!item.kind) errors.push(`${where}: kind が無い項目があります`);
    else if (!PICKUP_KINDS.has(item.kind)) errors.push(`${where}: kind が未定義です（${item.kind}）`);
    if (item.round !== undefined) {
      if (!Number.isInteger(item.round) || item.round < 1) errors.push(`${where}: round は1以上の整数にすること（${item.round}）`);
      else rounds.push(item.round);
    }
    // 回次と開催ガチャの対応（出典の凡例: 1回目=PU / 2〜3回目=復刻 / 4回目以降=星の導き）
    if (Number.isInteger(item.round) && item.kind !== RELEASE_KIND) {
      const expected = item.round === 1 ? "PU" : item.round <= 3 ? "復刻" : "星の導き";
      if (item.kind !== expected) errors.push(`${where}: ${item.round}回目の kind は ${expected} のはずです（${item.kind}）`);
    }
  }
  if (new Set(rounds).size !== rounds.length) errors.push(`${where}: round が重複しています（${rounds.join(", ")}）`);
  const sorted = history.map((item) => String(item.date));
  if (sorted.join("|") !== [...sorted].sort().join("|")) errors.push(`${where}: date の昇順になっていません`);

  if (releaseOnly) {
    // リリース組は PU 実績が無い。pickupCount を付けるとPU履歴バッジが出てしまう。
    if (character.pickupCount !== undefined) errors.push(`${where}: 初回実装のみの体に pickupCount は付けないこと`);
    return;
  }
  if (character.pickupCount === undefined) { errors.push(`${where}: pickupCount（出典のPU回数）が必要です`); return; }
  if (!Number.isInteger(character.pickupCount) || character.pickupCount < 1) {
    errors.push(`${character.id}: pickupCount は1以上の整数にすること（${character.pickupCount}）`);
    return;
  }
  const over = rounds.filter((r) => r > character.pickupCount);
  if (over.length) errors.push(`${where}: 出典のPU回数 ${character.pickupCount} を超える回次があります（${over.join(", ")}）`);
  if (history.length > character.pickupCount) errors.push(`${where}: 件数 ${history.length} が出典のPU回数 ${character.pickupCount} を超えています`);
}

/** 読みに使ってよい文字。ひらがな・長音符・中黒のみ（カタカナと全角英数は弾く）。 */
const READING_PATTERN = /^[ぁ-ゖー・]+$/;

/**
 * 読み仮名（characters[].reading）の検査。
 * 「編成と比較」の検索が読みで引けるかどうかはここだけが担保する。
 * 欠落・カタカナ混入・全角英数の混入はエラーにする。
 */
function validateReading(character, errors) {
  const where = `${character.id} の reading`;
  const reading = character.reading;
  if (!reading || typeof reading !== "object") {
    errors.push(`${where}: 読みがありません（全キャラに reading.name が必要です）`);
    return;
  }
  const hasTitle = /^\[[^\]]*\]/.test(String(character.name));

  if (!reading.name) errors.push(`${where}.name: 名前の読みがありません`);
  else if (!READING_PATTERN.test(reading.name)) {
    errors.push(`${where}.name: ひらがな・長音符・中黒だけで書くこと（${reading.name}）`);
  }

  if (hasTitle && !reading.title) errors.push(`${where}.title: 肩書き付きなので肩書きの読みが必要です`);
  if (!hasTitle && reading.title) errors.push(`${where}.title: 肩書きが無いので読みも置かないこと`);
  if (reading.title && !READING_PATTERN.test(reading.title)) {
    errors.push(`${where}.title: ひらがな・長音符・中黒だけで書くこと（${reading.title}）`);
  }

  // aliases は任意。読みの揺れ（こがねいろのせいけんづかい など）を足す欄。
  if (reading.aliases !== undefined) {
    if (!Array.isArray(reading.aliases) || reading.aliases.length === 0) {
      errors.push(`${where}.aliases: 空配列・非配列は置かないこと（使わないなら項目ごと消す）`);
    } else {
      for (const alias of reading.aliases) {
        if (typeof alias !== "string" || !READING_PATTERN.test(alias)) {
          errors.push(`${where}.aliases: ひらがな・長音符・中黒だけで書くこと（${alias}）`);
        } else if (alias === reading.name || alias === reading.title) {
          errors.push(`${where}.aliases: name / title と同じ読みは要りません（${alias}）`);
        }
      }
    }
  }

  for (const key of Object.keys(reading)) {
    if (!["name", "title", "aliases"].includes(key)) errors.push(`${where}: 未定義の項目です（${key}）`);
  }
}

function validateAll({ baseData, terms }) {
  const errors = [];
  let flowSkills = 0;
  for (const character of baseData.characters || []) {
    validatePickupHistory(character, errors);
    validateReading(character, errors);
  }
  for (const skill of baseData.skills || []) {
    validateFlow(skill, errors);
    validateDamageNumbers(skill, errors);
    validateConditionMax(skill, errors);
    validateExclusive(skill, errors);
    const card = renderer.renderSkillCard(skill, terms);
    validateRenderedWeapon(skill, card, errors);
    if (Array.isArray(skill.flow) && skill.flow.length > 0) {
      flowSkills += 1;
      validateRenderedCard(skill, card, errors);
    }
  }
  if (errors.length) {
    for (const message of errors) console.error(`検証NG: ${message}`);
    throw new Error(`データ検証に失敗しました（${errors.length}件）。上のログを確認してください。`);
  }
  return flowSkills;
}

function buildCharacterPages({ baseData, newsData, terms, ads }) {
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
      metaHtml: renderer.renderMetaHtml(character, newsData, TODAY),
      skillListHtml: renderer.renderSkillList(skills, terms),
      description: renderer.pageDescription(character, skills),
      ads
    });

    const path = join(PAGES_DIR, `${slug}.html`);
    slugs.push(slug);
    (writeIfChanged(path, html) ? written : unchanged).push(slug);
  }

  return { written, unchanged, slugs };
}

/**
 * ツール用のキャラ索引を data/mementomori-skills.json から生成する。
 * スピード計算・キャラページは skills.json を直接読むが、
 * ガチャシミュレーターのような軽量ページに1.3MBを読ませたくないため、
 * 必要な項目（表示名・属性・スピード）だけを射影した小さなJSONを置く。
 * キャラ一覧を自前で持つツールはこのファイル（または skills.json）を参照し、
 * 名前や属性を二重管理しないこと。
 */
function buildCharacterIndex({ baseData }) {
  const characters = (baseData.characters || [])
    .filter((character) => character.id && character.name)
    .map((character) => ({
      id: character.id,
      pageSlug: character.pageSlug || character.id,
      name: character.name,
      // 読みは「編成と比較」の検索が使う。正は mementomori-skills.json 側。
      reading: character.reading,
      attribute: character.attribute,
      weaponType: character.weaponType,
      speed: character.speed,
      availability: character.availability
    }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));

  const path = join(DATA_DIR, "character-index.json");
  const payload = {
    schema: "character-index/1",
    note: "data/mementomori-skills.json の characters から自動生成。直接編集しないこと（scripts/build-character-pages.mjs が上書きする）。",
    generatedFrom: "data/mementomori-skills.json",
    updatedAt: baseData.updatedAt || null,
    generatedAt: GENERATED_AT,
    statusDate: TODAY,
    characters
  };

  // 生成時刻は毎回変わるので、そのまま書くと中身が同じでも毎日差分が出て
  // 日次ビルドが空コミットを積む。生成時刻と判定日**以外**が前回と同じなら
  // 前回の値を残し、ファイルを書き換えない。
  // （中身が変わらない日は判定結果も変わらないため、古い判定日のままでも表示は正しい）
  const previous = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  if (previous) {
    const strip = (o) => JSON.stringify({ ...o, generatedAt: null, statusDate: null });
    if (strip(previous) === strip(payload)) {
      payload.generatedAt = previous.generatedAt;
      payload.statusDate = previous.statusDate;
    }
  }

  return { changed: writeIfChanged(path, `${JSON.stringify(payload, null, 2)}\n`), total: characters.length };
}

/**
 * トップページ（ROOT の index.html）のニュース欄を公開前に書き込む。
 * JSを無効にしても直近のお知らせが読める状態を保つ。
 * 選別と組み立ては js/render-news.js に集約してある（ブラウザ側と同じモジュール）。
 */
function buildTopPage({ newsData }) {
  const path = join(ROOT, "index.html");
  const html = readFileSync(path, "utf8");
  const items = newsRenderer.selectNews(newsData);
  const listHtml = items.length ? `${newsRenderer.renderNewsList(items)}\n      ` : "";

  const listPattern = /(<div class="news-list" id="newsList">)[\s\S]*?(<\/div>)/;
  if (!listPattern.test(html)) throw new Error("index.html の差し替え対象が見つかりません: #newsList");

  let output = html.replace(listPattern, (match, open, close) => `${open}${listHtml}${close}`);

  // ニュースが1件以上あるときは hidden を外す（0件なら節ごと隠したままにする）
  const sectionPattern = /<section([^>]*)\sid="newsSection"([^>]*)>/;
  if (!sectionPattern.test(output)) throw new Error("index.html の差し替え対象が見つかりません: #newsSection");
  output = output.replace(sectionPattern, (match, before, after) => {
    const attrs = `${before} id="newsSection"${after}`.replace(/\s*\bhidden\b/g, "");
    return `<section${attrs}${items.length ? "" : " hidden"}>`;
  });

  // 本文を書き込んだ目印。ブラウザ側はこれを見て再描画しない。
  output = output.replace(/<body(?![^>]*\sdata-prerendered)([^>]*)>/, (match, attrs) => `<body${attrs} data-prerendered>`);

  return { changed: writeIfChanged(path, output), total: items.length };
}

function buildIndexPage({ baseData }) {
  const characters = baseData.characters || [];
  const path = join(PAGES_DIR, "index.html");
  const html = patchIndexHtml(readFileSync(path, "utf8"), {
    gridHtml: indexRenderer.renderGrid(characters, "all", TODAY),
    countText: indexRenderer.countText(characters.length, characters.length)
  });
  return { changed: writeIfChanged(path, html), total: characters.length };
}

function main() {
  const baseData = readJson(join(DATA_DIR, "mementomori-skills.json"), { characters: [], skills: [] });
  const newsData = readJson(join(DATA_DIR, "news.json"), { items: [] });
  const terms = readJson(join(DATA_DIR, "terms.json"), { terms: {} }).terms || {};
  // 広告の設定の正は data/site-config.json。ページ種別ごとの出し分けはここで決める
  // （characters: 出す / status: 出す / TOP: 出さない）。
  const ads = readJson(join(DATA_DIR, "site-config.json"), { ads: {} }).ads || {};

  const flowSkills = validateAll({ baseData, terms });
  const pages = buildCharacterPages({ baseData, newsData, terms, ads });
  // 状態異常ガイドはキャラページの後。直リンク先の id="skill-N" を生成済みHTMLで確かめる。
  const status = buildStatusGuides({ baseData, terms, ads, writeIfChanged });
  const index = buildIndexPage({ baseData });
  const charIndex = buildCharacterIndex({ baseData });
  const topPage = buildTopPage({ newsData });
  // 広告枠は全ページを書き終えた最後に差し込む（手書きページの目印もここで置き換える）。
  const ads2 = buildAds({ writeIfChanged });

  console.log(`キャラページ: ${pages.slugs.length}件 (更新 ${pages.written.length} / 変更なし ${pages.unchanged.length})`);
  console.log(`flow 付きスキル: ${flowSkills}件（検証OK）`);
  console.log(`キャラ一覧: ${index.total}件のカードを生成${index.changed ? " (更新)" : " (変更なし)"}`);
  console.log(`ツール用キャラ索引: ${charIndex.total}件${charIndex.changed ? " (更新)" : " (変更なし)"}`);
  console.log(`トップのニュース欄: ${topPage.total}件${topPage.changed ? " (更新)" : " (変更なし)"}`);
  for (const guide of status.guides) {
    const counts = status.summary[guide.id];
    const detail = Object.entries(counts)
      .map(([kind, value]) => `${kind} 抽出${value.auto}/手入力${value.manual}${value.ignored ? `/除外${value.ignored}` : ""}${value.examplesOnly ? "（例のみ・全件検査なし）" : ""}`)
      .join(" / ");
    console.log(`状態異常ガイド(${guide.id}): ${detail} / 最終横断確認 ${guide.lastCrossCheck}`);
  }
  if (status.guides.length) {
    console.log(`状態異常ガイド: ${status.guides.length}件（直リンク ${status.links}本・付与数値 ${status.numbers}件を照合）${status.written.length ? ` (更新 ${status.written.join(", ")})` : " (変更なし)"}`);
    console.log(`状態異常ガイドの入口: ${status.indexChanged ? "更新" : "変更なし"} / sitemap: ${status.sitemap.added.length ? `${status.sitemap.added.join(", ")} を追記` : "変更なし"}`);
  }
  console.log(`広告枠: ${ads2.enabled ? `${ads2.shown}ページに1枠ずつ（スロット ${ads2.slot}）` : "全停止中"} / ${ads2.total}ページを点検${ads2.written.length ? ` (更新 ${ads2.written.length}件)` : " (変更なし)"}`);
  console.log(`開催状況の判定日(JST): ${TODAY} / 生成時刻: ${GENERATED_AT}`);
  const ongoing = (baseData.characters || []).filter((character) => gachaStatus.ongoingEntry(character, TODAY));
  console.log(`開催中と判定: ${ongoing.length}体${ongoing.length ? ` (${ongoing.map((c) => `${c.name}=${gachaStatus.gachaStatusText(c, TODAY)}`).join(" / ")})` : ""}`);
}

main();
