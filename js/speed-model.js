/**
 * スピード計算の共通モジュール（計算ロジックの唯一の置き場）。
 *
 * ブラウザ: <script src="./js/speed-model.js"> で読み込むと
 *           window.MirestoSpeedModel に公開される。
 * Node:     require("./js/speed-model.js") で使う（検証用）。
 *
 * 2026-10-04に speed-calc.html の計算部分をここへ切り出した。
 * speed-calc.html と party-builder.html の両方がこのモジュールを呼ぶため、
 * **計算式を呼び出し側に書き足さないこと。**
 *
 * 入力の `data` は次の形（speed-calc.html の entry / draft と同じ）。
 *   { rune: [Lv, Lv, Lv], manualSpeed: "3200", manualSpeedEnabled: true,
 *     speedBuffRate: "15" }
 * 基礎スピード（キャラの speed）は呼び出し側から baseSpeed で渡す。
 * キャラ検索をこのモジュールに持ち込まないため。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.MirestoSpeedModel = api;
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  /** スピードルーンのLvごとの加算値。 */
  const RUNE_TABLE = [
    { lv: 0, speed: 0, label: "なし" },
    { lv: 1, speed: 10, label: "Lv1" },
    { lv: 2, speed: 18, label: "Lv2" },
    { lv: 3, speed: 33, label: "Lv3" },
    { lv: 4, speed: 53, label: "Lv4" },
    { lv: 5, speed: 80, label: "Lv5" },
    { lv: 6, speed: 110, label: "Lv6" },
    { lv: 7, speed: 150, label: "Lv7" },
    { lv: 8, speed: 195, label: "Lv8" },
    { lv: 9, speed: 240, label: "Lv9" },
    { lv: 10, speed: 300, label: "Lv10" },
    { lv: 11, speed: 360, label: "Lv11" },
    { lv: 12, speed: 425, label: "Lv12" },
    { lv: 13, speed: 500, label: "Lv13" },
    { lv: 14, speed: 575, label: "Lv14" },
    { lv: 15, speed: 660, label: "Lv15" }
  ];

  /** スピード増加バフの選択肢（%）。 */
  const SPEED_BUFF_PRESETS = [0, 5, 10, 15, 20, 30];

  function runeSpeed(level) {
    const rune = RUNE_TABLE.find((item) => item.lv === level);
    return (rune && rune.speed) || 0;
  }

  /** ルーン3枠の合計。引数はLvの配列。 */
  function runeSum(runeLevels) {
    const levels = Array.isArray(runeLevels) ? runeLevels : [];
    return levels.reduce((sum, level) => sum + runeSpeed(level), 0);
  }

  /** 手入力スピード。空欄・数値でないものは null。 */
  function manualSpeedValue(data) {
    const raw = String((data && data.manualSpeed) === undefined || (data && data.manualSpeed) === null
      ? ""
      : data.manualSpeed).replace(/,/g, "").trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }

  function usesManualSpeed(data) {
    return Boolean(data && data.manualSpeedEnabled) && manualSpeedValue(data) !== null;
  }

  /** スピード増加バフ（%）。空欄・数値でないものは0。 */
  function speedBuffRateValue(data) {
    const raw = String((data && data.speedBuffRate) === undefined || (data && data.speedBuffRate) === null
      ? ""
      : data.speedBuffRate).replace(/,/g, "").trim();
    if (!raw) return 0;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  /** 基礎スピード＋ルーン。 */
  function calculatedSpeed(baseSpeed, data) {
    return (Number(baseSpeed) || 0) + runeSum(data && data.rune);
  }

  /** 基礎＋ルーンにバフ率を掛けた値。 */
  function buffedSpeed(baseSpeed, data) {
    const runeIncluded = calculatedSpeed(baseSpeed, data);
    return Math.floor((runeIncluded * (100 + speedBuffRateValue(data)) / 100) + 1e-9);
  }

  /** 表示に使う最終値。手入力が有効ならそれを優先する。 */
  function finalSpeed(baseSpeed, data) {
    const manual = usesManualSpeed(data) ? manualSpeedValue(data) : null;
    return manual !== null ? manual : buffedSpeed(baseSpeed, data);
  }

  function formatSpeed(value) {
    return value === null || value === undefined ? "-" : Number(value).toLocaleString();
  }

  return {
    RUNE_TABLE,
    SPEED_BUFF_PRESETS,
    runeSpeed,
    runeSum,
    manualSpeedValue,
    usesManualSpeed,
    speedBuffRateValue,
    calculatedSpeed,
    buffedSpeed,
    finalSpeed,
    formatSpeed
  };
}));
