/**
 * アクセス解析（GA4）の計測タグの組み立て（共通モジュール）。
 *
 * Node: scripts/build-analytics.mjs と各ページの生成スクリプトから require して使う。
 *
 * 設定の正は data/site-config.json の analytics（measurementId / enabled）。
 * 計測IDをページに手書きしないこと（1か所で止められなくなり、二重計測の元になるため）。
 *
 * 出すもの:
 *   head … gtag.js の読み込み（async）と gtag('config', ID)。公式のコードそのまま
 *
 * enabled=false または measurementId が空のときは、目印だけを残して中身を空にする。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.MirestoRenderAnalytics = api;
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  // ビルドが置き換える範囲の目印。中身は scripts/build-analytics.mjs が毎回書き直す
  // （閉じ側があるので再実行しても増えない）。
  const HEAD_MARK = "<!-- ga:head -->";
  const HEAD_END = "<!-- /ga:head -->";

  const SCRIPT_SRC = "https://www.googletagmanager.com/gtag/js";

  /** 計測する設定になっているか（data/site-config.json の analytics）。 */
  function analyticsReady(analytics) {
    return Boolean(analytics && analytics.enabled && analytics.measurementId);
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

  /** gtag('config', ...) の引数に入れるID（英数とハイフンだけを通す）。 */
  function scriptId(value) {
    return String(value ?? "").replace(/[^A-Za-z0-9-]/g, "");
  }

  /**
   * head に入れる計測タグ。1ページ1回だけ（二重に置くと二重計測になる）。
   */
  function renderAnalyticsHead(analytics, indent) {
    const pad = indent === undefined ? "  " : indent;
    if (!analyticsReady(analytics)) return `${pad}${HEAD_MARK}\n${pad}${HEAD_END}`;
    const id = analytics.measurementId;
    return [
      `${pad}${HEAD_MARK}`,
      `${pad}<script async src="${SCRIPT_SRC}?id=${escapeAttr(id)}"></script>`,
      `${pad}<script>`,
      `${pad}  window.dataLayer = window.dataLayer || [];`,
      `${pad}  function gtag(){dataLayer.push(arguments);}`,
      `${pad}  gtag('js', new Date());`,
      `${pad}  gtag('config', '${scriptId(id)}');`,
      `${pad}</script>`,
      `${pad}${HEAD_END}`
    ].join("\n");
  }

  return {
    HEAD_MARK,
    HEAD_END,
    SCRIPT_SRC,
    analyticsReady,
    renderAnalyticsHead
  };
}));
