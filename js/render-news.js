/**
 * トップページのニュース欄の描画ロジック（共通モジュール）。
 *
 * ブラウザ: <script src="./js/render-news.js"> で読み込むと
 *           window.MirestoRenderNews に公開される。
 * Node:     scripts/build-character-pages.mjs から require して
 *           公開前の index.html へ本文を書き込む。
 *
 * 描画の二重管理を避けるため、HTML文字列の組み立てはここだけに置く。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.MirestoRenderNews = api;
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  /** トップページに出す種別。ここに無い kind は出さない。 */
  const NEWS_KINDS = ["新キャラ", "PU", "復刻", "星の導き", "イベント", "サイト更新"];

  /** トップページに出す件数。 */
  const NEWS_LIMIT = 5;

  const newsKinds = new Set(NEWS_KINDS);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function formatDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value || "";
    return `${match[1]}/${Number(match[2])}/${Number(match[3])}`;
  }

  /**
   * 表示するニュースを選ぶ。日付の新しい順で、**同じ日付の中は作業順の逆**
   * （news.json に後から追記したものが上）にする。
   * 同じ日に何件も追記した日でも、最後に入れた1件がトップから押し出されないため。
   */
  function selectNews(newsData, limit) {
    return ((newsData && newsData.items) || [])
      .filter((item) => newsKinds.has(item.kind) && item.date && item.text)
      .map((item, index) => ({ item, index }))
      .sort((a, b) => String(b.item.date).localeCompare(String(a.item.date)) || b.index - a.index)
      .slice(0, limit === undefined ? NEWS_LIMIT : limit)
      .map((entry) => entry.item);
  }

  function renderNewsItem(item) {
    return `
          <article class="news-item">
            <time class="news-date" datetime="${escapeHtml(item.date)}">${escapeHtml(formatDate(item.date))}</time>
            <span class="badge pickup">${escapeHtml(item.kind)}</span>
            <span class="news-text">${escapeHtml(item.text)}</span>
          </article>`;
  }

  function renderNewsList(items) {
    return items.map(renderNewsItem).join("");
  }

  return {
    NEWS_KINDS,
    NEWS_LIMIT,
    escapeHtml,
    formatDate,
    selectNews,
    renderNewsItem,
    renderNewsList
  };
}));
