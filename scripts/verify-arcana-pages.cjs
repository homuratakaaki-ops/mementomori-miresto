#!/usr/bin/env node
/* 生成後の点検。P07は固定JSTで正規ビルドを2回行い、メモリ上で比較する。 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { gzipSync } = require("node:zlib");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const html = read("pages/arcana/index.html");
const json = read("data/arcana-index.json");
const index = JSON.parse(json);
const source = JSON.parse(read("data/arcana.json"));
const base = JSON.parse(read("data/mementomori-skills.json"));
const meta = JSON.parse(read("data/arcana-character-meta.json"));
const cards = [...html.matchAll(/<article class="arcana-card" id="([^"]+)">([\s\S]*?)<\/article>/g)];
let failed = 0;
function check(code, fn) {
  try { console.log(`${code} OK: ${fn()}`); }
  catch (error) { failed++; console.error(`${code} NG: ${error.message}`); }
}
check("P01", () => {
  assert.deepEqual(cards.map(card => card[1]), Array.from({ length: 101 }, (_, i) => `arcana-A${String(i + 1).padStart(3, "0")}`));
  assert.equal((html.match(/<article\b/g) || []).length, 101);
  return "カード101件 / A001〜A101（管理番号順）";
});
check("P02", () => {
  let links = 0, supplemental = 0, unknown = 0;
  for (const card of cards) {
    const item = index.arcana.find(item => `arcana-${item.id}` === card[1]);
    const rows = [...card[2].matchAll(/<li class="arcana-member">([\s\S]*?)<\/li>/g)];
    assert.equal(rows.length, item.members.length);
    rows.forEach((row, position) => {
      const character = index.characters[item.members[position]];
      const anchors = [...row[1].matchAll(/<a\b[^>]*href="([^"]+)"/g)];
      if (character?.pageSlug) {
        assert.equal(anchors.length, 1);
        assert.equal(anchors[0][1], `../characters/${encodeURIComponent(character.pageSlug)}.html`);
        assert.ok(fs.existsSync(path.join(ROOT, "pages/characters", character.pageSlug + ".html")));
        links++;
      } else {
        assert.equal(anchors.length, 0);
        if (character) {
          assert.ok(row[1].includes("キャラ詳細未掲載") && row[1].includes("履歴未確認"));
          supplemental++;
        } else {
          assert.equal(row[1], "未特定キャラ");
          unknown++;
        }
      }
    });
  }
  return `正本リンク${links}件実在 / 補完${supplemental}枠・未特定${unknown}枠にリンクなし`;
});
check("P03", () => {
  // 禁止語は検査用。公開生成物に含まれないことを保証する。
  const forbidden = /sourceUrl|evidence|verification|endTimeSource|notion|libfile|sha256|\u30a2\u30eb\u30c6\u30de|altema|\u3044\u3061\u3054|ichigo|参考資料|原本未確認|LR表示確認|ゲーム画像/i;
  assert.equal(forbidden.test(html + json), false);
  const urls = text => [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(match => match[0]);
  const existing = new Set(urls(read("index.html")));
  for (const url of urls(html + json)) {
    assert.ok(new URL(url).origin === "https://memento.musoudc.com" || existing.has(url), `許可されないURL: ${url}`);
  }
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.ok(/^(?:https:\/\/|\/(?!\/)|\.\.\/)/.test(match[1]), "許可されない参照形式");
  }
  const withoutAnalytics = html.replace(/<!-- ga:head -->[\s\S]*?<!-- \/ga:head -->/g, "");
  assert.equal(/<script\b|<!-- ad:/.test(withoutAnalytics), false);
  assert.equal(/<details\b[^>]*\bopen\b/.test(html), false);
  return "禁止語・外部URL混入なし / 機能JS・広告目印なし / detailsは閉じた状態";
});
check("P04", () => {
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(html.includes('<link rel="canonical" href="https://memento.musoudc.com/pages/arcana/index.html">'));
  assert.equal(read("sitemap.xml").includes("/pages/arcana/"), false);
  for (const file of ["index.html", "pages/characters/index.html", "data/news.json"]) {
    assert.equal(/(?:pages\/|\.\.\/)arcana\//.test(read(file)), false);
  }
  return "noindex・canonicalあり / sitemap・TOP・キャラ一覧・newsに導線なし";
});
check("P05", () => {
  // LR概要は数えず、各カードの段階詳細だけを数える。
  const details = cards.map(card => card[2].slice(card[2].indexOf('<details class="arcana-details">'))).join("\n");
  const pendingLines = [...details.matchAll(/<li\b[^>]*>([^<]*)<\/li>/g)].filter(match => match[1].includes("（確認中）")).length;
  const pendingStages = (details.match(/この段階は確認中です/g) || []).length;
  const stages = source.arcana.flatMap(item => item.stages);
  const pendingEffects = stages.flatMap(stage => stage.effects).filter(effect => ["conflict", "unknown"].includes(effect.verification));
  const hidden = stages.filter(stage => stage.condition.verification === "conflict");
  assert.equal(pendingLines, 57);
  assert.equal(pendingStages, 4);
  assert.equal(hidden.length, 4);
  assert.equal(hidden.flatMap(stage => stage.effects).length, 8);
  assert.ok(hidden.flatMap(stage => stage.effects).every(effect => ["conflict", "unknown"].includes(effect.verification)));
  assert.equal(pendingEffects.length, 65);
  return "段階詳細で確認中57行 / 確認中段階4件 / 非表示8効果 / 正本65＝57＋8（LR概要は除外）";
});
check("P06", () => {
  const bytes = Buffer.byteLength(json), gzipBytes = gzipSync(json).length;
  assert.ok(gzipBytes <= 150 * 1024);
  assert.equal(index.arcana.length, 101);
  assert.equal(Object.keys(index.characters).length, 132);
  assert.deepEqual(Object.keys(index), ["schema", "note", "arcana", "characters"]);
  assert.equal(index.schema, "miresto_arcana_index_v1");
  const canonical = new Map(base.characters.map(character => [character.id, character]));
  const used = [...new Set(source.arcana.flatMap(item => item.members.map(member => member.characterId)).filter(Boolean))].sort();
  assert.deepEqual(Object.keys(index.characters), used);
  for (const id of used) {
    const original = canonical.get(id), character = original || meta.characters[id];
    const expected = {
      name: character.name, reading: character.reading, attribute: character.attribute,
      pageSlug: original ? character.pageSlug : null, availability: original ? character.availability || "" : "",
      ...(original && character.pickupCount !== undefined ? { pickupCount: character.pickupCount } : {}),
      pickupHistory: original ? (character.pickupHistory || []).map(entry => Object.fromEntries(
        ["date", "endDate", "startTime", "endTime", "kind", "round", "announced"]
          .filter(key => entry[key] !== undefined && entry[key] !== null && entry[key] !== "").map(key => [key, entry[key]]))) : []
    };
    assert.deepEqual(index.characters[id], expected);
  }
  for (const item of source.arcana) {
    const projected = index.arcana.find(row => row.id === item.id);
    assert.equal(projected.name, item.name);
    assert.deepEqual(projected.members, item.members.slice().sort((a, b) => a.slot - b.slot).map(member => member.characterId || null));
    assert.deepEqual(projected.aliases, item.aliases?.length ? item.aliases : undefined);
    assert.equal(projected.stages.length, item.stages.length);
    item.stages.forEach((stage, i) => assert.deepEqual(projected.stages[i], {
      label: stage.label, condition: stage.condition.displayText, pending: stage.condition.verification === "conflict",
      effects: stage.effects.map(effect => ({ statKey: effect.statKey, target: effect.target, text: effect.displayText,
        pending: ["conflict", "unknown"].includes(effect.verification) }))
    }));
  }
  return `アルカナ101件 / キャラ132体 / 正本との射影一致 / 生${bytes} bytes / gzip ${gzipBytes} bytes（150KB以下）`;
});
check("P07", () => {
  // 成功ログ・計測IDをディスクへ保存しない。ビルド失敗時は即座に比較を中断する。
  const files = ["data/arcana-index.json", "pages/arcana/index.html"];
  function build() {
    const result = spawnSync(process.execPath, ["scripts/build-character-pages.mjs"], {
      cwd: ROOT, env: { ...process.env, MIRESTO_NOW: "2026-10-28T12:00" }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return files.map(file => fs.readFileSync(path.join(ROOT, file)));
  }
  const first = build(), second = build();
  files.forEach((file, i) => assert.ok(first[i].equals(second[i]), `${file}: バイト不一致`));
  return "固定JST 2026-10-28T12:00で正規ビルド2回 / 2ファイルともバイト一致";
});
process.exitCode = failed ? 1 : 0;
