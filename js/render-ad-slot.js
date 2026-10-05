/**
 * 広告枠（AdSense）の組み立て（共通モジュール）。
 *
 * Node: scripts/build-ads.mjs と各ページの生成スクリプトから require して使う。
 *
 * 設定の正は data/site-config.json の ads。クライアントIDとスロットIDを
 * ページに手書きしないこと（1か所で止められなくなるため）。
 *
 * 出すもの:
 *   head … 読み込みタグ（async・1ページ1回）＋ 枠のスタイル
 *   body … 枠（ins）と初期化。本文の最後とフッターの間に1枠だけ置く
 *
 * 置き方の決まり（AGENTS.md と同じ）:
 *   - 1ページ1枠・下部固定。ページ途中に挟まない
 *   - 枠の上下に余白を取り、ボタン・内部リンク・ツールの操作部と密着させない
 *   - 「スポンサーリンク」などの見出しは出さない
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.MirestoRenderAdSlot = api;
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  // ビルドが置き換える範囲の目印。
  // 手書きページは本文の末尾に HEAD_MARK / SLOT_MARK だけを置き、
  // 中身は scripts/build-ads.mjs が毎回書き直す（閉じ側があるので再実行しても増えない）。
  const HEAD_MARK = "<!-- ad:head -->";
  const HEAD_END = "<!-- /ad:head -->";
  const SLOT_MARK = "<!-- ad:bottom -->";
  const SLOT_END = "<!-- /ad:bottom -->";

  const SCRIPT_SRC = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
  const STYLE_HREF = "/assets/ad-slot.css";

  /** 広告を出す設定になっているか（data/site-config.json の ads）。 */
  function adsReady(ads) {
    return Boolean(ads && ads.enabled && ads.client && ads.slot);
  }

  function escapeAttr(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  /**
   * head に入れる読み込みタグとスタイル。
   * 読み込みタグは1ページ1回だけ（二重に置くと初期化が二重になる）。
   */
  function renderAdHead(ads, indent) {
    const pad = indent === undefined ? "  " : indent;
    if (!adsReady(ads)) return `${pad}${HEAD_MARK}\n${pad}${HEAD_END}`;
    return [
      `${pad}${HEAD_MARK}`,
      `${pad}<script async src="${SCRIPT_SRC}?client=${escapeAttr(ads.client)}" crossorigin="anonymous"></script>`,
      `${pad}<link rel="stylesheet" href="${STYLE_HREF}">`,
      `${pad}${HEAD_END}`
    ].join("\n");
  }

  /**
   * 本文の最後に置く枠1つ。
   * min-height は assets/ad-slot.css 側で確保してあり、
   * 広告が入っても本文が下にずれない（レイアウトが動かない）。
   */
  function renderAdSlot(ads, indent) {
    const pad = indent === undefined ? "    " : indent;
    if (!adsReady(ads)) return `${pad}${SLOT_MARK}\n${pad}${SLOT_END}`;
    return [
      `${pad}${SLOT_MARK}`,
      `${pad}<aside class="ad-slot" aria-label="広告">`,
      `${pad}  <ins class="adsbygoogle"`,
      `${pad}       style="display:block"`,
      `${pad}       data-ad-client="${escapeAttr(ads.client)}"`,
      `${pad}       data-ad-slot="${escapeAttr(ads.slot)}"`,
      `${pad}       data-ad-format="auto"`,
      `${pad}       data-full-width-responsive="true"></ins>`,
      `${pad}  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`,
      `${pad}</aside>`,
      `${pad}${SLOT_END}`
    ].join("\n");
  }

  return {
    HEAD_MARK,
    HEAD_END,
    SLOT_MARK,
    SLOT_END,
    SCRIPT_SRC,
    STYLE_HREF,
    adsReady,
    renderAdHead,
    renderAdSlot
  };
}));
