/**
 * 図解スライド（状態異常ガイドの slides ブロック）のブラウザ側スクリプト。
 *
 * HTMLは scripts/build-status-guides.mjs が公開前に書き出す。
 * JSが動かない環境では1枚目だけが見えて操作列は出ない（hidden のまま）ので、
 * ここで hidden を外してから自動送りを始める。
 *
 * 決まり:
 *   - 表示時間は各 figure の data-duration（ミリ秒）。最後の次は1枚目へ戻る
 *   - 前へ・次へ・ドットは再生状態を変えない（表示中の残り時間だけ数え直す）
 *   - タブ非表示・画面外・スライド内にキーボードフォーカスがある間は一時中断する
 *     （ユーザーが押した再生／一時停止の選択は上書きしない）
 *   - prefers-reduced-motion: reduce のときは停止状態で始める（フェードはCSS側で切る）
 *   - キーボード操作はボタンの標準動作だけ。矢印キーなどの独自操作は付けない
 */
(function () {
  "use strict";

  const REDUCED = typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const DEFAULT_DURATION = 3000;

  /**
   * キーボード操作で当たったフォーカスかどうか。
   * :focus-visible を知らない古いブラウザでは matches が例外を投げるので、
   * そのときは「違う」側に倒して自動送りを止めない
   * （止める側に倒すと、タップしたきり二度と動かなくなるため）。
   */
  function keyboardFocus(target) {
    try {
      return Boolean(target && target.matches(":focus-visible"));
    } catch (error) {
      return false;
    }
  }

  function setup(root) {
    const viewport = root.querySelector(".guide-slides-viewport");
    const controls = root.querySelector(".guide-slides-controls");
    const slides = Array.prototype.slice.call(root.querySelectorAll(".guide-slide"));
    // 1枚だけの回は送る先が無いので、操作列を出さずに静止画のまま置いておく。
    if (!viewport || !controls || slides.length < 2) return;

    const toggle = controls.querySelector("[data-slides-toggle]");
    const prev = controls.querySelector("[data-slides-prev]");
    const next = controls.querySelector("[data-slides-next]");
    const dots = Array.prototype.slice.call(controls.querySelectorAll("[data-slides-dot]"));
    const images = slides.map((slide) => slide.querySelector("img"));

    let index = slides.findIndex((slide) => slide.classList.contains("is-active"));
    if (index < 0) index = 0;
    let timer = 0;
    // wanted はユーザーの選択（再生したいか）。holds は自動の一時中断の理由。
    let wanted = !REDUCED;
    const holds = new Set();

    function duration() {
      const value = Number(slides[index].dataset.duration);
      return value > 0 ? value : DEFAULT_DURATION;
    }

    /** 次に出す1枚を先読みしておく（フェード中に白く抜けないため）。 */
    function preload() {
      const image = images[(index + 1) % slides.length];
      if (image && image.getAttribute("loading") === "lazy") image.setAttribute("loading", "eager");
    }

    function running() {
      return wanted && holds.size === 0;
    }

    function stopTimer() {
      if (!timer) return;
      window.clearTimeout(timer);
      timer = 0;
    }

    /** 表示中スライドの残り時間を最初から数え直す。 */
    function startTimer() {
      stopTimer();
      if (!running()) return;
      timer = window.setTimeout(function () {
        timer = 0;
        show(index + 1);
      }, duration());
    }

    function show(target) {
      const count = slides.length;
      const moved = ((target % count) + count) % count;
      slides[index].classList.remove("is-active");
      slides[moved].classList.add("is-active");
      if (dots[index]) dots[index].removeAttribute("aria-current");
      if (dots[moved]) dots[moved].setAttribute("aria-current", "true");
      index = moved;
      preload();
      startTimer();
    }

    function syncToggle() {
      const label = wanted ? "一時停止" : "再生";
      toggle.textContent = wanted ? "❚❚" : "▶";
      toggle.setAttribute("aria-label", label);
      // 自動で動いている間に読み上げへ割り込まない。止まっている間だけ知らせる。
      viewport.setAttribute("aria-live", wanted ? "off" : "polite");
    }

    function hold(reason, on) {
      if (on) holds.add(reason);
      else holds.delete(reason);
      if (running()) startTimer();
      else stopTimer();
    }

    toggle.addEventListener("click", function () {
      wanted = !wanted;
      syncToggle();
      if (running()) startTimer();
      else stopTimer();
    });
    if (prev) prev.addEventListener("click", function () { show(index - 1); });
    if (next) next.addEventListener("click", function () { show(index + 1); });
    dots.forEach(function (dot, position) {
      dot.addEventListener("click", function () { show(position); });
    });

    document.addEventListener("visibilitychange", function () {
      hold("tab", document.hidden);
    });
    // タップ・クリック後もボタンにはフォーカスが残る。キーボード操作時だけ
    // 中断しないと、前後送りや再生を押した後に自動送りが止まり続ける。
    root.addEventListener("focusin", function (event) {
      hold("focus", keyboardFocus(event.target));
    });
    root.addEventListener("pointerdown", function () { hold("focus", false); });
    root.addEventListener("focusout", function (event) {
      if (!root.contains(event.relatedTarget)) hold("focus", false);
    });
    if (typeof window.IntersectionObserver === "function") {
      const observer = new window.IntersectionObserver(function (entries) {
        for (const entry of entries) hold("view", entry.intersectionRatio < 0.25);
      }, { threshold: [0, 0.25, 0.5, 1] });
      observer.observe(root);
    }

    controls.hidden = false;
    if (document.hidden) holds.add("tab");
    preload();
    syncToggle();
    startTimer();
  }

  function init() {
    const roots = document.querySelectorAll("[data-guide-slides]");
    for (const root of roots) setup(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
