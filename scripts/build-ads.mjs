#!/usr/bin/env node
/**
 * 広告枠（AdSense）の差し込みと全ページ点検。
 *
 * 設定の正は data/site-config.json の ads、マークアップの正は js/render-ad-slot.js。
 * **ページに広告コードを手書きしないこと。** 書いてよいのは目印だけ:
 *
 *   head の中（</head> の直前） … 何も書かなくてよい（ビルドが <!-- ad:head --> ごと差し込む）
 *   本文の最後・フッターの直前   … <!-- ad:bottom --> を1行置く
 *
 * 目印のあるページにだけ枠が出る。出したくないページには目印を置かない。
 * 一時的に止めたいページは <body data-ads="off">、全停止は ads.enabled=false。
 *
 * 原則は1ページ1枠・本文の最後。例外として、長いキャラ詳細と長い状態異常ガイドだけ
 * 生成スクリプトが本文の途中に <!-- ad:mid --> を置き、本文中枠を1つ足す（最大2枠）。
 * 本文中枠の設定は ads.inContent（下部枠とは別のユニットID）。止めるときは
 * ads.inContent.enabled=false の1か所で、目印だけが残る。
 *
 * 生成ページ（キャラ詳細・状態異常ガイド）は、生成テンプレートが
 * js/render-ad-slot.js を直接呼んで目印ごと書き出す。差し込みも点検も手書きページと同じ道を通るので、
 * <body data-ads="off"> はどのページでも効く（同じ関数・同じ字下げなので中身は一致し、二重書きにならない）。
 *
 * 呼び出しは scripts/build-character-pages.mjs から（全ページを書き終えた後）。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ad = require(join(ROOT, "js", "render-ad-slot.js"));

/** 走査しないディレクトリ。 */
const SKIP_DIRS = new Set([".git", ".github", "node_modules", "docs"]);

/**
 * 広告を出すページ（ここに挙げたページに目印が無ければエラー）。
 * 出さないページ: TOP（ナビ主体）・404・pack-viewer（開発用）・
 * about / disclaimer / privacy / contact（薄いページ）・veela（転送）・所有権確認ファイル。
 * 増やすときは依頼で決めてからここに足すこと。
 */
const EXPECTED_AD_PAGES = [
  "compare-prototype.html",
  "dedicated-weapon-calc.html",
  "evolution-calc.html",
  "gacha-calc.html",
  "gacha-simulator.html",
  "party-builder.html",
  "speed-calc.html",
  "pages/characters/index.html",
  "pages/guide/index.html",
  "pages/status/index.html",
  "pages/status/poison.html"
];

function listHtml(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listHtml(full, out);
    else if (name.endsWith(".html")) out.push(full);
  }
  return out;
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

/**
 * 手書きページ1枚を書き直す。
 * 本文の目印が無いページには、head の読み込みタグも入れない
 * （枠の無いページで広告スクリプトだけ読み込まないため）。
 */
function applyToPage(html, ads) {
  const off = /<body[^>]*\bdata-ads\s*=\s*"off"/.test(html);
  const effective = off ? null : ads;

  // 本文中枠（長いページだけ）。目印が無いページは何も変わらない。
  const mid = replaceRegion(html, ad.MID_MARK, ad.MID_END, (indent) => ad.renderAdMidSlot(effective, indent));
  html = mid.html;

  const slot = replaceRegion(html, ad.SLOT_MARK, ad.SLOT_END, (indent) => ad.renderAdSlot(effective, indent));
  if (!slot.found) return { html, hasSlot: false };

  let output = slot.html;
  const head = replaceRegion(output, ad.HEAD_MARK, ad.HEAD_END, (indent) => ad.renderAdHead(effective, indent));
  if (head.found) {
    output = head.html;
  } else {
    // head の目印がまだ無いページには、</head> の直前に丸ごと差し込む。
    const closeAt = output.indexOf("</head>");
    if (closeAt < 0) return { html: output, hasSlot: true, missingHead: true };
    const lineStart = output.lastIndexOf("\n", closeAt) + 1;
    const found = output.slice(lineStart, closeAt);
    // </head> が行頭のページでも、中身は2スペース下げて周りに合わせる。
    const indent = /^[ \t]+$/.test(found) ? found : "  ";
    output = output.slice(0, lineStart) + ad.renderAdHead(effective, indent) + "\n" + output.slice(lineStart);
  }
  return { html: output, hasSlot: true, off };
}

/* ------------------------------------------------------------------
 * 点検
 * ------------------------------------------------------------------ */

const CONTENTFUL_LEFTOVER = /<(?!\/)(?!script\b)(?!noscript\b)(?!footer\b)(?!nav\b)(?!br\b)(?!template\b)([a-z][\w-]*)/gi;

/**
 * 枠より後に本文が残っていないか。
 * 「本文の最後の要素の後・フッターの前」を機械で見るための検査で、
 * 枠の後に許すのは閉じタグ・スクリプト・フッター・戻りナビ・注記だけ。
 */
function tailAfterSlot(html) {
  const at = html.indexOf(ad.SLOT_END);
  if (at < 0) return "";
  let tail = html.slice(at + ad.SLOT_END.length);
  tail = tail
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    // ツールページの末尾注記（※…）はフッター相当として許す
    .replace(/<div class="footer-note">[\s\S]*?<\/div>/gi, " ");
  const leftovers = [...tail.matchAll(CONTENTFUL_LEFTOVER)].map((m) => m[1].toLowerCase());
  return [...new Set(leftovers)].join(", ");
}

/** 目印のすぐ上・すぐ下にある要素（a / button / input と密着していないかを見る）。 */
function neighbourTags(html, openMark = ad.SLOT_MARK, closeMark = ad.SLOT_END) {
  const open = html.indexOf(openMark);
  const close = html.indexOf(closeMark);
  if (open < 0 || close < 0) return { before: "", after: "" };
  const beforeText = html.slice(0, open).replace(/<!--[\s\S]*?-->/g, " ");
  const afterText = html.slice(close + closeMark.length).replace(/<!--[\s\S]*?-->/g, " ");
  const beforeTags = [...beforeText.matchAll(/<(\/?)([a-z][\w-]*)/gi)];
  const afterTags = [...afterText.matchAll(/<(\/?)([a-z][\w-]*)/gi)];
  return {
    before: beforeTags.length ? (beforeTags[beforeTags.length - 1][1] + beforeTags[beforeTags.length - 1][2]).toLowerCase() : "",
    after: afterTags.length ? (afterTags[0][1] + afterTags[0][2]).toLowerCase() : ""
  };
}

const CLICKABLE = new Set(["a", "/a", "button", "/button", "input", "label", "/label"]);

/** 本文中枠のすぐ上・すぐ下に置かないもの（下部枠の点検に加えて折りたたみも見る）。 */
const MID_CLICKABLE = new Set([...CLICKABLE, "select", "/select", "textarea", "/textarea",
  "summary", "/summary", "details", "/details"]);

/**
 * 本文中枠の目印を置いてよいページ（長いページの判定は生成スクリプトが行う）。
 * キャラ詳細（一覧と veela を除く）と状態異常ガイド（入口と対策キャラ検索を除く）だけ。
 */
const MID_PAGE_PATTERNS = [
  { kind: "character", pattern: /^pages\/characters\/(?!index\.html$|veela\.html$)[^/]+\.html$/ },
  { kind: "guide", pattern: /^pages\/status\/(?!index\.html$|countermeasures\.html$)[^/]+\.html$/ }
];

function midPageKind(relPath) {
  const found = MID_PAGE_PATTERNS.find((item) => item.pattern.test(relPath));
  return found ? found.kind : "";
}

/** 本文中枠の直後に来てよい要素（仕様の位置：skill-3 の直前／キャラ一覧カードの直前）。 */
const MID_NEXT = {
  character: /^\s*<article class="skill-card" id="skill-3"/,
  guide: /^\s*<section class="guide-card" id="(?:givers|users|characters)"/
};
const MID_PREV = {
  character: /<\/article>\s*$/,
  guide: /<\/section>\s*$/
};

function countOf(html, needle) {
  return html.split(needle).length - 1;
}

/** 設定そのものの点検（ページを見る前に1回）。 */
function validateConfig(ads, errors) {
  const inContent = ads.inContent;
  if (!inContent) return;
  if (inContent.enabled && !inContent.slot) {
    errors.push("data/site-config.json: ads.inContent.enabled が true なのに slot が空（ユニットIDを入れてから有効にすること）");
  }
  if (inContent.slot && String(inContent.slot) === String(ads.slot)) {
    errors.push("data/site-config.json: ads.inContent.slot が下部枠の slot と同じ（本文中枠は別のユニットIDにすること）");
  }
}

function validateMid(relPath, html, errors) {
  const kind = midPageKind(relPath);
  const markCount = countOf(html, ad.MID_MARK);
  const endCount = countOf(html, ad.MID_END);
  if (!markCount && !endCount) return { kind, hasMid: false };
  if (!kind) {
    errors.push(`${relPath}: 本文中枠の目印（${ad.MID_MARK}）は長いキャラ詳細・状態異常ガイドにだけ置ける`);
    return { kind, hasMid: true };
  }
  if (markCount !== 1 || endCount !== 1) {
    errors.push(`${relPath}: 本文中枠の目印は1ページ1組にすること（開き ${markCount} / 閉じ ${endCount}）`);
    return { kind, hasMid: true };
  }
  const openAt = html.indexOf(ad.MID_MARK);
  const closeAt = html.indexOf(ad.MID_END);
  if (closeAt < openAt) errors.push(`${relPath}: 本文中枠の目印の開きと閉じが逆`);

  const headAt = html.indexOf("</head>");
  if (headAt < 0 || openAt < headAt) errors.push(`${relPath}: 本文中枠が head の中にある`);
  const footerAt = html.search(/<footer[\s>]/i);
  if (footerAt >= 0 && closeAt > footerAt) errors.push(`${relPath}: 本文中枠が <footer> より後にある`);
  const bottomAt = html.indexOf(ad.SLOT_MARK);
  if (bottomAt < 0) errors.push(`${relPath}: 本文中枠だけがあり、下部枠の目印（${ad.SLOT_MARK}）が無い`);
  else if (closeAt > bottomAt) errors.push(`${relPath}: 本文中枠が下部枠より後にある`);

  const before = html.slice(0, openAt).replace(/<!--[\s\S]*?-->/g, "");
  const after = html.slice(closeAt + ad.MID_END.length).replace(/<!--[\s\S]*?-->/g, "");
  if (!MID_PREV[kind].test(before) || !MID_NEXT[kind].test(after)) {
    errors.push(kind === "character"
      ? `${relPath}: 本文中枠は skill-2 と skill-3 のカードの間に置くこと`
      : `${relPath}: 本文中枠は最初のキャラ一覧カード（givers / users / characters）の直前に置くこと`);
  }

  const near = neighbourTags(html, ad.MID_MARK, ad.MID_END);
  if (MID_CLICKABLE.has(near.before)) errors.push(`${relPath}: 本文中枠のすぐ上が ${near.before}（ボタン・リンク・折りたたみと密着させない）`);
  if (MID_CLICKABLE.has(near.after)) errors.push(`${relPath}: 本文中枠のすぐ下が ${near.after}（ボタン・リンク・折りたたみと密着させない）`);
  return { kind, hasMid: true };
}

function validatePage(relPath, html, ads, errors) {
  const insCount = countOf(html, 'class="adsbygoogle"');
  const scriptCount = countOf(html, ad.SCRIPT_SRC);
  const styleCount = countOf(html, `href="${ad.STYLE_HREF}"`);
  const hasSlot = html.includes(ad.SLOT_MARK);
  const off = /<body[^>]*\bdata-ads\s*=\s*"off"/.test(html);
  const shouldShow = hasSlot && !off && ad.adsReady(ads);

  const mid = validateMid(relPath, html, errors);
  const midShown = shouldShow && mid.hasMid && Boolean(mid.kind) && ad.midAdsReady(ads);
  const midInsCount = mid.hasMid
    ? countOf(html.slice(html.indexOf(ad.MID_MARK), html.indexOf(ad.MID_END)), 'class="adsbygoogle"')
    : 0;

  if (!shouldShow) {
    if (insCount) errors.push(`${relPath}: 広告を出さないページに枠が ${insCount} 個ある（手書きが残っている）`);
    if (scriptCount) errors.push(`${relPath}: 広告を出さないページに読み込みタグが ${scriptCount} 個ある`);
    return { relPath, ins: insCount, script: scriptCount, shown: false, midShown: false, midKind: mid.kind, off, hasSlot };
  }

  const expected = midShown ? 2 : 1;
  if (insCount !== expected) {
    errors.push(midShown
      ? `${relPath}: 本文中枠のあるページは枠2つ（本文中＋下部）にすること（今は ${insCount} 個）`
      : `${relPath}: 枠は1ページ1つにすること（今は ${insCount} 個）`);
  }
  if (midInsCount !== (midShown ? 1 : 0)) {
    errors.push(`${relPath}: 本文中枠の中の枠が ${midInsCount} 個（${midShown ? "1個" : "0個"}にすること）`);
  }
  if (scriptCount !== 1) errors.push(`${relPath}: 読み込みタグは1ページ1回にすること（今は ${scriptCount} 回）`);
  if (styleCount !== 1) errors.push(`${relPath}: ${ad.STYLE_HREF} の読み込みが ${styleCount} 回（1回にすること）`);

  const headAt = html.indexOf("</head>");
  const slotAt = html.indexOf(ad.SLOT_MARK);
  if (headAt >= 0 && slotAt < headAt) errors.push(`${relPath}: 枠が head の中にある`);

  const footerAt = html.search(/<footer[\s>]/i);
  if (footerAt >= 0 && slotAt > footerAt) errors.push(`${relPath}: 枠が <footer> より後にある`);

  const leftover = tailAfterSlot(html);
  if (leftover) errors.push(`${relPath}: 枠の後に本文が残っている（${leftover}）。本文の最後・フッターの前に置くこと`);

  const { before, after } = neighbourTags(html);
  if (CLICKABLE.has(before)) errors.push(`${relPath}: 枠のすぐ上が ${before}（ボタン・リンクと密着させない）`);
  if (CLICKABLE.has(after)) errors.push(`${relPath}: 枠のすぐ下が ${after}（ボタン・リンクと密着させない）`);

  if (!html.includes(`data-ad-client="${ads.client}"`)) {
    errors.push(`${relPath}: クライアントIDが data/site-config.json と違う`);
  }
  const bottomRegion = html.slice(slotAt, html.indexOf(ad.SLOT_END));
  if (!bottomRegion.includes(`data-ad-slot="${ads.slot}"`)) {
    errors.push(`${relPath}: スロットIDが data/site-config.json と違う`);
  }
  if (midShown) {
    const midRegion = html.slice(html.indexOf(ad.MID_MARK), html.indexOf(ad.MID_END));
    if (!midRegion.includes(`data-ad-slot="${ads.inContent.slot}"`)) {
      errors.push(`${relPath}: 本文中枠のスロットIDが data/site-config.json の ads.inContent.slot と違う`);
    }
    if (midRegion.includes(`data-ad-slot="${ads.slot}"`)) {
      errors.push(`${relPath}: 本文中枠が下部枠と同じスロットIDになっている`);
    }
  }
  if (/enable_page_level_ads/.test(html)) {
    errors.push(`${relPath}: 自動広告（enable_page_level_ads）はコードで使わないこと`);
  }
  return { relPath, ins: insCount, script: scriptCount, shown: true, midShown, midKind: mid.kind, off, hasSlot };
}

/* ------------------------------------------------------------------
 * 入口
 * ------------------------------------------------------------------ */

/**
 * 広告枠を差し込んで全ページを点検する。
 * writeIfChanged は呼び出し側から受け取る（改行の合わせ方を1か所に保つため）。
 */
export function buildAds(options) {
  const writeIfChanged = options.writeIfChanged;
  const configPath = join(ROOT, "data", "site-config.json");
  if (!existsSync(configPath)) throw new Error("data/site-config.json がありません");
  const ads = (JSON.parse(readFileSync(configPath, "utf8")) || {}).ads || {};

  const files = listHtml(ROOT, []);
  const errors = [];
  const written = [];
  let shown = 0;
  const midShown = { character: 0, guide: 0 };
  const midPages = { character: [], guide: [] };

  validateConfig(ads, errors);

  for (const path of files) {
    const relPath = relative(ROOT, path).split(sep).join("/");
    const original = readFileSync(path, "utf8");

    const applied = applyToPage(original, ads);
    if (applied.missingHead) errors.push(`${relPath}: </head> が見つからず読み込みタグを入れられない`);
    if (applied.html !== original && writeIfChanged(path, applied.html)) written.push(relPath);

    const result = validatePage(relPath, applied.html, ads, errors);
    if (result.shown) shown += 1;
    if (result.midShown) midShown[result.midKind] += 1;
    if (result.midKind && applied.html.includes(ad.MID_MARK)) midPages[result.midKind].push(relPath);
  }

  // 出すと決めたページに目印が無いまま公開されるのを防ぐ。
  const slotPages = new Set();
  for (const path of files) {
    const relPath = relative(ROOT, path).split(sep).join("/");
    if (readFileSync(path, "utf8").includes('class="adsbygoogle"')) slotPages.add(relPath);
  }
  if (ad.adsReady(ads)) {
    for (const relPath of EXPECTED_AD_PAGES) {
      if (!slotPages.has(relPath)) errors.push(`${relPath}: 広告を出すページなのに枠が無い（<!-- ad:bottom --> を置くこと）`);
    }
  }

  if (errors.length) {
    for (const message of errors) console.error(`検証NG: ${message}`);
    throw new Error(`広告枠の検証に失敗しました（${errors.length}件）。上のログを確認してください。`);
  }

  return {
    total: files.length,
    shown,
    written,
    enabled: ad.adsReady(ads),
    slot: ads.slot,
    // 本文中枠（長いページだけ）。midPages は目印を置いたページ、midShown は実際に枠を出したページ数。
    midEnabled: ad.midAdsReady(ads),
    midSlot: (ads.inContent || {}).slot || "",
    midShown,
    midPages
  };
}
