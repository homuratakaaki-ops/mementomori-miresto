/** 生成済みの表示予定を適用するだけ。開催判定は gacha-status.js に集約する。 */
(function () {
  "use strict";
  const selector = "[data-gacha-timeline]";
  const cache = new WeakMap();
  const MAX_DELAY = 2147483647;
  let timer;

  function readTimeline(element) {
    const raw = element.getAttribute("data-gacha-timeline");
    const previous = cache.get(element);
    if (previous && previous.raw === raw) return previous.items;
    let items = null;
    try {
      const parsed = JSON.parse(raw);
      let last = -Infinity;
      if (!Array.isArray(parsed) || !parsed.length) throw new Error("empty timeline");
      items = parsed.map((item) => {
        if (!item || typeof item.at !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(item.at) ||
            typeof item.text !== "string" || typeof item.cls !== "string") throw new Error("invalid item");
        const at = Date.parse(item.at);
        if (!Number.isFinite(at) || at <= last ||
            new Date(at + 9 * 3600000).toISOString().slice(0, 19) + "+09:00" !== item.at) throw new Error("invalid date/order");
        last = at;
        return { ...item, at };
      });
    } catch (_) { items = null; }
    cache.set(element, { raw, items });
    return items;
  }

  function apply() {
    clearTimeout(timer);
    const now = Date.now();
    let next = Infinity;
    for (const element of document.querySelectorAll(selector)) {
      const items = readTimeline(element);
      if (!items) continue;
      let current;
      for (const item of items) {
        if (item.at <= now) current = item;
        else { next = Math.min(next, item.at); break; }
      }
      if (current) {
        if (element.textContent !== current.text) element.textContent = current.text;
        if (element.className !== current.cls) element.className = current.cls;
        element.hidden = current.text === "";
      }
    }
    if (next !== Infinity) timer = setTimeout(apply, Math.min(MAX_DELAY, Math.max(1, next - Date.now())));
  }

  function init() {
    apply();
    document.addEventListener("visibilitychange", apply);
    // 属性タブによるカードの入れ替え後も、新しい要素の予定を登録する。
    new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes].some((node) =>
        node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))))) apply();
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
}());
