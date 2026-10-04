/**
 * 開催状況の計算ルール（js/gacha-status.js）の単体検証。
 *
 *   node scripts/verify-gacha-status.cjs
 *
 * 「今日」を差し替えた判定・恒常22体・初回実装のみの扱い・endDateなしの回・
 * 手入力の gachaStatus を無視していること・JST判定を点検する。
 * 判定ルールを変えたらこのファイルも併せて直すこと（AGENTS.md「ガチャの開催状況は計算項目」）。
 */
const fs = require("fs");
const path = require("path");
const ROOT = process.cwd();
const gs = require(path.join(ROOT, "js", "gacha-status.js"));
const indexRenderer = require(path.join(ROOT, "js", "render-character-index.js"));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "mementomori-skills.json"), "utf8"));
const byId = new Map(data.characters.map((c) => [c.id, c]));

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "OK  " : "NG  "} ${label}\n       期待=${JSON.stringify(expected)} 実際=${JSON.stringify(actual)}`);
}

console.log("=== 1. 「今日」を差し替えた判定 ===");
const art = byId.get("artoria_golden");
check("[黄金]アルトリア @2026-10-04 (期間 9/30〜10/15 内)", gs.gachaStatusText(art, "2026-10-04"), "PU中（〜10/15）");
check("[黄金]アルトリア @2026-09-30 (開始日ちょうど)", gs.gachaStatusText(art, "2026-09-30"), "PU中（〜10/15）");
check("[黄金]アルトリア @2026-10-15 (終了日ちょうど)", gs.gachaStatusText(art, "2026-10-15"), "PU中（〜10/15）");
check("[黄金]アルトリア @2026-10-16 (期間後)", gs.gachaStatusText(art, "2026-10-16"), "復刻待ち");
check("[黄金]アルトリア @2026-09-29 (期間前・過去回なし)", gs.gachaStatusText(art, "2026-09-29"), "PU・運命");

check("レジーナ @2026-10-04 (復刻 9/24〜10/8)", gs.gachaStatusText(byId.get("regina"), "2026-10-04"), "復刻中（〜10/8）");
check("レジーナ @2026-10-09 (復刻後)", gs.gachaStatusText(byId.get("regina"), "2026-10-09"), "復刻待ち");
check("ステラ @2026-10-04 (星の導き 9/24〜10/15)", gs.gachaStatusText(byId.get("stella"), "2026-10-04"), "星の導き開催中（〜10/15）");

console.log("\n=== 2. 恒常22体 ===");
const launch = data.characters.filter((c) => (c.pickupHistory || []).every((e) => e.kind === "初回実装") && (c.pickupHistory || []).length > 0);
console.log(`  リリース組: ${launch.length}体`);
for (const day of ["2026-10-04", "2026-10-16", "2027-05-01"]) {
  const wrong = launch.filter((c) => gs.gachaStatusText(c, day) !== "恒常");
  check(`リリース組${launch.length}体すべて「恒常」 @${day}`, wrong.length, 0);
}
check("恒常キャラは「復刻待ち」にならない", launch.some((c) => gs.gachaStatusText(c, "2026-10-16") === "復刻待ち"), false);

console.log("\n=== 3. 履歴が初回実装のみ／空の体は availability をそのまま ===");
// 現データでは「初回実装のみ」の22体はすべて availability が恒常なのでルール2に吸収される。
// ルール4（復刻待ちと出さない）は合成ケースで確認する。
check("初回実装のみ＋availability=PU・運命", gs.gachaStatusText({ availability: "PU・運命", pickupHistory: [{ date: "2022-10-18", kind: "初回実装" }] }, "2026-10-04"), "PU・運命");
check("履歴が空＋availability=星の導き", gs.gachaStatusText({ availability: "星の導き", pickupHistory: [] }, "2026-10-04"), "星の導き");
check("pickupHistory 未定義＋availability=夏イベント", gs.gachaStatusText({ availability: "夏イベント" }, "2026-10-04"), "夏イベント");
check("初回実装のみは「復刻待ち」と出さない", gs.gachaStatusText({ availability: "PU・運命", pickupHistory: [{ date: "2022-10-18", kind: "初回実装" }] }, "2026-10-04") === "復刻待ち", false);

console.log("\n=== 4. endDate が無い回は開催中と判定しない ===");
check("endDateなし・開始日が今日", gs.isOngoing({ date: "2026-10-04", kind: "PU", round: 1 }, "2026-10-04"), false);
check("endDateなしの回だけを持つ体", gs.gachaStatusText({ availability: "PU・運命", pickupHistory: [{ date: "2026-10-04", kind: "PU", round: 1 }] }, "2026-10-04"), "復刻待ち");
const noEnd = data.characters.filter((c) => (c.pickupHistory || []).some((e) => !e.endDate && e.kind !== "初回実装"));
const falseOngoing = noEnd.filter((c) => {
  const e = gs.ongoingEntry(c, "2026-10-04");
  return e && !e.endDate;
});
check(`endDateなしの回を持つ${noEnd.length}体で誤って開催中にならない`, falseOngoing.length, 0);

console.log("\n=== 5. 将来の予定は出さない ===");
check("開始日が未来の回は開催中にしない", gs.isOngoing({ date: "2026-11-01", endDate: "2026-11-15", kind: "PU", round: 2 }, "2026-10-04"), false);
const futureText = data.characters.map((c) => gs.gachaStatusText(c, "2026-10-04")).join("|");
check("表示文に「次回」「予定」が出ない", /次回|予定/.test(futureText), false);

console.log("\n=== 6. 手入力の gachaStatus を全部空にしても表示が同じ ===");
const today = "2026-10-04";
const before = indexRenderer.renderGrid(data.characters, "all", today);
const cleared = JSON.parse(JSON.stringify(data.characters)).map((c) => { c.gachaStatus = ""; return c; });
const afterCleared = indexRenderer.renderGrid(cleared, "all", today);
check("gachaStatus を全部空にしたカード一覧が同一", afterCleared === before, true);
const removed = JSON.parse(JSON.stringify(data.characters)).map((c) => { delete c.gachaStatus; return c; });
check("gachaStatus のキー自体を消したカード一覧が同一", indexRenderer.renderGrid(removed, "all", today) === before, true);
const bogus = JSON.parse(JSON.stringify(data.characters)).map((c) => { c.gachaStatus = "でたらめ"; return c; });
check("gachaStatus にでたらめを入れても一覧が同一（参照していない）", indexRenderer.renderGrid(bogus, "all", today) === before, true);

console.log("\n=== 7. JSTで判定している ===");
// UTC 2026-10-14T15:30Z = JST 2026-10-15T00:30 → 判定日は10-15
check("UTC 2026-10-14T15:30Z の判定日", gs.jstToday("2026-10-14T15:30:00Z"), "2026-10-15");
check("UTC 2026-10-14T14:30Z の判定日", gs.jstToday("2026-10-14T14:30:00Z"), "2026-10-14");
check("終了日ちょうどのJST境界で開催中が維持される", gs.gachaStatusText(art, gs.jstToday("2026-10-14T15:30:00Z")), "PU中（〜10/15）");

console.log(`\n=== 結果: ${pass}件OK / ${fail}件NG ===`);
if (fail > 0) process.exit(1);
