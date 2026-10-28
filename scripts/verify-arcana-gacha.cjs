/** アルカナ開催サマリーの回帰・境界・既存判定との一致を検証する。 */
const fs = require("fs");
const path = require("path");
const { isDeepStrictEqual } = require("util");
const gs = require("../js/gacha-status.js");
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/mementomori-skills.json"), "utf8"));
const byId = new Map(data.characters.map((c) => [c.id, c]));
let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = isDeepStrictEqual(actual, expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "OK" : "NG"} ${label}${ok ? "" : ` 期待=${JSON.stringify(expected)} 実際=${JSON.stringify(actual)}`}`);
}
const keys = ["state", "ongoing", "upcoming", "latestStarted", "latestEnded", "daysSinceStart",
  "daysSinceEnd", "startPrecision", "endPrecision", "endUnknown", "recordedRounds", "totalRounds"].sort();
function sample(label, character, now, expected) {
  const before = JSON.stringify(character);
  const result = gs.arcanaGachaSummary(character, now);
  check(`${label} 12キー`, Object.keys(result).sort(), keys);
  check(`${label} 期待値`, Object.fromEntries(Object.keys(expected).map((key) => [key, result[key]])), expected);
  check(`${label} 入力不変・履歴参照保持`, JSON.stringify(character) === before &&
    ["ongoing", "upcoming", "latestStarted", "latestEnded"].every((key) =>
      result[key].every((entry) => character.pickupHistory.includes(entry))), true);
  return result;
}

console.log("=== 1. 実データの回帰 ===");
const realCases = [
  ["fenrir_treasure", "2026-10-29T14:29", "ongoing", null, false],
  ["fenrir_treasure", "2026-10-29T14:30", "waiting", 0, false, "exact"],
  ["fenrir_treasure", "2026-10-30T14:29", "waiting", 0, false],
  ["fenrir_treasure", "2026-10-30T14:30", "waiting", 1, false],
  ["fia_trace", "2026-10-29T16:29", "upcoming", 174, false, "date_based"],
  ["fia_trace", "2026-10-29T16:30", "ongoing", null, false],
  ["fia_trace", "2026-11-20T16:29", "ongoing", null, false],
  ["fia_trace", "2026-11-20T16:30", "waiting", null, true],
  ["fenrir", "2026-10-28T12:00", "permanent", null, false]
];
for (const [id, now, state, daysSinceEnd, endUnknown, endPrecision] of realCases) {
  const expected = { state, daysSinceEnd, endUnknown };
  if (endPrecision !== undefined) expected.endPrecision = endPrecision;
  sample(`${id} ${now}`, byId.get(id), now, expected);
}

console.log("=== 2. 合成データの境界 ===");
const entry = (round, date, endDate, extra = {}) => ({ kind: "復刻", round, date, ...(endDate ? { endDate } : {}), ...extra });
const character = (...pickupHistory) => ({ availability: "", pickupHistory });
const old = entry(2, "2026-04-01", "2026-04-15");
sample("最新回の終了日なし", character(old, entry(3, "2026-09-01")), "2026-10-01T00:00",
  { state: "waiting", daysSinceEnd: null, endPrecision: null, endUnknown: true });
sample("予告開始前", character(old, entry(3, "2026-11-01", null, { announced: true })), "2026-10-01T00:00",
  { state: "upcoming", daysSinceEnd: 168, endPrecision: "date_based", endUnknown: false });
const a = entry(1, "2026-05-01", "2026-05-20");
const b = entry(2, "2026-05-10", "2026-05-31");
// 指示書の訂正に従う。終了境界6/1から6/10までは満9日（10日ではない）。
sample("重複開催・両方終了", character(a, b), "2026-06-10T00:00",
  { state: "waiting", latestEnded: [b], daysSinceEnd: 9 });
sample("重複開催・片方開催中", character(a, b), "2026-05-25T00:00",
  { state: "ongoing", ongoing: [b], daysSinceEnd: null });
const c = entry(3, "2026-07-01", "2026-07-15", { startTime: "14:30" });
const d = entry(4, "2026-07-01", "2026-07-20", { startTime: "14:30" });
sample("同時刻開始2件", character(c, d), "2026-08-01T00:00",
  { latestStarted: [c, d], latestEnded: [d], daysSinceStart: 30, startPrecision: "exact" });
sample("月だけの日付", character(entry(1, "2023-01")), "2026-10-28T12:00",
  { state: "waiting", daysSinceStart: null, daysSinceEnd: null, startPrecision: null, endPrecision: null, endUnknown: true });
sample("初回実装のみ", { availability: "星の導き", pickupHistory: [{ kind: "初回実装", date: "2026-01-01" }] }, "2026-10-28T12:00",
  { state: "history_unknown", recordedRounds: 0, latestStarted: [], latestEnded: [] });
sample("補完キャラ", { id: "supp-r-001", availability: "", pickupHistory: [] }, "2026-10-28T12:00",
  { state: "history_unknown", totalRounds: null, ongoing: [], upcoming: [], daysSinceStart: null, daysSinceEnd: null });
sample("終了境界ちょうど", character(entry(1, "2026-10-01", "2026-10-29", { endTime: "14:29", endTimeSource: "合成検証用" })), "2026-10-29T14:30",
  { state: "waiting", daysSinceEnd: 0, endPrecision: "exact", endUnknown: false });

const tiedEnd = entry(5, "2026-07-02", "2026-07-20");
sample("終了境界同値・日付単位の開始", { ...character(d, tiedEnd), pickupCount: 7 }, "2026-08-01T00:00",
  { latestEnded: [d, tiedEnd], daysSinceStart: 30, startPrecision: "date_based", recordedRounds: 2, totalRounds: 7 });
sample("最新開始同値の片方が終了不明", character(c, { ...d, endDate: undefined }), "2026-08-01T00:00",
  { latestStarted: [c, { ...d, endDate: undefined }], daysSinceEnd: null, endUnknown: true });
sample("開催中を開始順に整列", character(b, a), "2026-05-15T00:00", { ongoing: [a, b], latestStarted: [b] });
const futureA = { ...a, announced: true };
const futureB = { ...b, announced: true };
sample("予定を開始順に整列", character(futureB, futureA), "2026-04-01T00:00",
  { upcoming: [futureA, futureB], latestStarted: [], daysSinceEnd: null, endUnknown: true });
sample("日付なし履歴も記録件数に含む", character({ kind: "復刻" }), "2026-10-28T12:00",
  { recordedRounds: 1, latestStarted: [], latestEnded: [] });

console.log("=== 3. 全120体・4時点の既存判定との一致 ===");
check("正本キャラ数", data.characters.length, 120);
for (const now of ["2026-10-28T12:00", "2026-10-29T14:30", "2026-10-29T16:30", "2026-11-20T16:30"]) {
  const mismatches = data.characters.filter((ch) => {
    const existing = gs.gachaStatus(ch, now).state;
    const expected = existing === "normal" ? (ch.availability === "恒常" ? "permanent" : "history_unknown") : existing;
    return gs.arcanaGachaSummary(ch, now).state !== expected;
  }).map((ch) => ch.id);
  pass += data.characters.length - mismatches.length;
  fail += mismatches.length;
  console.log(`${mismatches.length ? "NG" : "OK"} 既存判定と一致 ${now} ${data.characters.length - mismatches.length}/${data.characters.length}`);
  if (mismatches.length) console.log(`不一致: ${mismatches.join(", ")}`);
}
console.log(`=== 結果: ${pass}件OK / ${fail}件NG ===`);
if (fail) process.exit(1);
