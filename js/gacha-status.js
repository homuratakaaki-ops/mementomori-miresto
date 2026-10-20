/**
 * ガチャ開催状況の判定（共通モジュール・判定ロジックの唯一の置き場）。
 *
 * ブラウザ: <script src="../../js/gacha-status.js"> で読み込むと
 *           window.MirestoGachaStatus に公開される。
 * Node:     scripts/build-character-pages.mjs / js/render-character*.js から
 *           require して使う。
 *
 * 開催状況は data/mementomori-skills.json の `characters[].pickupHistory` と
 * `availability` から**計算する**項目で、手入力しない。
 * `characters[].gachaStatus` は参照しない（空のままでよい）。
 *
 * 「今日」は常にJST（Asia/Tokyo, UTC+9）で判定する。ビルドがUTCで走る
 * GitHub Actions でも日本時間の日付で判定するため。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.MirestoGachaStatus = api;
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const RELEASE_KIND = "初回実装";
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** 開催中の表示名。pickupHistory の kind に対応する。 */
  const ONGOING_LABEL = {
    "PU": "PU中",
    "復刻": "復刻中",
    "星の導き": "星の導き開催中"
  };

  /** JSTの「今日」を YYYY-MM-DD で返す。引数なしなら現在時刻。 */
  function jstToday(now) {
    const base = now === undefined ? new Date() : new Date(now);
    if (Number.isNaN(base.getTime())) throw new Error("jstToday: 日時として読めません");
    return new Date(base.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** タイムゾーンなしの入力はJST。日付だけなら00:00として扱う。 */
  function jstNow(now) {
    if (typeof now === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(now)) {
      const value = now.length === 10 ? `${now}T00:00` : now;
      const parsed = new Date(`${value}:00+09:00`);
      if (Number.isNaN(parsed.getTime()) ||
          new Date(parsed.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16) !== value) {
        throw new Error(`JST日時が不正です: ${now}`);
      }
      return value;
    }
    const parsed = now === undefined ? new Date() : new Date(now);
    if (Number.isNaN(parsed.getTime())) throw new Error("jstNow: 日時として読めません");
    return new Date(parsed.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
  }

  function buildNow(env) {
    const now = (env.MIRESTO_NOW || "").trim();
    const today = (env.MIRESTO_TODAY || "").trim();
    if (now && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(now)) throw new Error("MIRESTO_NOW は YYYY-MM-DDTHH:MM で指定すること");
    if (!now && today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("MIRESTO_TODAY は YYYY-MM-DD で指定すること");
    return jstNow(now || today || undefined);
  }

  function startAt(entry) {
    return `${entry.date}T${entry.startTime || "00:00"}`;
  }

  function isUpcoming(entry, now) {
    return !!entry && entry.announced === true && entry.kind !== RELEASE_KIND &&
      !!entry.date && jstNow(now) < startAt(entry);
  }

  // 開始からの経過日数が22日になるまでは暫定開催中（0〜21日）。
  function isStaleAnnouncement(entry, now) {
    return !!entry && entry.announced === true && entry.kind !== RELEASE_KIND &&
      !!entry.date && !entry.endDate &&
      new Date(`${jstNow(now)}:00+09:00`) - new Date(`${startAt(entry)}:00+09:00`) >= 22 * DAY_MS;
  }

  function announcementWarnings(character, now) {
    return historyOf(character).filter((entry) => isStaleAnnouncement(entry, now))
      .map((entry) => `警告: ${character.name || character.id} (${entry.date}) は開始から22日以上、endDate 未設定のため開催中表示を停止しました`);
  }

  /** YYYY-MM-DD → M/D。日付以外の形（YYYY-MM など）はそのまま返す。 */
  function monthDay(value) {
    const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[1])}/${Number(match[2])}` : String(value || "");
  }

  function historyOf(character) {
    return Array.isArray(character && character.pickupHistory) ? character.pickupHistory : [];
  }

  /**
   * 今日が期間内かどうか。
   * 公式予告だけ開始時刻と終了日未設定時の安全装置を適用する。
   */
  function isOngoing(entry, today) {
    if (!entry || !entry.date) return false;
    if (entry.kind === RELEASE_KIND) return false;
    const now = jstNow(today);
    if (entry.announced === true) {
      if (isUpcoming(entry, now)) return false;
      if (!entry.endDate) return !isStaleAnnouncement(entry, now);
    }
    if (!entry.endDate) return false;
    const day = now.slice(0, 10);
    return String(entry.date) <= day && day <= String(entry.endDate);
  }

  /** 今日が期間内の回。複数あれば終了日が最も遅いものを返す。 */
  function ongoingEntry(character, today) {
    const day = jstNow(today);
    return historyOf(character)
      .filter((entry) => isOngoing(entry, day))
      .sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)))[0] || null;
  }

  /** 開催が終わった回（初回実装の記録は数えない）。 */
  function hasPastPickup(character, today) {
    const day = jstNow(today);
    return historyOf(character).some((entry) =>
      entry.kind !== RELEASE_KIND && entry.date && String(entry.date) <= day.slice(0, 10) &&
      !isUpcoming(entry, day) && !isOngoing(entry, day));
  }

  /**
   * 開催状況。`text` が表示文、`state` がCSSクラスの出し分け用。
   * 優先順位: 期間内 → 公式予告の予定 → 恒常 → 復刻待ち → availability のまま。
   */
  function gachaStatus(character, today) {
    const day = jstNow(today);
    const ongoing = ongoingEntry(character, day);
    if (ongoing) {
      const label = ONGOING_LABEL[ongoing.kind] || "開催中";
      return { text: label + (ongoing.endDate ? `（〜${monthDay(ongoing.endDate)}）` : ""), state: "ongoing", entry: ongoing };
    }
    const upcoming = historyOf(character).filter((entry) => isUpcoming(entry, day))
      .sort((a, b) => startAt(a).localeCompare(startAt(b)))[0];
    if (upcoming) return { text: `${upcoming.kind}予定（${monthDay(upcoming.date)}〜）`, state: "upcoming", entry: upcoming };
    const availability = (character && character.availability) || "";
    if (availability === "恒常") return { text: "恒常", state: "normal", entry: null };
    if (hasPastPickup(character, day)) return { text: "復刻待ち", state: "waiting", entry: null };
    // 初回実装のみ・履歴なしの体は availability をそのまま出す（「復刻待ち」とは出さない）。
    return { text: availability, state: "normal", entry: null };
  }

  /** 開催状況の表示文だけが欲しいとき。 */
  function gachaStatusText(character, today) {
    return gachaStatus(character, today).text;
  }

  /** PU履歴の各回に付ける「（開催中〜M/D）」「（終了）」。終了日が無い回は何も付けない。 */
  function periodSuffix(entry, today) {
    const now = jstNow(today);
    if (isUpcoming(entry, now)) return "（予定）";
    if (entry && !entry.endDate && isOngoing(entry, now)) return "（開催中）";
    if (!entry || !entry.endDate) return "";
    return isOngoing(entry, now) ? `（開催中〜${monthDay(entry.endDate)}）` : "（終了）";
  }

  return {
    RELEASE_KIND,
    ONGOING_LABEL,
    jstToday,
    jstNow,
    buildNow,
    isUpcoming,
    announcementWarnings,
    monthDay,
    isOngoing,
    ongoingEntry,
    hasPastPickup,
    gachaStatus,
    gachaStatusText,
    periodSuffix
  };
}));
