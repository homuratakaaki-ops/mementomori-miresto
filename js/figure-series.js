/**
 * 縦長の図解の組（状態異常ガイドの figure の mobile）のブラウザ側スクリプト。
 *
 * HTMLは scripts/build-status-guides.mjs が公開前に書き出す。
 * 横スクロールとスナップはCSSだけで動くので、JSが動かない環境でもスワイプで読める。
 * ここでは操作列（前へ・ドット・「1 / 3」・次へ）の hidden を外し、今の位置を表示する。
 *
 * 決まり:
 *   - 自動送りはしない（読む速さは人それぞれのため）
 *   - 今の位置は、スクロール位置にいちばん近い図で決める
 *   - 前へ・次へ・ドットは、その図を枠の中央へ動かすだけ。最初と最後で止まる（1枚目へ戻らない）
 *   - ボタンで送っている途中は、通過中の図で表示を戻さない（着いた時点の位置だけ出す）
 *   - 動きを減らす設定のときはスクロールのアニメーションをしない（CSSの scroll-behavior で切る）
 */
(function () {
  "use strict";

  function setup(root) {
    const track = root.querySelector(".guide-series-track");
    const controls = root.querySelector(".guide-series-controls");
    if (!track || !controls) return;
    const panels = Array.from(track.querySelectorAll(".guide-figure-panel"));
    if (panels.length < 2) return;

    const prev = controls.querySelector("[data-series-prev]");
    const next = controls.querySelector("[data-series-next]");
    const dots = Array.from(controls.querySelectorAll("[data-series-dot]"));
    const count = controls.querySelector(".guide-series-count");
    let current = 0;
    let targetLeft = null;
    let targetTimer = 0;

    function nearestIndex() {
      const center = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      let bestDistance = Infinity;
      panels.forEach((panel, index) => {
        const panelCenter = panel.offsetLeft - track.offsetLeft + panel.offsetWidth / 2;
        const distance = Math.abs(panelCenter - center);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    }

    function render() {
      dots.forEach((dot, index) => {
        if (index === current) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
      if (count) count.textContent = (current + 1) + " / " + panels.length;
      if (prev) prev.disabled = current === 0;
      if (next) next.disabled = current === panels.length - 1;
    }

    function go(index) {
      const target = Math.max(0, Math.min(panels.length - 1, index));
      const panel = panels[target];
      const maxLeft = track.scrollWidth - track.clientWidth;
      const left = Math.max(0, Math.min(maxLeft,
        panel.offsetLeft - track.offsetLeft - (track.clientWidth - panel.offsetWidth) / 2));
      // 送り終わるまでスクロール位置からの表示更新を止める（念のため1秒で解除）。
      targetLeft = left;
      window.clearTimeout(targetTimer);
      targetTimer = window.setTimeout(() => { targetLeft = null; }, 1000);
      track.scrollTo({ left: left });
      current = target;
      render();
    }

    let pending = false;
    track.addEventListener("scroll", () => {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(() => {
        pending = false;
        if (targetLeft !== null) {
          if (Math.abs(track.scrollLeft - targetLeft) > 2) return;
          targetLeft = null;
          window.clearTimeout(targetTimer);
        }
        const index = nearestIndex();
        if (index !== current) {
          current = index;
          render();
        }
      });
    }, { passive: true });

    if (prev) prev.addEventListener("click", () => go(current - 1));
    if (next) next.addEventListener("click", () => go(current + 1));
    dots.forEach((dot, index) => dot.addEventListener("click", () => go(index)));

    controls.hidden = false;
    render();
  }

  function init() {
    document.querySelectorAll("[data-figure-series]").forEach(setup);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
