import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { versioned } from "./asset-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { escapeHtml, renderCard } = require("../js/render-arcana.js");
const { renderAnalyticsHead } = require("../js/render-analytics.js");
const { arcanaGachaSummary, jstNow } = require("../js/gacha-status.js");
const SITE = "https://memento.musoudc.com";
const SITE_NAME = "ミレストのメメントモリ分析データ室";
const TITLE = `アルカナ検索 | ${SITE_NAME}`;
const DESCRIPTION = "アルカナ101件の効果と構成キャラ、ガチャの開催状況を確認できます。";
const HISTORY_KEYS = ["date", "endDate", "startTime", "endTime", "kind", "round", "announced"];

export function searchIndex(baseData, arcana, meta) {
  const rows = arcana.arcana.slice().sort((a, b) => a.id.localeCompare(b.id)).map(item => ({
    id: item.id,
    name: item.name,
    ...(item.aliases?.length ? { aliases: item.aliases } : {}),
    members: item.members.slice().sort((a, b) => a.slot - b.slot).map(member => member.characterId || null),
    stages: item.stages.map(stage => ({
      label: stage.label,
      condition: stage.condition.displayText,
      pending: stage.condition.verification === "conflict",
      effects: stage.effects.map(effect => ({
        statKey: effect.statKey,
        target: effect.target,
        text: effect.displayText,
        pending: ["conflict", "unknown"].includes(effect.verification)
      }))
    }))
  }));
  const canonical = new Map(baseData.characters.map(character => [character.id, character]));
  const characters = {};
  for (const id of [...new Set(rows.flatMap(row => row.members).filter(Boolean))].sort()) {
    const original = canonical.get(id);
    const character = original || meta.characters[id];
    if (!character) throw new Error(`アルカナ構成キャラが見つかりません: ${id}`);
    characters[id] = {
      name: character.name,
      reading: character.reading,
      attribute: character.attribute,
      pageSlug: original ? character.pageSlug : null,
      availability: original ? character.availability || "" : "",
      ...(original && character.pickupCount !== undefined ? { pickupCount: character.pickupCount } : {}),
      pickupHistory: original ? (character.pickupHistory || []).map(entry => Object.fromEntries(
        HISTORY_KEYS.filter(key => entry[key] !== undefined && entry[key] !== null && entry[key] !== "")
          .map(key => [key, entry[key]]))) : []
    };
  }
  return { schema: "miresto_arcana_index_v1", note: "data/arcana.json と data/mementomori-skills.json から生成。手で直さない。", arcana: rows, characters };
}

export function affiliationsByCharacter(index) {
  const affiliations = new Map(Object.keys(index.characters).map(id => [id, []]));
  for (const item of index.arcana) {
    for (const id of new Set(item.members.filter(Boolean))) affiliations.get(id).push(item);
  }
  return affiliations;
}

const EFFECT_GROUPS = [
  ["基礎", [["attack", "攻撃力"], ["hp", "HP"], ["defense", "防御力"], ["physical_defense", "物理防御力"], ["magical_defense", "魔法防御力"]]],
  ["能力", [["strength", "腕力"], ["dexterity", "技力"], ["magic", "魔力"], ["stamina", "耐久力"]]],
  ["クリティカル", [["critical", "クリティカル"], ["critical_resistance", "クリティカル耐性"], ["critical_damage", "クリダメ強化"], ["physical_critical_mitigation", "物理クリダメ緩和"], ["magical_critical_mitigation", "魔法クリダメ緩和"]]],
  ["命中・回避", [["accuracy", "命中"], ["evasion", "回避"], ["debuff_accuracy", "弱体効果命中"], ["debuff_resistance", "弱体効果耐性"]]],
  ["その他戦闘", [["hp_drain", "HPドレイン"], ["counter", "カウンタ"]]],
  ["貫通", [["physical_penetration", "物理防御貫通"], ["physical_magical_penetration", "物魔防御貫通"], ["penetration", "防御貫通"]]],
  ["上限", [["party_level_cap", "パーティLv上限"], ["member_awakening_cap", "アルカナキャラ進化上限"]]]
];

function choices(name, entries, type = "checkbox", initial = "") {
  return entries.map(([value, label]) => `<label class="arcana-choice"><input type="${type}" name="${name}" value="${value}"${value === initial ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("\n");
}

function searchControls() {
  return `<aside class="arcana-search-panel" data-search-controls hidden aria-labelledby="search-heading">
    <h2 id="search-heading">検索条件</h2>
    <fieldset><legend>欲しい効果</legend>
      <div class="arcana-quick-effects">${choices("effect", [["attack", "攻撃力"], ["hp", "HP"], ["evasion", "回避"], ["critical", "クリティカル"]])}</div>
      <details><summary>すべての効果</summary>
        ${EFFECT_GROUPS.map(([group, entries]) => `<fieldset><legend>${group}</legend>${group === "貫通" ? '<label class="arcana-choice"><input type="checkbox" name="effectGroup" value="physical_penetration,physical_magical_penetration,penetration" data-effect-group="penetration"><span>貫通をまとめて選択</span></label>' : ""}${choices("effect", entries)}</fieldset>`).join("\n")}
      </details>
    </fieldset>
    <fieldset><legend>効果の対象</legend>${choices("target", [["all", "全キャラ"], ["members", "構成キャラ"], ["party", "パーティ"], ["other", "その他"], ["unknown", "対象未確認"]])}</fieldset>
    <fieldset><legend>検索する段階</legend>${choices("stage", [["lr", "LR"], ["any", "すべての段階"]], "radio", "lr")}</fieldset>
    <label class="arcana-field">アルカナ名<input type="search" name="an" value=""></label>
    <label class="arcana-field">キャラ名<input type="search" name="cn" value="" aria-controls="character-candidates" autocomplete="off"></label>
    <input type="hidden" name="character" value="">
    <div id="character-candidates" data-character-candidates aria-label="キャラ名の候補"></div>
    <details class="arcana-advanced"><summary>人数・開催状況・日数 <span data-advanced-count>0件適用中</span></summary>
      <fieldset><legend>必要人数</legend>${choices("count", [["2", "2人"], ["3", "3人"], ["4", "4人"]])}</fieldset>
      <fieldset><legend>開催状況</legend>${choices("status", [["ongoing", "開催中"], ["upcoming", "開催予定"], ["waiting", "復刻待ち"], ["permanent", "恒常"], ["history_unknown", "履歴未確認"]])}</fieldset>
      <fieldset><legend>日数の基準</legend>${choices("basis", [["end", "前回終了から"], ["start", "最終登場の開始から"]], "radio", "end")}</fieldset>
      <label class="arcana-field">最小日数<input type="number" name="minDays" min="0" max="99999" step="1" inputmode="numeric"></label>
      <label class="arcana-field">最大日数<input type="number" name="maxDays" min="0" max="99999" step="1" inputmode="numeric"></label>
      <fieldset><legend>キャラ条件の範囲</legend>${choices("scope", [["any", "1人以上"], ["all", "全員"], ["named", "検索したキャラ"]], "radio", "any")}</fieldset>
    </details>
    <label class="arcana-field">並び替え<select name="sort">
      <option value="catalog">管理番号</option><option value="name">名前順</option><option value="count">必要人数の少ない順</option><option value="days_desc">構成内の最大経過日数が長い順</option>
    </select></label>
    <div data-active-filters aria-label="適用中の条件"></div>
    <button type="button" data-clear-filters>条件をすべて解除</button>
    <a class="arcana-results-link" href="#arcana-results">結果へ</a>
  </aside>`;
}

function pageHtml(index, now, analytics) {
  const canonical = `${SITE}/pages/arcana/index.html`;
  const summaries = Object.fromEntries(Object.entries(index.characters).map(([id, character]) =>
    [id, arcanaGachaSummary(character, now)]));
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(TITLE)}</title>
  <meta name="description" content="${escapeHtml(DESCRIPTION)}">
  <meta name="robots" content="noindex">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
  <meta property="og:locale" content="ja_JP">
  <meta property="og:title" content="${escapeHtml(TITLE)}">
  <meta property="og:description" content="${escapeHtml(DESCRIPTION)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${SITE}/assets/ogp/ogp-common.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/png" href="../../${versioned("assets/miresto/miresto-icon-32.png")}" sizes="32x32">
  <link rel="apple-touch-icon" href="../../${versioned("assets/miresto/miresto-icon-180.png")}">
  <link rel="stylesheet" href="../../${versioned("assets/site-footer.css")}">
  <link rel="stylesheet" href="../../${versioned("assets/arcana.css")}">
${renderAnalyticsHead(analytics, "  ")}
</head>
<body>
  <header class="page-header">
    <nav class="breadcrumb" aria-label="パンくず"><a href="/">トップ</a><span>/</span><a href="../characters/index.html">キャラ情報</a><span>/</span><span aria-current="page">アルカナ検索</span></nav>
    <h1>アルカナ検索</h1>
    <p>${escapeHtml(DESCRIPTION)}</p>
    <p data-status-time>開催状況：${escapeHtml(jstNow(now).replace(/-/g, "/").replace("T", " "))} 時点</p>
    <p class="arcana-note" data-search-fallback>検索データの読み込み前・JavaScript無効時は全件を表示します。</p>
  </header>
  <main class="arcana-search-layout" data-arcana-search data-index-src="../../${versioned("data/arcana-index.json")}">
    <p class="arcana-search-error arcana-note" data-search-error role="status" hidden></p>
    ${searchControls()}
    <section class="arcana-results" id="arcana-results" aria-label="検索結果" tabindex="-1">
    <p data-result-count aria-live="polite">検索結果 ${index.arcana.length}件／全${index.arcana.length}件</p>
    <div data-hidden-open hidden><p>このアルカナは今の条件では表示されていません</p><button type="button" data-reveal-open>条件を解除して表示</button></div>
    <p class="arcana-note" data-sort-note hidden>構成キャラのうち最も長い日数で並べています</p>
    <div data-empty-results hidden><p>条件に一致するアルカナはありません</p><p>確認中の効果は効果の条件に一致しません</p><div data-empty-filters aria-label="適用中の条件"></div><button type="button" data-clear-filters>条件をすべて解除</button></div>
${index.arcana.map(item => renderCard(item, index.characters, summaries)).join("\n")}
    </section>
  </main>
  <footer class="site-footer">
    <div class="footer-inner">
      <span>ミレストのメメントモリ分析データ室 / 非公式ファンサイト</span>
      <nav class="footer-links site-footer-links" aria-label="サイト内のページ">
        <a href="/">トップ</a>
        <a href="../characters/index.html">キャラ一覧</a>
        <a href="../../compare-prototype.html">スキル比較DB</a>
        <a href="/pages/guide/">このサイトでできること</a>
        <a href="/privacy.html">プライバシーポリシー</a>
        <a href="/disclaimer.html">免責事項</a>
        <a href="/about.html">このサイトについて</a>
        <a href="/contact.html">お問い合わせ</a>
      </nav>
    </div>
  </footer>
${["gacha-status", "search-normalize", "render-arcana", "arcana-search"].map(name => `  <script defer src="../../${versioned(`js/${name}.js`)}"></script>`).join("\n")}
</body>
</html>
`;
}

export function buildArcanaPages({ index, now, analytics, writeIfChanged }) {
  const json = `${JSON.stringify(index, null, 2)}\n`;
  const bytes = Buffer.byteLength(json);
  const gzipBytes = gzipSync(json).length;
  if (gzipBytes > 150 * 1024) throw new Error("停止: アルカナ検索用データが gzip 150KB を超えました");
  mkdirSync(join(ROOT, "pages/arcana"), { recursive: true });
  const indexChanged = writeIfChanged(join(ROOT, "data/arcana-index.json"), json);
  const pageChanged = writeIfChanged(join(ROOT, "pages/arcana/index.html"), pageHtml(index, now, analytics));
  console.log(`アルカナ一覧: ${index.arcana.length}件 / 検索用データ ${(bytes / 1024).toFixed(1)} KB（${indexChanged || pageChanged ? "更新" : "変更なし"}）`);
  return { bytes, gzipBytes, indexChanged, pageChanged };
}
