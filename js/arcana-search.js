/* アルカナ検索の起動。条件判定・URL・時計は後続工程で追加する。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MirestoArcanaSearch = api;
    api.init(root.document);
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";
  const loads = new WeakMap();

  function init(document) {
    const container = document.querySelector("[data-arcana-search]");
    if (!container) return Promise.resolve(null);
    if (loads.has(container)) return loads.get(container);
    container.querySelector("[data-search-controls]").hidden = false;
    const load = Promise.resolve().then(() => fetch(container.dataset.indexSrc))
      .then(response => {
        if (!response.ok) throw new Error("index request failed");
        return response.json();
      }).catch(() => {
        const message = container.querySelector("[data-search-error]");
        message.textContent = "検索用データを読み込めませんでした。再読み込みしてください";
        message.hidden = false;
        return null;
      });
    loads.set(container, load);
    return load;
  }

  return { init };
}));
