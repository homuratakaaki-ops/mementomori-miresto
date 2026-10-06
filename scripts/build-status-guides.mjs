#!/usr/bin/env node
/**
 * 状態異常ガイドの事前生成（プリレンダリング）。
 *
 * 手入力の正は data/status/*.json。1ファイル＝1つの状態異常で、
 * 本文・付与するキャラ・参照するキャラ・強化するキャラ・関連する効果・出典を持つ。
 *
 * 出力:
 *   pages/status/{id}.html  … 状態異常ごとのガイド（JSを無効にしても本文が全部読める）
 *   pages/status/index.html … 状態異常ガイドの入口（data/status/*.json を列挙）
 *   sitemap.xml             … 上記のURLを追記（既にあれば触らない）
 *
 * ここでは「正規データ（data/mementomori-skills.json）から機械で抽出した候補」と
 * 「手入力の一覧」を突き合わせ、過不足があれば生成を止める。
 * 手入力漏れと新キャラの取りこぼしを人の目に頼らず拾うための仕掛けなので、
 * 例外を入れるときは data/status/*.json の ignore に理由を書いて明示すること。
 *
 * lastCrossCheck（最終横断確認日）は手入力だけが正で、ここでは書き換えない。
 *
 * 呼び出しは scripts/build-character-pages.mjs から。
 * キャラページを書き出した後に呼ぶこと（直リンク先のアンカーを実ファイルで確かめるため）。
 */
import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_DATA_DIR = join(ROOT, "data", "status");
const STATUS_PAGES_DIR = join(ROOT, "pages", "status");
const CHARACTER_PAGES_DIR = join(ROOT, "pages", "characters");

const renderer = require(join(ROOT, "js", "render-character.js"));
const adRenderer = require(join(ROOT, "js", "render-ad-slot.js"));
const escapeHtml = renderer.escapeHtml;

const SITE_ORIGIN = renderer.SITE_ORIGIN;
const TITLE_SUFFIX = renderer.TITLE_SUFFIX;
const INDEX_TITLE = "状態異常ガイド｜" + TITLE_SUFFIX;
const INDEX_DESCRIPTION = "毒などの状態異常について、効果の発動タイミング・ダメージの計算・重ねたときの扱い・付与するキャラを整理した一覧です。";

/* ------------------------------------------------------------------
 * 1. 正規データからの自動抽出
 * ------------------------------------------------------------------ */

/** flow の枠。flow を持たないスキルは対象外（表示の正は flow 側にある）。 */
function flowBlocks(skill) {
  return Array.isArray(skill.flow) ? skill.flow : [];
}

/** 効果1行と、その中の専用武器による追加・変更をまとめて列挙する。 */
function* flowEffects(skill) {
  for (const block of flowBlocks(skill)) {
    for (const effect of block.effects || []) {
      yield { block, effect };
      for (const item of effect.exclusive || []) {
        yield { block, effect: item };
        for (const nested of item.exclusive || []) yield { block, effect: nested };
      }
    }
  }
}

/**
 * 付与する側の候補。効果行の本文が「○○を付与」と言っているスキル。
 * 「毒を付帯している敵」のような参照の文言はここでは拾わない。
 */
function isGiver(skill, term) {
  for (const entry of flowEffects(skill)) {
    if (String(entry.effect.text || "").includes(term + "を付与")) return true;
  }
  return false;
}

/**
 * 参照する側の候補。枠の「誰に」または効果の条件が状態異常を見ているスキル。
 * 「毒付帯」「毒状態」「毒を付帯」の3通りの書き方を拾う。
 */
function isUser(skill, term) {
  const refers = (value) => {
    const text = String(value || "");
    return text.includes(term + "付帯") || text.includes(term + "状態") || text.includes(term + "を付帯");
  };
  for (const block of flowBlocks(skill)) {
    if (refers(block.target)) return true;
    for (const item of block.exclusiveTarget || []) if (refers(item.target)) return true;
  }
  for (const entry of flowEffects(skill)) {
    if (refers(entry.effect.condition)) return true;
  }
  return false;
}

/**
 * 強化する側の候補。劇化を付与するスキル、または受ける持続ダメージを増やすスキル。
 * 持続ダメージの増加は状態異常の種類を問わないので、どのガイドでも同じ候補が出る。
 */
function isAmplifier(skill) {
  for (const entry of flowEffects(skill)) {
    const text = String(entry.effect.text || "");
    if (text.includes("劇化")) return true;
    if (text.includes("持続ダメージ") && text.includes("増加")) return true;
  }
  return false;
}

const EXTRACTORS = {
  givers: (skill, term) => isGiver(skill, term),
  users: (skill, term) => isUser(skill, term),
  amplifiers: (skill) => isAmplifier(skill)
};

const KIND_LABEL = { givers: "付与する側", users: "参照する側", amplifiers: "強化する側" };
const KINDS = Object.keys(EXTRACTORS);

function extract(baseData, term, kind) {
  return (baseData.skills || [])
    .filter((skill) => EXTRACTORS[kind](skill, term))
    .map((skill) => skill.id);
}

/* ------------------------------------------------------------------
 * 2. 手入力の検証
 * ------------------------------------------------------------------ */

function skillKey(entry) {
  return entry.characterId + "-s" + entry.skill;
}

/** 「2T」と「2ターン」をそろえる（手入力は短い表記、スキルデータは「2ターン」）。 */
function normalizeDuration(value) {
  const match = String(value || "").match(/^([0-9]+)\s*(?:T|ターン)$/);
  return match ? match[1] + "ターン" : String(value || "");
}

/** 「現在HP×10%」「現在HP10%のダメージ」から割合だけ取り出す。 */
function currentHpPercent(value) {
  const match = String(value || "").match(/現在HP\s*×?\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
  return match ? match[1] : null;
}

/** その状態異常を付与している効果行（付与確率・継続・ダメージ割合の正）。 */
function giverEffect(skill, term) {
  for (const block of flowBlocks(skill)) {
    for (const effect of block.effects || []) {
      if (String(effect.text || "").includes(term + "を付与")) return effect;
    }
  }
  return null;
}

const NO_CHANCE = "数値表記なし";

/**
 * 自動抽出と手入力の突き合わせ。
 * 過不足はどちらもエラー。ignore に書いた分だけ「候補に出たが載せない」を許す。
 */
function validateLists(guide, baseData, errors) {
  const where = "data/status/" + guide.id + ".json";
  const ignore = guide.ignore || [];
  for (const entry of ignore) {
    if (!entry.kind || !entry.skillId || !entry.reason) {
      errors.push(where + ": ignore には kind / skillId / reason をそろえて書くこと");
    }
  }

  const summary = {};
  for (const kind of KINDS) {
    const auto = extract(baseData, guide.term, kind);
    const manual = (guide[kind] || []).map(skillKey);
    const skipped = new Set(ignore.filter((item) => item.kind === kind).map((item) => item.skillId));

    const duplicated = new Set(manual.filter((id, index) => manual.indexOf(id) !== index));
    for (const id of duplicated) errors.push(where + ": " + kind + " に " + id + " が2回書かれている");

    for (const id of auto) {
      if (manual.includes(id) || skipped.has(id)) continue;
      errors.push(where + ": " + kind + "（" + KIND_LABEL[kind] + "）の候補 " + id
        + " が手入力の一覧に無い。載せるか ignore に理由を書くこと");
    }
    for (const id of manual) {
      if (auto.includes(id)) continue;
      errors.push(where + ": " + kind + "（" + KIND_LABEL[kind] + "）の " + id
        + " は正規データから抽出されない。スキルデータ側を確かめること");
    }
    for (const id of skipped) {
      if (!auto.includes(id)) errors.push(where + ": ignore の " + id + " は候補に出ていない（不要な除外）");
    }
    summary[kind] = { auto: auto.length, manual: manual.length, ignored: skipped.size };
  }
  return summary;
}

/** givers の付与確率・ダメージ・持続が、該当スキルの効果行と一致しているか。 */
function validateGiverNumbers(guide, skillById, errors) {
  const where = "data/status/" + guide.id + ".json";
  let checked = 0;
  for (const entry of guide.givers || []) {
    const id = skillKey(entry);
    const skill = skillById.get(id);
    if (!skill) { errors.push(where + ": givers の " + id + " に対応するスキルが無い"); continue; }
    const effect = giverEffect(skill, guide.term);
    if (!effect) { errors.push(where + ": " + id + " に「" + guide.term + "を付与」の効果行が無い"); continue; }
    checked += 1;

    const chance = effect.chance || "";
    if (entry.chance === NO_CHANCE) {
      if (chance) {
        errors.push(where + ": " + id + " の付与確率は「" + NO_CHANCE
          + "」になっているが、スキルデータには " + chance + " がある");
      }
    } else if (entry.chance !== chance) {
      errors.push(where + ": " + id + " の付与確率「" + entry.chance + "」がスキルデータ「"
        + (chance || "記載なし") + "」と合わない");
    }

    if (normalizeDuration(entry.duration) !== String(effect.duration || "")) {
      errors.push(where + ": " + id + " の持続「" + entry.duration + "」がスキルデータ「"
        + (effect.duration || "記載なし") + "」と合わない");
    }

    const want = currentHpPercent(entry.damage);
    const have = currentHpPercent(effect.note);
    if (!want) {
      errors.push(where + ": " + id + " のダメージ「" + entry.damage + "」から現在HPの割合を読み取れない");
    } else if (want !== have) {
      errors.push(where + ": " + id + " のダメージ「" + entry.damage + "」がスキルデータ「"
        + (effect.note || "記載なし") + "」と合わない");
    }

    // 専用武器で付与性能が変わる回だけ、「特徴」にその専用Lvの説明があること。
    const levels = [...new Set((effect.exclusive || []).map((item) => Number(item.lv)))].sort((a, b) => a - b);
    const note = String(entry.note || "");
    for (const lv of levels) {
      if (!note.includes("Lv" + lv)) {
        errors.push(where + ": " + id + " は専用Lv" + lv + " で" + guide.term
          + "性能が変わるのに「特徴」に Lv" + lv + " の説明が無い");
      }
    }
    if (levels.length === 0 && note.includes("専用")) {
      errors.push(where + ": " + id + " の" + guide.term
        + "付与は専用武器で変わらないのに「特徴」が専用武器に触れている");
    }
  }
  return checked;
}

/** 直リンクの先が実在するページ＋アンカーかどうかを、生成済みのHTMLで確かめる。 */
function validateLinks(guide, characterById, errors) {
  const where = "data/status/" + guide.id + ".json";
  const cache = new Map();
  let checked = 0;
  for (const kind of KINDS) {
    for (const entry of guide[kind] || []) {
      const character = characterById.get(entry.characterId);
      if (!character) {
        errors.push(where + ": " + kind + " の " + entry.characterId + " がキャラ一覧に無い");
        continue;
      }
      const slug = character.pageSlug || character.id;
      if (!cache.has(slug)) {
        const path = join(CHARACTER_PAGES_DIR, slug + ".html");
        cache.set(slug, existsSync(path) ? readFileSync(path, "utf8") : null);
      }
      const html = cache.get(slug);
      checked += 1;
      if (html === null) {
        errors.push(where + ": 直リンク先のページが無い（pages/characters/" + slug + ".html）");
        continue;
      }
      if (!html.includes('id="skill-' + entry.skill + '"')) {
        errors.push(where + ": pages/characters/" + slug + ".html に id=\"skill-" + entry.skill + "\" が無い");
      }
    }
  }
  return checked;
}

/**
 * 図解の検証。
 * 画像の差し替え漏れ・置き場所違いをビルドで止める。
 * webp と jpg の2枚、原寸（width / height）、alt を必須にする
 * （原寸が無いと読み込み前に場所を取れず、本文が下にずれる）。
 */
function validateIllustration(guide, errors) {
  const where = "data/status/" + guide.id + ".json";
  const art = guide.illustration;
  if (!art) return;
  for (const key of ["webp", "src", "alt"]) {
    if (!art[key]) errors.push(where + ": illustration の " + key + " が無い");
  }
  for (const key of ["width", "height"]) {
    if (!Number.isInteger(art[key]) || art[key] <= 0) {
      errors.push(where + ": illustration の " + key + " は原寸（正の整数）で書くこと");
    }
  }
  for (const key of ["webp", "src"]) {
    if (art[key] && !existsSync(join(ROOT, art[key]))) {
      errors.push(where + ": illustration の " + key + " が見つからない（" + art[key] + "）");
    }
  }
}

/** 用語辞書の guideUrl がこのガイドを指しているか（キャラページ側の導線の正）。 */
function validateTermLink(guide, terms, errors) {
  const entry = renderer.termEntry(terms, guide.term);
  if (!entry) { errors.push("data/terms.json: 用語「" + guide.term + "」がありません"); return; }
  const expected = "/pages/status/" + guide.id + ".html";
  if (entry.guideUrl !== expected) {
    errors.push("data/terms.json: 用語「" + guide.term + "」のガイドURLは " + expected
      + " にすること（今は「" + (entry.guideUrl || "なし") + "」）");
  }
}

/**
 * 公開ページに置かない言葉の検査。
 * 評価・おすすめ・将来の予測・作業用の内部語は、このサイトの方針として本文に出さない。
 */
const FORBIDDEN_WORDS = [
  "おすすめ", "オススメ", "引くべき", "最強", "評価", "ランキング", "強キャラ",
  "次回", "予想", "だろう",
  "JSON", "json", "characterId", "skillId", "pageSlug", "lastCrossCheck", "guideUrl"
];

function validateWording(label, html, errors) {
  const text = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");
  for (const word of FORBIDDEN_WORDS) {
    if (text.includes(word)) errors.push(label + ": 本文に出さない語が入っている（" + word + "）");
  }
}

/* ------------------------------------------------------------------
 * 3. HTMLの組み立て
 * ------------------------------------------------------------------ */

function head(options) {
  return [
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>" + escapeHtml(options.title) + "</title>",
    '  <meta name="description" content="' + escapeHtml(options.description) + '">',
    '  <link rel="canonical" href="' + escapeHtml(options.canonical) + '">',
    "  <!-- OGP。画像は共通のものを使う（ガイドごとの画像生成は未対応） -->",
    '  <meta property="og:type" content="article">',
    '  <meta property="og:site_name" content="' + escapeHtml(TITLE_SUFFIX) + '">',
    '  <meta property="og:locale" content="ja_JP">',
    '  <meta property="og:title" content="' + escapeHtml(options.title) + '">',
    '  <meta property="og:description" content="' + escapeHtml(options.description) + '">',
    '  <meta property="og:url" content="' + escapeHtml(options.canonical) + '">',
    '  <meta property="og:image" content="' + escapeHtml(SITE_ORIGIN) + '/assets/ogp/ogp-common.png">',
    '  <meta name="twitter:card" content="summary_large_image">',
    '  <link rel="icon" href="/favicon.ico" sizes="32x32">',
    '  <link rel="icon" type="image/png" href="../../assets/miresto/miresto-icon-32.png" sizes="32x32">',
    '  <link rel="apple-touch-icon" href="../../assets/miresto/miresto-icon-180.png">',
    '  <link rel="stylesheet" href="../../assets/character-page.css">',
    '  <link rel="stylesheet" href="../../assets/status-guide.css">',
    adRenderer.renderAdHead(options.ads, "  ")
  ].join("\n");
}

function footer() {
  return [
    "  <footer>",
    '    <div class="footer-inner">',
    "      <span>ミレストのメメントモリ分析データ室 / 非公式ファンサイト</span>",
    '      <nav class="footer-links" aria-label="関連ページ">',
    '        <a href="../characters/index.html">キャラ一覧</a>',
    '        <a href="/pages/guide/">このサイトでできること</a>',
    "      </nav>",
    "    </div>",
    "  </footer>"
  ].join("\n");
}

function card(id, heading, bodyHtml) {
  return [
    '      <section class="guide-card" id="' + escapeHtml(id) + '" aria-labelledby="' + escapeHtml(id) + '-title">',
    '        <div class="guide-card-head">',
    '          <h2 id="' + escapeHtml(id) + '-title">' + escapeHtml(heading) + "</h2>",
    "        </div>",
    '        <div class="guide-card-body">',
    bodyHtml,
    "        </div>",
    "      </section>"
  ].join("\n");
}

function paragraphs(list) {
  return (list || []).map((text) => "          <p>" + escapeHtml(text) + "</p>").join("\n");
}

/** キャラ名＋スキル番号から、そのスキルカードへの直リンクを作る。 */
function skillLink(entry, characterById, skillById) {
  const character = characterById.get(entry.characterId);
  const skill = skillById.get(skillKey(entry));
  const slug = character.pageSlug || character.id;
  const label = character.name + " S" + entry.skill + (skill ? " " + skill.name : "");
  return '<a href="../characters/' + escapeHtml(slug) + ".html#skill-" + escapeHtml(entry.skill) + '">'
    + escapeHtml(label) + "</a>";
}

function onelineCard(guide) {
  const lines = [
    '          <div class="oneline">',
    '            <div class="oneline-text">',
    "              <p>" + escapeHtml(guide.summary) + "</p>",
    '              <p class="key-rule">' + escapeHtml(guide.keyRule) + "</p>",
    "            </div>"
  ];
  // 図解は説明文と上限の補足の直下。illustration が無いガイドでは何も出さない。
  // width / height は原寸のまま出し、見た目の大きさはCSSで決める（読み込みで本文がずれないため）。
  const art = guide.illustration;
  if (art) {
    lines.push('            <figure class="oneline-figure">');
    lines.push("              <picture>");
    lines.push('                <source type="image/webp" srcset="../../' + escapeHtml(art.webp) + '">');
    lines.push('                <img src="../../' + escapeHtml(art.src) + '" width="' + escapeHtml(art.width)
      + '" height="' + escapeHtml(art.height) + '" alt="' + escapeHtml(art.alt)
      + '" loading="lazy" decoding="async">');
    lines.push("              </picture>");
    lines.push("            </figure>");
  }
  lines.push("          </div>");
  return card("oneline", "ひとことで", lines.join("\n"));
}

function sectionCard(section, index) {
  const parts = [];
  if (section.body) parts.push(paragraphs(section.body));
  if (section.steps) {
    parts.push('          <ol class="steps">');
    for (const text of section.steps) parts.push("            <li>" + escapeHtml(text) + "</li>");
    parts.push("          </ol>");
  }
  return card("section-" + (index + 1), section.heading, parts.join("\n"));
}

function cell(label, value) {
  return '                  <td data-label="' + escapeHtml(label) + '">' + escapeHtml(value) + "</td>";
}

function giversCard(guide, characterById, skillById) {
  const parts = [
    '          <div class="guide-table-wrap">',
    '            <table class="guide-table">',
    "              <thead>",
    "                <tr>",
    '                  <th scope="col">キャラ／スキル</th>',
    '                  <th scope="col">付与確率</th>',
    '                  <th scope="col">' + escapeHtml(guide.name) + "ダメージ</th>",
    '                  <th scope="col">持続</th>',
    '                  <th scope="col">特徴</th>',
    "                </tr>",
    "              </thead>",
    "              <tbody>"
  ];
  for (const entry of guide.givers || []) {
    parts.push("                <tr>");
    parts.push('                  <th scope="row">' + skillLink(entry, characterById, skillById) + "</th>");
    // data-label は狭い画面で見出しを値の前に出すために使う（assets/status-guide.css）。
    parts.push(cell("付与確率", entry.chance));
    parts.push(cell(guide.name + "ダメージ", entry.damage));
    parts.push(cell("持続", normalizeDuration(entry.duration)));
    parts.push(cell("特徴", entry.note || ""));
    parts.push("                </tr>");
  }
  parts.push("              </tbody>");
  parts.push("            </table>");
  parts.push("          </div>");
  if ((guide.giversNote || []).length) {
    parts.push('          <ul class="guide-notes">');
    for (const text of guide.giversNote) parts.push("            <li>" + escapeHtml(text) + "</li>");
    parts.push("          </ul>");
  }
  return card("givers", guide.name + "を付与するキャラ", parts.join("\n"));
}

function linkList(entries, characterById, skillById) {
  const parts = ['            <ul class="guide-links">'];
  for (const entry of entries) {
    parts.push("              <li>" + skillLink(entry, characterById, skillById)
      + '<span class="guide-link-text">' + escapeHtml(entry.text) + "</span></li>");
  }
  parts.push("            </ul>");
  return parts.join("\n");
}

function usersCard(guide, characterById, skillById) {
  const parts = [];
  if (guide.usersIntro) parts.push("          <p>" + escapeHtml(guide.usersIntro) + "</p>");
  // 付与する側は上の表がそのまま一覧なので、同じリンクを二度並べずに表へ戻す。
  parts.push("          <div>");
  parts.push('            <h3 class="guide-sub">付与する側</h3>');
  parts.push('            <p><a href="#givers">' + escapeHtml(guide.name) + "を付与するキャラ"
    + (guide.givers || []).length + "体の表</a>にまとめています。</p>");
  parts.push("          </div>");
  if ((guide.users || []).length) {
    parts.push("          <div>");
    parts.push('            <h3 class="guide-sub">参照する側</h3>');
    parts.push(linkList(guide.users, characterById, skillById));
    parts.push("          </div>");
  }
  if ((guide.amplifiers || []).length) {
    parts.push("          <div>");
    parts.push('            <h3 class="guide-sub">強化する側</h3>');
    parts.push(linkList(guide.amplifiers, characterById, skillById));
    parts.push("          </div>");
  }
  return card("users", guide.name + "を利用するキャラ", parts.join("\n"));
}

function relatedCard(guide) {
  const parts = ['          <dl class="guide-defs">'];
  for (const item of guide.related || []) {
    parts.push("            <dt>" + escapeHtml(item.heading) + "</dt>");
    parts.push("            <dd>" + escapeHtml(item.body) + "</dd>");
  }
  parts.push("          </dl>");
  return card("related", guide.name + "と他の効果", parts.join("\n"));
}

/**
 * 出典。公式情報は常に出す。
 * 検証情報（ワーズさんなどの検証note）は、本文で使った箇所があるときだけ枠ごと出す。
 */
function sourcesCard(guide) {
  const sources = guide.sources || {};
  const official = sources.official || [];
  const verification = sources.verification || [];
  const parts = ['          <p class="guide-source">出典：' + escapeHtml(official.join("／")) + "</p>"];
  for (const item of verification) {
    parts.push('          <p class="guide-source">検証参考：' + escapeHtml(item.name) + "さん／"
      + '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">'
      + escapeHtml(item.title || item.url) + "</a><br>" + escapeHtml(item.name)
      + "さんが公開されている検証結果を参考にさせていただきました。</p>");
  }
  return card("sources", "出典", parts.join("\n"));
}

/**
 * ガイド1ページの外枠。従来型と article 型で中身（title・h1・カード）だけ差し替える
 * （ヘッダ・フッタ・広告枠の置き方を1か所に保つため）。
 */
function pageShell(options) {
  const lines = [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    head({
      title: options.title,
      description: options.description,
      canonical: options.canonical,
      ads: options.ads
    }),
    "</head>",
    '<body data-status-guide="' + escapeHtml(options.id) + '" data-prerendered>',
    '  <header class="page-header">',
    '    <div class="header-inner">',
    '      <a class="top-link" href="./index.html">状態異常ガイドの一覧へ</a>',
    '      <p class="eyebrow">STATUS GUIDE</p>',
    "      <h1>" + escapeHtml(options.heading) + "</h1>",
    '      <div class="guide-meta">',
    '        <span class="tag">最終横断確認 ' + escapeHtml(options.lastCrossCheck) + "</span>",
    "      </div>",
    '      <p class="guide-meta-note">' + escapeHtml(options.crossCheckNote) + "</p>",
    "    </div>",
    "  </header>",
    "",
    "  <main>",
    '    <div class="guide-list">',
    options.cards.join("\n"),
    "    </div>",
    adRenderer.renderAdSlot(options.ads, "    "),
    "  </main>",
    "",
    footer()
  ];
  // そのページだけが必要とするスクリプトを </body> 直前に出す（slides のある回だけ）。
  for (const src of options.scripts || []) {
    lines.push('  <script src="' + escapeHtml(src) + '" defer></script>');
  }
  lines.push("</body>");
  lines.push("</html>");
  lines.push("");
  return lines.join("\n");
}

function guidePageHtml(guide, characterById, skillById, ads) {
  const title = guide.name + "｜状態異常ガイド | " + TITLE_SUFFIX;
  // description は検索結果に出る1〜2行。長い本文をそのまま入れると切られるので、
  // 「何の効果か」「このページで分かること」だけに絞る。
  const description = guide.name + "の仕組み（発動タイミング・ダメージ計算・攻撃力の上限）と、"
    + "重ねたときの扱い、" + guide.name + "を付与／参照／強化するキャラのスキルを、"
    + "キャラページの該当スキルへのリンク付きで整理しています。";
  const canonical = SITE_ORIGIN + "/pages/status/" + guide.id + ".html";
  const cards = [onelineCard(guide)]
    .concat((guide.sections || []).map(sectionCard))
    .concat([
      giversCard(guide, characterById, skillById),
      usersCard(guide, characterById, skillById),
      relatedCard(guide),
      sourcesCard(guide)
    ]);

  return pageShell({
    id: guide.id,
    title,
    description,
    canonical,
    heading: guide.name + "｜状態異常ガイド",
    lastCrossCheck: guide.lastCrossCheck,
    crossCheckNote: guide.crossCheckNote,
    cards,
    ads
  });
}

function indexPageHtml(guides, ads) {
  const canonical = SITE_ORIGIN + "/pages/status/index.html";
  const items = [];
  for (const guide of guides) {
    items.push("        <li>");
    items.push('          <a class="guide-index-card" href="./' + escapeHtml(guide.id) + '.html">');
    items.push("            <strong>" + escapeHtml(guide.name) + "</strong>");
    items.push("            <span>" + escapeHtml(guide.summary) + "</span>");
    items.push("            <small>最終横断確認 " + escapeHtml(guide.lastCrossCheck) + "</small>");
    items.push("          </a>");
    items.push("        </li>");
  }

  return [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    head({ title: INDEX_TITLE, description: INDEX_DESCRIPTION, canonical, ads }),
    "</head>",
    "<body data-status-guide-index data-prerendered>",
    '  <header class="page-header">',
    '    <div class="header-inner">',
    '      <a class="top-link" href="../characters/index.html">キャラ一覧へ</a>',
    '      <p class="eyebrow">STATUS GUIDE</p>',
    "      <h1>状態異常ガイド</h1>",
    '      <p class="role">キャラページのスキル説明だけでは分かりにくい状態異常について、効果の発動タイミング・ダメージの計算・重ねたときの扱い・どのキャラが扱うのかを整理します。</p>',
    "    </div>",
    "  </header>",
    "",
    "  <main>",
    '    <div class="notice">今あるのは' + guides.length + "件です。ほかの状態異常は順番に足していきます。</div>",
    '    <ul class="guide-index">',
    items.join("\n"),
    "    </ul>",
    adRenderer.renderAdSlot(ads, "    "),
    "  </main>",
    "",
    footer(),
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

/* ------------------------------------------------------------------
 * 3-B. article 型（layout: "article"）
 *
 * 「見出し付きの節（sections）×部品（blocks）」で本文を組む型。
 * 従来型（layout なし）の出力はここから一切変えないこと。
 * 部品は p / h3 / list / callout / table / skillTable / slides の7種類だけで、
 * これ以上の汎用化はしない（型が増えるほど検査が効かなくなるため）。
 * ------------------------------------------------------------------ */

/** 枠と効果の文字列を全部集める（取りこぼし検査と数値検査の土台）。 */
function flowStrings(skill) {
  const out = [];
  for (const block of flowBlocks(skill)) {
    out.push(block.when, block.target);
    for (const item of block.exclusiveTarget || []) out.push(item.target);
  }
  for (const entry of flowEffects(skill)) {
    out.push(entry.effect.text, entry.effect.condition, entry.effect.note, entry.effect.duration);
  }
  return out.map((value) => String(value || ""));
}

/** flow のどこかにその語が出てくるスキルか（「カウンタ変更」も「カウンタ」で拾う）。 */
function mentionsTerm(skill, term) {
  return flowStrings(skill).some((text) => text.includes(term));
}

const ARTICLE_BLOCK_PAD = "          ";
const SLIDES_SCRIPT = "../../js/guide-slides.js";

/**
 * 本文の記法を1か所で処理する。
 * 先にHTMLエスケープし、そのあと {{skill}} / {{ref}} / ** だけを置き換える。
 * 読めない記法・閉じていない記法はビルドを止める（手入力の崩れを公開しないため）。
 */
function renderInline(text, ctx) {
  const source = String(text == null ? "" : text);
  let html = escapeHtml(source).replace(/\{\{([^{}]*)\}\}/g, (whole, inner) => {
    const bar = inner.indexOf("|");
    const body = bar < 0 ? inner : inner.slice(0, bar);
    const label = bar < 0 ? null : inner.slice(bar + 1);
    const parts = body.split(":");
    if (parts[0] === "skill" && parts.length === 3) return ctx.skillAnchor(parts[1], parts[2], label);
    if (parts[0] === "ref" && parts.length === 2) return ctx.refAnchor(parts[1], label);
    ctx.errors.push(ctx.where + ": 読めない記法がある（" + whole + "）");
    return "";
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  if (html.includes("{{") || html.includes("}}") || html.includes("*")) {
    ctx.errors.push(ctx.where + ": 閉じていない記法が残っている（" + source + "）");
  }
  return html;
}

/** 本文の記法を解くための道具ひとそろい。参照したスキルと出典もここに溜める。 */
function articleContext(guide, characterById, skillById, errors) {
  const where = "data/status/" + guide.id + ".json";
  const usedSkills = new Map();
  const usedRefs = new Set();
  const refByKey = new Map(((guide.sources || {}).verification || []).map((item) => [item.key, item]));

  return {
    where,
    errors,
    usedSkills,
    usedRefs,
    skillAnchor(characterId, number, label) {
      const entry = { characterId, skill: String(number) };
      const id = skillKey(entry);
      usedSkills.set(id, entry);
      const character = characterById.get(characterId);
      const skill = skillById.get(id);
      if (!character) {
        errors.push(where + ": {{skill}} の " + characterId + " がキャラ一覧に無い");
        return label === null ? escapeHtml(id) : label;
      }
      if (!skill) {
        errors.push(where + ": {{skill}} の " + id + " に対応するスキルが無い");
        return label === null ? escapeHtml(id) : label;
      }
      const slug = character.pageSlug || character.id;
      const text = label === null
        ? escapeHtml(character.name + " S" + entry.skill + " " + skill.name)
        : label;
      return '<a href="../characters/' + escapeHtml(slug) + ".html#skill-"
        + escapeHtml(entry.skill) + '">' + text + "</a>";
    },
    refAnchor(key, label) {
      usedRefs.add(key);
      const item = refByKey.get(key);
      if (!item) {
        errors.push(where + ": {{ref}} のキー " + key + " が sources.verification に無い");
        return label === null ? escapeHtml(key) : label;
      }
      const text = label === null
        ? escapeHtml(item.name + "さん「" + (item.title || item.url) + "」")
        : label;
      return '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">' + text + "</a>";
    }
  };
}

/**
 * 表。1列目は行の見出し（th）、2列目以降は data-label 付きの td。
 * 狭い画面で1行＝1まとまりに積み直すのは assets/status-guide.css 側。
 */
function articleTable(head, rows, ctx, firstCellHtml) {
  const parts = [
    ARTICLE_BLOCK_PAD + '<div class="guide-table-wrap">',
    ARTICLE_BLOCK_PAD + '  <table class="guide-table guide-table--wrap">',
    ARTICLE_BLOCK_PAD + "    <thead>",
    ARTICLE_BLOCK_PAD + "      <tr>"
  ];
  for (const name of head || []) {
    parts.push(ARTICLE_BLOCK_PAD + '        <th scope="col">' + renderInline(name, ctx) + "</th>");
  }
  parts.push(ARTICLE_BLOCK_PAD + "      </tr>");
  parts.push(ARTICLE_BLOCK_PAD + "    </thead>");
  parts.push(ARTICLE_BLOCK_PAD + "    <tbody>");
  for (const row of rows || []) {
    parts.push(ARTICLE_BLOCK_PAD + "      <tr>");
    parts.push(ARTICLE_BLOCK_PAD + '        <th scope="row">' + firstCellHtml(row) + "</th>");
    const cells = Array.isArray(row) ? row.slice(1) : row.cells || [];
    cells.forEach((value, column) => {
      const label = (head || [])[column + 1] || "";
      parts.push(ARTICLE_BLOCK_PAD + '        <td data-label="' + escapeHtml(label) + '">'
        + renderInline(value, ctx) + "</td>");
    });
    parts.push(ARTICLE_BLOCK_PAD + "      </tr>");
  }
  parts.push(ARTICLE_BLOCK_PAD + "    </tbody>");
  parts.push(ARTICLE_BLOCK_PAD + "  </table>");
  parts.push(ARTICLE_BLOCK_PAD + "</div>");
  return parts.join("\n");
}

/**
 * 図解スライド。JSが動かない環境でも1枚目が見える形で出す
 * （操作列は hidden のまま＝出さない。js/guide-slides.js が外す）。
 * width / height は原寸のまま出して読み込み前に場所を確保する（本文がずれないため）。
 */
function articleSlides(block) {
  const items = block.items || [];
  const lines = [
    ARTICLE_BLOCK_PAD + '<div class="guide-slides" data-guide-slides role="region"'
      + ' aria-roledescription="carousel" aria-label="' + escapeHtml(block.label) + '">',
    ARTICLE_BLOCK_PAD + '  <div class="guide-slides-viewport" aria-live="off">'
  ];
  items.forEach((item, index) => {
    const duration = Math.round(Number(item.duration) * 1000);
    lines.push(ARTICLE_BLOCK_PAD + '    <figure class="guide-slide' + (index === 0 ? " is-active" : "")
      + '" data-duration="' + duration + '" aria-roledescription="slide" aria-label="'
      + (index + 1) + " / " + items.length + '">');
    lines.push(ARTICLE_BLOCK_PAD + "      <picture>");
    lines.push(ARTICLE_BLOCK_PAD + '        <source type="image/webp" srcset="../../'
      + escapeHtml(item.webpSmall) + " 960w, ../../" + escapeHtml(item.webp) + " "
      + escapeHtml(item.width) + 'w" sizes="(max-width: 880px) 100vw, 880px">');
    lines.push(ARTICLE_BLOCK_PAD + '        <img src="../../' + escapeHtml(item.src)
      + '" width="' + escapeHtml(item.width) + '" height="' + escapeHtml(item.height)
      + '" alt="' + escapeHtml(item.alt) + '"'
      + (index === 0 ? "" : ' loading="lazy"') + ' decoding="async">');
    lines.push(ARTICLE_BLOCK_PAD + "      </picture>");
    lines.push(ARTICLE_BLOCK_PAD + "    </figure>");
  });
  lines.push(ARTICLE_BLOCK_PAD + "  </div>");
  lines.push(ARTICLE_BLOCK_PAD + '  <div class="guide-slides-controls" hidden>');
  lines.push(ARTICLE_BLOCK_PAD + '    <button type="button" data-slides-prev aria-label="前の図へ">‹</button>');
  lines.push(ARTICLE_BLOCK_PAD + '    <button type="button" data-slides-toggle aria-label="一時停止">❚❚</button>');
  lines.push(ARTICLE_BLOCK_PAD + '    <button type="button" data-slides-next aria-label="次の図へ">›</button>');
  lines.push(ARTICLE_BLOCK_PAD + '    <span class="guide-slides-dots">');
  items.forEach((item, index) => {
    lines.push(ARTICLE_BLOCK_PAD + '      <button type="button" data-slides-dot="' + index
      + '" aria-label="' + (index + 1) + '枚目へ"'
      + (index === 0 ? ' aria-current="true"' : "") + "></button>");
  });
  lines.push(ARTICLE_BLOCK_PAD + "    </span>");
  lines.push(ARTICLE_BLOCK_PAD + "  </div>");
  lines.push(ARTICLE_BLOCK_PAD + "</div>");
  return lines.join("\n");
}

function articleBlock(block, ctx) {
  const pad = ARTICLE_BLOCK_PAD;
  switch (block.type) {
    case "p":
      return pad + "<p>" + renderInline(block.text, ctx) + "</p>";
    case "h3":
      return pad + '<h3 class="guide-sub">' + renderInline(block.text, ctx) + "</h3>";
    case "list": {
      const parts = [pad + '<ul class="guide-bullets">'];
      for (const text of block.items || []) parts.push(pad + "  <li>" + renderInline(text, ctx) + "</li>");
      parts.push(pad + "</ul>");
      return parts.join("\n");
    }
    case "callout": {
      const parts = [
        pad + '<div class="guide-callout">',
        pad + '  <p class="guide-callout-title">' + renderInline(block.title, ctx) + "</p>"
      ];
      for (const text of block.body || []) parts.push(pad + "  <p>" + renderInline(text, ctx) + "</p>");
      parts.push(pad + "</div>");
      return parts.join("\n");
    }
    case "table":
      return articleTable(block.head, block.rows, ctx, (row) => renderInline(row[0], ctx));
    case "skillTable":
      return articleTable(block.head, block.rows, ctx, (row) => {
        const parts = String(row.skill || "").split(":");
        if (parts.length !== 2) {
          ctx.errors.push(ctx.where + ": skillTable の skill は「キャラID:番号」で書くこと（"
            + row.skill + "）");
          return escapeHtml(row.skill);
        }
        return ctx.skillAnchor(parts[0], parts[1], null);
      });
    case "slides":
      return articleSlides(block);
    default:
      ctx.errors.push(ctx.where + ": 知らない部品がある（type: " + block.type + "）");
      return "";
  }
}

function articleSectionCard(section, ctx) {
  if (!section.id || !section.heading) {
    ctx.errors.push(ctx.where + ": sections には id と heading をそろえて書くこと");
  }
  const body = (section.blocks || []).map((block) => articleBlock(block, ctx)).filter(Boolean);
  return card(section.id, section.heading, body.join("\n"));
}

/**
 * 出典（article型）。感謝文は1回だけ出す
 * （従来型は1件ごとに繰り返す書き方のまま。出力を変えないため分けてある）。
 */
function articleSourcesCard(guide) {
  const sources = guide.sources || {};
  const official = sources.official || [];
  const verification = sources.verification || [];
  const parts = [
    ARTICLE_BLOCK_PAD + '<p class="guide-source">出典：' + escapeHtml(official.join("／")) + "</p>"
  ];
  if (sources.officialNote) {
    parts.push(ARTICLE_BLOCK_PAD + '<p class="guide-source">' + escapeHtml(sources.officialNote) + "</p>");
  }
  if (verification.length) {
    const names = [...new Set(verification.map((item) => item.name))];
    parts.push(ARTICLE_BLOCK_PAD + '<p class="guide-source">検証参考：'
      + escapeHtml(names.map((name) => name + "さん").join("・"))
      + "が公開されている検証結果を参考にさせていただきました。</p>");
    parts.push(ARTICLE_BLOCK_PAD + '<ul class="guide-bullets guide-source">');
    for (const item of verification) {
      parts.push(ARTICLE_BLOCK_PAD + '  <li><a href="' + escapeHtml(item.url)
        + '" target="_blank" rel="noopener">'
        + escapeHtml(item.name + "さん「" + (item.title || item.url) + "」") + "</a>"
        + (item.note ? '<span class="guide-link-text">' + escapeHtml(item.note) + "</span>" : "")
        + "</li>");
    }
    parts.push(ARTICLE_BLOCK_PAD + "</ul>");
  }
  return card("sources", "出典", parts.join("\n"));
}

/** 取りこぼし検査。flow にその語が出てくるスキルを、本文が全部参照しているか。 */
function validateArticleMentions(guide, baseData, usedSkills, errors) {
  const where = "data/status/" + guide.id + ".json";
  const ignore = guide.ignore || [];
  for (const entry of ignore) {
    if (!entry.kind || !entry.skillId || !entry.reason) {
      errors.push(where + ": ignore には kind / skillId / reason をそろえて書くこと");
    }
    if (entry.kind && entry.kind !== "mentions") {
      errors.push(where + ": article 型の ignore の kind は mentions だけ（" + entry.kind + "）");
    }
  }
  const auto = (baseData.skills || [])
    .filter((skill) => mentionsTerm(skill, guide.term))
    .map((skill) => skill.id);
  const manual = [...usedSkills.keys()];
  const skipped = new Set(ignore.filter((item) => item.kind === "mentions").map((item) => item.skillId));

  for (const id of auto) {
    if (manual.includes(id) || skipped.has(id)) continue;
    errors.push(where + ": 「" + guide.term + "」を含むスキル " + id
      + " が本文から参照されていない。載せるか ignore に理由を書くこと");
  }
  for (const id of manual) {
    if (auto.includes(id)) continue;
    errors.push(where + ": 本文が参照している " + id + " の flow に「" + guide.term
      + "」が無い。スキルデータ側を確かめること");
  }
  for (const id of skipped) {
    if (!auto.includes(id)) errors.push(where + ": ignore の " + id + " は候補に出ていない（不要な除外）");
  }
  return { auto: auto.length, manual: manual.length, ignored: skipped.size };
}

/** 直リンクの先が実在するページ＋アンカーかどうか（従来型と同じ方法）。 */
function validateArticleLinks(guide, usedSkills, characterById, errors) {
  const where = "data/status/" + guide.id + ".json";
  const cache = new Map();
  let checked = 0;
  for (const entry of usedSkills.values()) {
    const character = characterById.get(entry.characterId);
    if (!character) continue; // 記法を解いた時点でエラーにしてある
    const slug = character.pageSlug || character.id;
    if (!cache.has(slug)) {
      const path = join(CHARACTER_PAGES_DIR, slug + ".html");
      cache.set(slug, existsSync(path) ? readFileSync(path, "utf8") : null);
    }
    const html = cache.get(slug);
    checked += 1;
    if (html === null) {
      errors.push(where + ": 直リンク先のページが無い（pages/characters/" + slug + ".html）");
      continue;
    }
    if (!html.includes('id="skill-' + entry.skill + '"')) {
      errors.push(where + ": pages/characters/" + slug + ".html に id=\"skill-" + entry.skill + "\" が無い");
    }
  }
  return checked;
}

/** 数値検査。skillTable のセルに出てくる N% が、その行のスキルの flow にあるか。 */
function validateArticleNumbers(guide, skillById, errors) {
  const where = "data/status/" + guide.id + ".json";
  let checked = 0;
  for (const section of guide.sections || []) {
    for (const block of section.blocks || []) {
      if (block.type !== "skillTable") continue;
      for (const row of block.rows || []) {
        const parts = String(row.skill || "").split(":");
        const skill = parts.length === 2 ? skillById.get(parts[0] + "-s" + parts[1]) : null;
        if (!skill) continue; // リンク検査側でエラーにしてある
        const haystack = flowStrings(skill).join(" / ");
        const found = (row.cells || []).join(" ").match(/[0-9]+(?:\.[0-9]+)?%/g) || [];
        for (const value of found) {
          checked += 1;
          if (!haystack.includes(value)) {
            errors.push(where + ": " + skill.id + " の表に書いた「" + value
              + "」がスキルデータの flow に無い");
          }
        }
      }
    }
  }
  return checked;
}

/** 出典検査。{{ref}} のキーが実在し、逆に本文で使われない出典が残っていないか。 */
function validateArticleSources(guide, usedRefs, errors) {
  const where = "data/status/" + guide.id + ".json";
  for (const item of (guide.sources || {}).verification || []) {
    if (!item.key) { errors.push(where + ": sources.verification に key が無い項目がある"); continue; }
    if (!usedRefs.has(item.key)) {
      errors.push(where + ": 本文で一度も使っていない出典がある（" + item.key + "）");
    }
  }
}

/** スライド検査。画像の置き場所・原寸・alt・表示時間をビルドで止める。 */
function validateArticleSlides(guide, errors) {
  const where = "data/status/" + guide.id + ".json";
  let checked = 0;
  for (const section of guide.sections || []) {
    for (const block of section.blocks || []) {
      if (block.type !== "slides") continue;
      if (!block.label) errors.push(where + ": slides の label が無い");
      (block.items || []).forEach((item, index) => {
        const label = where + ": スライド" + (index + 1);
        checked += 1;
        for (const key of ["webp", "webpSmall", "src"]) {
          if (!item[key]) { errors.push(label + " の " + key + " が無い"); continue; }
          if (!existsSync(join(ROOT, item[key]))) {
            errors.push(label + " の " + key + " が見つからない（" + item[key] + "）");
          }
        }
        for (const key of ["width", "height"]) {
          if (!Number.isInteger(item[key]) || item[key] <= 0) {
            errors.push(label + " の " + key + " は原寸（正の整数）で書くこと");
          }
        }
        if (!item.alt) errors.push(label + " の alt が無い");
        const duration = Number(item.duration);
        if (!(duration >= 0.5 && duration <= 10)) {
          errors.push(label + " の duration は0.5〜10（秒）で書くこと");
        }
      });
    }
  }
  return checked;
}

function hasSlides(guide) {
  return (guide.sections || []).some((section) =>
    (section.blocks || []).some((block) => block.type === "slides"));
}

/**
 * article型のガイド1件を検証して組み立てる。
 * 従来の givers / users / amplifiers の検査（validateLists・validateGiverNumbers）は
 * かけず、取りこぼし・リンク先・数値・出典・スライドの5つで代わりに固める。
 */
function buildArticle(guide, options) {
  const errors = options.errors;
  const ctx = articleContext(guide, options.characterById, options.skillById, errors);
  const cards = (guide.sections || []).map((section) => articleSectionCard(section, ctx));
  cards.push(articleSourcesCard(guide));

  if (!guide.label) errors.push(ctx.where + ": article 型には label（h1の「｜」の後ろ）が必要です");
  if (!guide.description) errors.push(ctx.where + ": article 型には description（説明文）が必要です");
  if (!guide.summary) errors.push(ctx.where + ": summary（入口ページのカード文）が必要です");

  const summary = { mentions: validateArticleMentions(guide, options.baseData, ctx.usedSkills, errors) };
  const links = validateArticleLinks(guide, ctx.usedSkills, options.characterById, errors);
  const numbers = validateArticleNumbers(guide, options.skillById, errors);
  validateArticleSources(guide, ctx.usedRefs, errors);
  const slides = validateArticleSlides(guide, errors);

  const html = pageShell({
    id: guide.id,
    title: guide.name + "｜" + guide.label + " | " + TITLE_SUFFIX,
    description: guide.description,
    canonical: SITE_ORIGIN + "/pages/status/" + guide.id + ".html",
    heading: guide.name + "｜" + guide.label,
    lastCrossCheck: guide.lastCrossCheck,
    crossCheckNote: guide.crossCheckNote,
    cards,
    ads: options.ads,
    // slides のあるページだけスクリプトを読む（無いページに増やさない）。
    scripts: hasSlides(guide) ? [SLIDES_SCRIPT] : []
  });

  return { html, summary, links, numbers, slides };
}

/* ------------------------------------------------------------------
 * 4. sitemap への追記
 * ------------------------------------------------------------------ */

/** 状態異常ガイドのURLを sitemap に足す（既にあれば触らない）。並びはキャラ一覧の前。 */
function patchSitemap(urlPaths, writeIfChanged) {
  const path = join(ROOT, "sitemap.xml");
  const normalized = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const anchor = "  <url>\n    <loc>" + SITE_ORIGIN + "/pages/characters/index.html</loc>\n  </url>\n";
  if (!normalized.includes(anchor)) {
    throw new Error("sitemap.xml の挿入位置が見つかりません: pages/characters/index.html");
  }

  const missing = urlPaths.filter((item) => !normalized.includes("<loc>" + SITE_ORIGIN + item + "</loc>"));
  if (!missing.length) return { changed: false, added: [] };

  const block = missing.map((item) => "  <url>\n    <loc>" + SITE_ORIGIN + item + "</loc>\n  </url>\n").join("");
  return { changed: writeIfChanged(path, normalized.replace(anchor, block + anchor)), added: missing };
}

/* ------------------------------------------------------------------
 * 5. 入口
 * ------------------------------------------------------------------ */

function readGuides() {
  if (!existsSync(STATUS_DATA_DIR)) return [];
  return readdirSync(STATUS_DATA_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((name) => {
      const guide = JSON.parse(readFileSync(join(STATUS_DATA_DIR, name), "utf8"));
      if (guide.id + ".json" !== name) {
        throw new Error("data/status/" + name + ": id（" + guide.id + "）とファイル名をそろえること");
      }
      return guide;
    });
}

/**
 * 状態異常ガイドを生成する。
 * writeIfChanged は呼び出し側（build-character-pages.mjs）から受け取る。
 * 改行コードの合わせ方と「中身が同じなら書かない」判定を1か所に保つため。
 */
export function buildStatusGuides(options) {
  const baseData = options.baseData;
  const terms = options.terms;
  const ads = options.ads;
  const writeIfChanged = options.writeIfChanged;

  const guides = readGuides();
  if (!guides.length) {
    return { guides: [], links: 0, numbers: 0, slides: 0, articleNumbers: 0, summary: {}, written: [], indexChanged: false, sitemap: { changed: false, added: [] } };
  }

  const characterById = new Map((baseData.characters || []).map((character) => [character.id, character]));
  const skillById = new Map((baseData.skills || []).map((skill) => [skill.id, skill]));

  const errors = [];
  const summary = {};
  const pages = [];
  let links = 0;
  let numbers = 0;
  let slides = 0;
  let articleNumbers = 0;

  for (const guide of guides) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(guide.lastCrossCheck || ""))) {
      errors.push("data/status/" + guide.id + ".json: lastCrossCheck は YYYY-MM-DD の手入力が必要です");
    }
    if (!guide.crossCheckNote) {
      errors.push("data/status/" + guide.id + ".json: crossCheckNote（確認範囲の1行説明）が必要です");
    }
    validateTermLink(guide, terms, errors);
    validateIllustration(guide, errors);

    // layout: "article" は節×部品で本文を組む型。検査も専用のものに差し替える。
    if (guide.layout === "article") {
      const built = buildArticle(guide, { baseData, characterById, skillById, ads, errors });
      summary[guide.id] = built.summary;
      links += built.links;
      slides += built.slides;
      articleNumbers += built.numbers;
      if (errors.length) continue; // 検査に引っかかったページは書かない
      validateWording("pages/status/" + guide.id + ".html", built.html, errors);
      pages.push({
        path: join(STATUS_PAGES_DIR, guide.id + ".html"),
        html: built.html,
        url: "/pages/status/" + guide.id + ".html"
      });
      continue;
    }

    summary[guide.id] = validateLists(guide, baseData, errors);
    numbers += validateGiverNumbers(guide, skillById, errors);
    links += validateLinks(guide, characterById, errors);
    if (errors.length) continue; // リンク先が怪しいままHTMLを組まない

    const html = guidePageHtml(guide, characterById, skillById, ads);
    validateWording("pages/status/" + guide.id + ".html", html, errors);
    pages.push({ path: join(STATUS_PAGES_DIR, guide.id + ".html"), html, url: "/pages/status/" + guide.id + ".html" });
  }

  const indexHtml = indexPageHtml(guides, ads);
  validateWording("pages/status/index.html", indexHtml, errors);

  if (errors.length) {
    for (const message of errors) console.error("検証NG: " + message);
    throw new Error("状態異常ガイドの検証に失敗しました（" + errors.length + "件）。上のログを確認してください。");
  }

  mkdirSync(STATUS_PAGES_DIR, { recursive: true });
  const written = [];
  for (const page of pages) if (writeIfChanged(page.path, page.html)) written.push(page.url);
  const indexChanged = writeIfChanged(join(STATUS_PAGES_DIR, "index.html"), indexHtml);
  const sitemap = patchSitemap(
    pages.map((page) => page.url).concat(["/pages/status/index.html"]),
    writeIfChanged
  );

  return { guides, links, numbers, slides, articleNumbers, summary, written, indexChanged, sitemap };
}
