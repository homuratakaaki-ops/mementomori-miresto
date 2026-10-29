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
  const withoutManagedBlocks = text => text.replace(/<!-- ga:head -->[\s\S]*?<!-- \/ga:head -->/g, "")
    .replace(/<!-- ad:(head|bottom) -->[\s\S]*?<!-- \/ad:\1 -->/g, "");
  const withoutAnalytics = withoutManagedBlocks(html);
  const existing = new Set(urls(withoutManagedBlocks(read("index.html"))));
  for (const url of urls(withoutAnalytics + json)) {
    assert.ok(new URL(url).origin === "https://memento.musoudc.com" || existing.has(url), `許可されないURL: ${url}`);
  }
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.ok(/^(?:https:\/\/|\/(?!\/)|\.\.\/)/.test(match[1]) || match[1] === "#arcana-results", "許可されない参照形式");
  }
  const scripts = [...withoutAnalytics.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(match => match[0]);
  assert.equal(scripts.length, 4);
  ["gacha-status", "search-normalize", "render-arcana", "arcana-search"].forEach((name, i) => {
    assert.match(scripts[i], new RegExp(`^<script defer src="\\.\\./\\.\\./js/${name}\\.js\\?v=[0-9a-f]{8}"></script>$`));
  });
  assert.equal((html.match(/<!-- ad:bottom -->/g) || []).length, 1);
  assert.equal((html.match(/<!-- ad:mid -->/g) || []).length, 0);
  assert.equal(/<details\b[^>]*\bopen\b/.test(html), false);
  return "禁止語・外部URL混入なし / 指定JS4本のみ（versioned付き）・下部広告目印1つ・本文中広告目印なし / detailsは閉じた状態";
});
check("P04", () => {
  assert.match(html, /<p data-status-time>開催状況：\d{4}\/\d{2}\/\d{2} 時点<\/p>/);
  assert.ok(html.includes('<title>アルカナ検索 | ミレストのメメントモリ分析データ室</title>'));
  assert.ok(html.includes('<meta property="og:title" content="アルカナ検索 | ミレストのメメントモリ分析データ室">'));
  assert.equal(/<meta\b[^>]*\bcontent="[^"]*noindex/i.test(html), false);
  assert.ok(html.includes('<link rel="canonical" href="https://memento.musoudc.com/pages/arcana/index.html">'));
  const locations = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const arcanaUrl = "https://memento.musoudc.com/pages/arcana/index.html";
  assert.equal(locations.filter(url => url === arcanaUrl).length, 1);
  assert.equal(locations[locations.indexOf(arcanaUrl) + 1], "https://memento.musoudc.com/pages/characters/index.html");
  const hrefs = text => [...text.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
  const count = (text, href) => hrefs(text).filter(url => url === href).length;
  // TOPはメインナビに1つ、できること欄のカードに1つ（計2つ）。
  const top = read("index.html");
  const topNav = (top.match(/<nav class="actions" aria-label="メインナビ">[\s\S]*?<\/nav>/) || [""])[0];
  const topContents = (top.match(/<section aria-labelledby="contents-title">[\s\S]*?<\/section>/) || [""])[0];
  assert.equal(count(topNav, "./pages/arcana/index.html"), 1, "index.html メインナビ");
  assert.equal(count(topContents, "./pages/arcana/index.html"), 1, "index.html できること");
  assert.equal(count(top, "./pages/arcana/index.html"), 2, "index.html 合計");
  assert.equal(count(read("pages/characters/index.html"), "../arcana/index.html"), 1, "pages/characters/index.html");
  assert.equal(JSON.parse(read("data/news.json")).items.filter(item => item.url === "pages/arcana/index.html").length, 1);
  return "公開状態：noindexなし・canonicalあり / sitemap・キャラ一覧・news 各1件 / TOPはメインナビ・できること各1件";
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
  function git(...args) {
    const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  const status = git("status", "--porcelain", "-z");
  assert.ok(!status.split("\0").filter(Boolean).some(entry => !entry.startsWith("?? ")),
    "作業ツリーをコミットまたは退避してから実行");
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
  try {
    const first = build(), second = build();
    files.forEach((file, i) => assert.ok(first[i].equals(second[i]), `${file}: バイト不一致`));
  } finally {
    const changed = git("diff", "--name-only", "-z", "HEAD", "--").split("\0").filter(Boolean);
    let restored = 0;
    try {
      for (const file of changed) {
        git("checkout", "--", file);
        restored++;
      }
    } finally {
      console.log(`P07: 生成物 ${restored}件を HEAD に戻した`);
    }
  }
  return "固定JST 2026-10-28T12:00で正規ビルド2回 / 2ファイルともバイト一致";
});
const affiliationPattern = /<!-- arcana:affiliation -->[\s\S]*?<!-- \/arcana:affiliation -->\r?\n/g;
const jumpPattern = /<!-- arcana:jump -->[\s\S]*?<!-- \/arcana:jump -->\r?\n/g;
const detailPages = base.characters.map(character => {
  const file = `pages/characters/${character.pageSlug}.html`;
  const page = read(file);
  return { character, file, page, sections: [...page.matchAll(affiliationPattern)],
    items: index.arcana.filter(item => item.members.includes(character.id)) };
});
check("P08", () => {
  assert.equal(detailPages.length, base.characters.length);
  let total = 0;
  for (const { character, page, sections, items } of detailPages) {
    assert.equal((page.match(/<!-- arcana:affiliation -->/g) || []).length, 1, character.id);
    assert.equal(sections.length, 1, character.id);
    assert.equal((sections[0][0].match(/class="arcana-affiliation-item"/g) || []).length, items.length, character.id);
    assert.equal((page.match(jumpPattern) || []).length, items.length ? 1 : 0, character.id);
    assert.equal((page.match(/<a\b[^>]*href="#arcana"/g) || []).length, items.length ? 1 : 0, character.id);
    if (!items.length) assert.ok(sections[0][0].includes("現在の収録資料では所属を確認できていません"), character.id);
    assert.equal(page.includes(`所属アルカナ（${items.length}件）へ`), items.length > 0, character.id);
    total += items.length;
  }
  assert.equal(total, 214);
  assert.equal(Math.max(...detailPages.map(row => row.items.length)), 5);
  assert.deepEqual(detailPages.find(row => row.character.id === "soltina").items.map(item => item.id), ["A007", "A018", "A031", "A047", "A061"]);
  return `正本${base.characters.length}体に所属欄1つずつ / 合計214件・最大5件 / ソルティーナの5件一致`;
});
check("P09", () => {
  const { escapeHtml } = require("../js/render-arcana.js");
  let checked = 0;
  for (const { character, sections, items } of detailPages) {
    assert.equal(sections.length, 1, character.id);
    const section = sections[0][0];
    const search = `../arcana/index.html?character=${encodeURIComponent(character.id)}&scope=named`;
    const expected = [];
    const members = [...section.matchAll(/<p class="arcana-affiliation-members">構成キャラ：([\s\S]*?)<\/p>/g)];
    assert.equal(members.length, items.length);
    items.forEach((item, position) => {
      expected.push(`${search}&open=${item.id}#arcana-${item.id}`);
      assert.ok(html.includes(`id="arcana-${item.id}"`));
      const expectedMembers = item.members.map(id => {
        const member = index.characters[id];
        if (!member) return "未特定キャラ";
        if (id === character.id) return `${escapeHtml(member.name)}（このキャラ）`;
        if (!member.pageSlug) return `${escapeHtml(member.name)}（キャラ詳細未掲載）`;
        const href = `./${encodeURIComponent(member.pageSlug)}.html`;
        expected.push(href);
        assert.ok(fs.existsSync(path.join(ROOT, "pages/characters", member.pageSlug + ".html")), href);
        return `<a href="${escapeHtml(href)}">${escapeHtml(member.name)}</a>`;
      }).join("／");
      assert.equal(members[position][1], expectedMembers, `${character.id}/${item.id}`);
    });
    expected.push(search);
    const actual = [...section.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(actual, expected.map(escapeHtml), character.id);
    checked += actual.length;
  }
  assert.ok(fs.existsSync(path.join(ROOT, "pages/arcana/index.html")));
  return `所属欄の全${checked}リンク実在・形式一致 / 自分・補完キャラ・未特定枠にリンクなし`;
});
if (!process.env.MIRESTO_ARCANA_BASELINE) {
  console.log("P10 SKIP（MIRESTO_ARCANA_BASELINE 未指定）");
} else check("P10", () => {
  const baseline = process.env.MIRESTO_ARCANA_BASELINE;
  assert.ok(fs.existsSync(baseline), `基準なし: ${baseline}`);
  const normalize = text => text.replace(/\?v=[a-f0-9]{8}/g, "");
  const changed = [];
  for (const { file, page } of detailPages) {
    const original = path.join(baseline, file);
    assert.ok(fs.existsSync(original), `基準なし: ${file}`);
    if (normalize(page.replace(affiliationPattern, "").replace(jumpPattern, "")) !== normalize(fs.readFileSync(original, "utf8"))) changed.push(file);
  }
  assert.deepEqual(changed, [], "所属欄・ジャンプ・印以外の差分");
  return `キャラ詳細${base.characters.length}件が基準と一致（所属欄・ジャンプ除去、?v=正規化）`;
});
check("P11", () => {
  const forbidden = /sourceUrl|evidence|verification|endTimeSource|notion|libfile|sha256|\u30a2\u30eb\u30c6\u30de|altema|\u3044\u3061\u3054|ichigo|参考資料|原本未確認|LR表示確認|ゲーム画像/i;
  for (const { character, sections } of detailPages) {
    assert.equal(sections.length, 1, character.id);
    const section = sections[0][0];
    assert.equal(forbidden.test(section), false, character.id);
    assert.match(section, /<p class="arcana-affiliation-more">[^\n]*<\/p>\s*<\/section>\s*<!-- \/arcana:affiliation -->/);
    assert.equal(/arcana-status|開催中|開催予定|復刻待ち|出典：/.test(section), false, character.id);
  }
  return "所属欄にP03禁止語・開催状況・出典ラベルなし / 末尾は段落・sectionで閉じる";
});
check("P12", () => {
  const expected = [...new Set(source.arcana.flatMap(a => a.stages.flatMap(s => s.effects.map(e => e.statKey))))].sort();
  const actual = [...html.matchAll(/name="effect" value="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(actual.slice().sort(), expected);
  assert.equal(actual.length, 24);
  assert.equal(/arcana-quick-effects|すべての効果/.test(html), false);
  const groups = [...html.matchAll(/<details class="arcana-effect-group"([^>]*)><summary>([^<]+)<span data-effect-count><\/span><\/summary>([\s\S]*?)<\/details>/g)];
  assert.deepEqual(groups.map(m => m[2]), ['ステータス', '潜在能力', 'クリティカル', '命中・回避', 'HPドレイン・カウンタ', '貫通', '上限']);
  groups.forEach(m => { assert.ok(!/\bopen\b/.test(m[1])); assert.match(m[3], /name="effect"/); });
  assert.match(html, /name="effectGroup" value="physical_magical_penetration,penetration"/);
  return '効果24種類が正本と完全一致 / 7グループ初期閉 / 貫通2種類';
});
check("P13", () => {
  let badges = 0;
  const counts = {};
  for (const card of cards) {
    const item = index.arcana.find(a => `arcana-${a.id}` === card[1]);
    const actual = [...card[2].matchAll(/<small class="arcana-attribute" data-attribute="([^"]+)">([^<]+)<\/small>/g)];
    const expected = item.members.map(id => index.characters[id]).filter(Boolean).map(c => c.attribute);
    assert.deepEqual(actual.map(m => m[1]), expected);
    actual.forEach(m => { assert.equal(m[1], m[2]); counts[m[1]] = (counts[m[1]] || 0) + 1; });
    badges += actual.length;
  }
  assert.match(html, /href="\.\.\/\.\.\/assets\/attribute-palette\.css\?v=[a-f0-9]{8}"/);
  assert.deepEqual([...html.matchAll(/name="xattr" value="([^"]+)"([^>]*)>/g)].map(m => {
    assert.ok(!/\bchecked\b/.test(m[2])); return m[1];
  }), ['blue', 'red', 'green', 'yellow', 'light', 'dark']);
  return `属性バッジ${badges}枠が既知の構成キャラと一致 / ${JSON.stringify(counts)} / 除外6属性は未選択`;
});
process.exitCode = failed ? 1 : 0;
