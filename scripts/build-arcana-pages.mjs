import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { versioned } from "./asset-version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { escapeHtml, renderCard } = require("../js/render-arcana.js");
const { arcanaGachaSummary, jstNow } = require("../js/gacha-status.js");
const SITE = "https://memento.musoudc.com";
const SITE_NAME = "ミレストのメメントモリ分析データ室";
const TITLE = `アルカナ検索 / ${SITE_NAME}`;
const DESCRIPTION = "アルカナ101件の効果と構成キャラ、ガチャの開催状況を確認できます。";
const HISTORY_KEYS = ["date", "endDate", "startTime", "endTime", "kind", "round", "announced"];

function searchIndex(baseData, arcana, meta) {
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

function pageHtml(index, now) {
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
</head>
<body>
  <header class="page-header">
    <nav class="breadcrumb" aria-label="パンくず"><a href="/">トップ</a><span>/</span><a href="../characters/index.html">キャラ情報</a><span>/</span><span aria-current="page">アルカナ検索</span></nav>
    <h1>アルカナ検索</h1>
    <p>${escapeHtml(DESCRIPTION)}</p>
    <p>開催状況：${escapeHtml(jstNow(now).replace(/-/g, "/").replace("T", " "))} 時点</p>
    <p class="arcana-note">検索機能は準備中です（いまは全件を表示しています）</p>
  </header>
  <main>
${index.arcana.map(item => renderCard(item, index.characters, summaries)).join("\n")}
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
</body>
</html>
`;
}

export function buildArcanaPages({ baseData, arcana, meta, now, writeIfChanged }) {
  const index = searchIndex(baseData, arcana, meta);
  const json = `${JSON.stringify(index, null, 2)}\n`;
  const bytes = Buffer.byteLength(json);
  const gzipBytes = gzipSync(json).length;
  if (gzipBytes > 150 * 1024) throw new Error("停止: アルカナ検索用データが gzip 150KB を超えました");
  mkdirSync(join(ROOT, "pages/arcana"), { recursive: true });
  const indexChanged = writeIfChanged(join(ROOT, "data/arcana-index.json"), json);
  const pageChanged = writeIfChanged(join(ROOT, "pages/arcana/index.html"), pageHtml(index, now));
  console.log(`アルカナ一覧: ${index.arcana.length}件 / 検索用データ ${(bytes / 1024).toFixed(1)} KB（${indexChanged || pageChanged ? "更新" : "変更なし"}）`);
  return { bytes, gzipBytes, indexChanged, pageChanged };
}
