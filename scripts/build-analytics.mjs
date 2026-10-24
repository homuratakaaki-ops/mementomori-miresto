#!/usr/bin/env node
/**
 * アクセス解析（GA4）の計測タグの差し込みと全ページ点検。
 *
 * 設定の正は data/site-config.json の analytics、マークアップの正は js/render-analytics.js。
 * **ページに計測コードを手書きしないこと。** 新しいページは何も書かなくても、
 * ビルドが head の中（</head> の直前。<!-- ad:head --> があればその手前）に
 * <!-- ga:head --> ごと差し込む。目印が既にあるページは中身だけを書き直す。
 *
 * 計測しないページは EXCLUDED_PAGES に挙げる。1ページだけ止めたいときは
 * <body data-analytics="off">、全停止は analytics.enabled=false。
 *
 * 生成ページ（キャラ詳細・状態異常ガイド）は、生成テンプレートが
 * js/render-analytics.js を直接呼んで目印ごと書き出す（同じ関数・同じ字下げなので二重書きにならない）。
 *
 * 呼び出しは scripts/build-character-pages.mjs から（buildAds の直後）。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ga = require(join(ROOT, "js", "render-analytics.js"));

/** HTMLを走査しないディレクトリ（scripts/build-ads.mjs と同じ）。 */
const SKIP_DIRS = new Set([".git", ".github", "node_modules", "docs"]);

/**
 * 計測しないページ。
 *   google979fbe70cb4d3990.html … 所有権確認ファイル（HTMLの体裁が無い）
 *   pack-viewer.html            … 開発用・noindex
 *   pages/characters/veela.html … 転送ページ。転送先で計測するので、ここで計測すると二重になる
 * 404・about・contact・privacy・disclaimer は計測する。増やすときは依頼で決めてから足すこと。
 */
const EXCLUDED_PAGES = new Set([
  "google979fbe70cb4d3990.html",
  "pack-viewer.html",
  "pages/characters/veela.html"
]);

/** 計測IDの手書き検査で読む文字ファイルの拡張子。 */
const TEXT_EXTS = new Set([".html", ".js", ".mjs", ".cjs", ".json", ".css", ".md", ".yml", ".yaml", ".xml", ".txt"]);

const CONFIG_REL = "data/site-config.json";

function listHtml(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listHtml(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
}

/**
 * 計測IDの手書き検査で読むファイル。.git・node_modules と、.github 以外の
 * 「.」始まりのフォルダ（手元の作業メモ・ツールの置き場）は読まない。
 */
function listTextFiles(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith(".") && name !== ".github") continue;
      listTextFiles(full, out);
    } else if (TEXT_EXTS.has(extname(name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

function toRel(path) {
  return relative(ROOT, path).split(sep).join("/");
}

function countOf(text, needle) {
  return text.split(needle).length - 1;
}

/** gtag('config' の数（引用符はどちらでも数える）。 */
function configCount(html) {
  return (html.match(/gtag\(\s*["']config["']/g) || []).length;
}

function isOff(html) {
  return /<body[^>]*\bdata-analytics\s*=\s*"off"/.test(html);
}

/* ------------------------------------------------------------------
 * 差し込み
 * ------------------------------------------------------------------ */

/** 目印（と前回の中身）を、今の設定で組み直した中身に置き換える。 */
function replaceRegion(html, open, close, replacement) {
  const openAt = html.indexOf(open);
  if (openAt < 0) return { html, found: false };
  const closeAt = html.indexOf(close, openAt);
  const end = closeAt < 0 ? openAt + open.length : closeAt + close.length;
  // 目印の行頭からの字下げを引き継ぐ（生成物の見た目をページに合わせる）。
  const lineStart = html.lastIndexOf("\n", openAt) + 1;
  const indent = /^[ \t]*$/.test(html.slice(lineStart, openAt)) ? html.slice(lineStart, openAt) : "";
  return { html: html.slice(0, lineStart) + replacement(indent) + html.slice(end), found: true };
}

/** 計測するページ1枚を書き直す。除外ページはここに来ない。 */
function applyToPage(html, analytics) {
  const effective = isOff(html) ? null : analytics;
  const replaced = replaceRegion(html, ga.HEAD_MARK, ga.HEAD_END, (indent) => ga.renderAnalyticsHead(effective, indent));
  if (replaced.found) return { html: replaced.html };

  // 目印がまだ無いページ: head の中の <!-- ad:head --> の手前、無ければ </head> の直前に入れる。
  const headEnd = html.indexOf("</head>");
  if (headEnd < 0) return { html, missingHead: true };
  const adAt = html.indexOf("<!-- ad:head -->");
  const anchor = adAt >= 0 && adAt < headEnd ? adAt : headEnd;
  const lineStart = html.lastIndexOf("\n", anchor) + 1;
  const found = html.slice(lineStart, anchor);
  const indent = /^[ \t]+$/.test(found) ? found : "  ";
  return { html: html.slice(0, lineStart) + ga.renderAnalyticsHead(effective, indent) + "\n" + html.slice(lineStart) };
}

/* ------------------------------------------------------------------
 * 点検
 * ------------------------------------------------------------------ */

function validatePage(relPath, html, analytics, errors) {
  const excluded = EXCLUDED_PAGES.has(relPath);
  const off = isOff(html);
  const scripts = countOf(html, ga.SCRIPT_SRC);
  const configs = configCount(html);
  const shouldMeasure = !excluded && !off && ga.analyticsReady(analytics);

  if (!shouldMeasure) {
    const why = excluded ? "計測しないページ（EXCLUDED_PAGES）" : off ? "data-analytics=\"off\" のページ" : "計測停止中（analytics.enabled）";
    if (scripts) errors.push(`${relPath}: ${why}に gtag.js の読み込みが ${scripts} 回ある`);
    if (configs) errors.push(`${relPath}: ${why}に gtag('config' が ${configs} 回ある`);
    return { measured: false, excluded, off };
  }

  if (scripts !== 1) errors.push(`${relPath}: gtag.js の読み込みは1ページ1回にすること（今は ${scripts} 回）`);
  if (configs !== 1) errors.push(`${relPath}: gtag('config' は1ページ1回にすること（今は ${configs} 回）`);

  const markCount = countOf(html, ga.HEAD_MARK);
  const endCount = countOf(html, ga.HEAD_END);
  if (markCount !== 1 || endCount !== 1) {
    errors.push(`${relPath}: 計測タグの目印は1ページ1組にすること（開き ${markCount} / 閉じ ${endCount}）`);
    return { measured: true, excluded, off };
  }
  const openAt = html.indexOf(ga.HEAD_MARK);
  const closeAt = html.indexOf(ga.HEAD_END);
  const headEnd = html.indexOf("</head>");
  if (closeAt < openAt) errors.push(`${relPath}: 計測タグの目印の開きと閉じが逆`);
  if (headEnd < 0 || closeAt > headEnd) errors.push(`${relPath}: 計測タグが head の外にある`);
  const region = html.slice(openAt, closeAt);
  if (!region.includes(`${ga.SCRIPT_SRC}?id=${analytics.measurementId}"`)) {
    errors.push(`${relPath}: 計測タグが目印の外にあるか、計測IDが ${CONFIG_REL} と違う`);
  }
  return { measured: true, excluded, off };
}

/**
 * 計測IDの手書きが無いか（site-config.json と目印の中身だけに許す）。
 * HTML以外（JS・CSS・JSON・文書）も見る。
 */
function validateNoHandwrittenId(analytics, errors) {
  const id = String((analytics && analytics.measurementId) || "");
  if (!id) return;
  for (const path of listTextFiles(ROOT, [])) {
    const relPath = toRel(path);
    if (relPath === CONFIG_REL) continue;
    let text = readFileSync(path, "utf8");
    if (!text.includes(id)) continue;
    if (relPath.endsWith(".html")) {
      text = text.split(ga.HEAD_MARK).map((part, index) => {
        if (index === 0) return part;
        const closeAt = part.indexOf(ga.HEAD_END);
        return closeAt < 0 ? part : part.slice(closeAt + ga.HEAD_END.length);
      }).join("");
    }
    if (text.includes(id)) {
      errors.push(`${relPath}: 計測ID（${id}）が手書きされている。${CONFIG_REL} の analytics と目印 ${ga.HEAD_MARK} 以外に書かないこと`);
    }
  }
}

/* ------------------------------------------------------------------
 * 入口
 * ------------------------------------------------------------------ */

/**
 * 計測タグを差し込んで全ページを点検する。
 * writeIfChanged は呼び出し側から受け取る（改行の合わせ方を1か所に保つため）。
 */
export function buildAnalytics(options) {
  const writeIfChanged = options.writeIfChanged;
  const configPath = join(ROOT, CONFIG_REL);
  if (!existsSync(configPath)) throw new Error(`${CONFIG_REL} がありません`);
  const analytics = (JSON.parse(readFileSync(configPath, "utf8")) || {}).analytics || {};

  const files = listHtml(ROOT, []);
  const errors = [];
  const written = [];
  const measured = [];
  const unmeasured = [];

  for (const path of files) {
    const relPath = toRel(path);
    const original = readFileSync(path, "utf8");
    let html = original;
    if (!EXCLUDED_PAGES.has(relPath)) {
      const applied = applyToPage(original, analytics);
      if (applied.missingHead) errors.push(`${relPath}: </head> が見つからず計測タグを入れられない`);
      html = applied.html;
      if (html !== original && writeIfChanged(path, html)) written.push(relPath);
    }
    const result = validatePage(relPath, html, analytics, errors);
    (result.measured ? measured : unmeasured).push(relPath);
  }

  for (const relPath of EXCLUDED_PAGES) {
    if (!existsSync(join(ROOT, relPath))) errors.push(`${relPath}: EXCLUDED_PAGES にあるページが見つからない（消したならリストからも外すこと）`);
  }
  validateNoHandwrittenId(analytics, errors);

  if (errors.length) {
    for (const message of errors) console.error(`検証NG: ${message}`);
    throw new Error(`計測タグの検証に失敗しました（${errors.length}件）。上のログを確認してください。`);
  }

  return {
    total: files.length,
    enabled: ga.analyticsReady(analytics),
    measurementId: analytics.measurementId || "",
    measured,
    unmeasured,
    written
  };
}
