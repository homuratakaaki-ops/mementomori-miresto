/**
 * キャラページ本文の描画ロジック（共通モジュール）。
 *
 * ブラウザ: <script src="../../js/render-character.js"> で読み込むと
 *           window.MirestoRenderCharacter に公開される。
 * Node:     scripts/build-character-pages.mjs から require して
 *           公開前のHTML生成に使う。
 *
 * 描画の二重管理を避けるため、HTML文字列を組み立てる処理はすべてここに置く。
 * DOMに触る処理は js/character-page.js 側に置く。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.MirestoRenderCharacter = api;
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  const TITLE_SUFFIX = "ミレストのメメントモリ分析データ室";
  const SITE_ORIGIN = "https://memento.musoudc.com";
  const gachaKinds = new Set(["PU", "復刻", "星の導き"]);
  const defaultTerms = {};

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function valueOrDash(value) {
    return value === null || value === undefined || value === "" ? "" : value;
  }

  function highlightRatios(value) {
    return escapeHtml(value).replace(/(攻撃力×|物理|魔法)(\d+(?:\.\d+)?%)/g, "$1<span class=\"ratio\">$2</span>");
  }

  function selectSkills(data, characterId) {
    return (data.skills || [])
      .filter((skill) => skill.characterId === characterId)
      .sort((a, b) => a.number - b.number);
  }

  function formatDate(value, withYear = true) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value || "";
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return withYear ? `${year}/${month}/${day}` : `${month}/${day}`;
  }

  function isFutureDate(value) {
    if (!value) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${value}T00:00:00`);
    return !Number.isNaN(target.getTime()) && target >= today;
  }

  function mergePickupHistory(character, newsData) {
    const baseItems = (Array.isArray(character.pickupHistory) ? character.pickupHistory : [])
      .map((item) => ({ ...item, source: "pickupHistory" }));
    const newsItems = ((newsData && newsData.items) || [])
      .filter((item) => item.characterId === character.id && gachaKinds.has(item.kind))
      .map((item) => ({ ...item, source: "news" }));
    const seen = new Set();
    return [...baseItems, ...newsItems]
      .filter((item) => item.date && item.kind)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .filter((item) => {
        const key = [item.date, item.endDate || "", item.kind, item.characterId || character.id].join("|");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function formatPickupHistory(history) {
    if (!history.length) return "";
    let numberedCount = 0;
    const items = history.map((item) => {
      const period = item.endDate
        ? `${formatDate(item.date)}〜${formatDate(item.endDate, false)}`
        : formatDate(item.date);
      const status = item.endDate
        ? (isFutureDate(item.endDate) ? `（開催中〜${formatDate(item.endDate, false)}）` : "（終了）")
        : "";
      if (item.kind === "星の導き") return `星の導き ${period}${status}`;
      numberedCount += 1;
      return `${numberedCount}回目 ${period}${status}`;
    });
    return `PU履歴：${items.join(" / ")}`;
  }

  function renderMetaHtml(character, newsData) {
    const historyText = formatPickupHistory(mergePickupHistory(character, newsData));
    return [
      character.attribute ? `<span class="badge attribute">${escapeHtml(character.attribute)}</span>` : "",
      character.weaponType ? `<span class="badge">${escapeHtml(character.weaponType)}</span>` : "",
      valueOrDash(character.speed) ? `<span class="badge">スピード ${escapeHtml(character.speed)}</span>` : "",
      character.availability ? `<span class="badge">入手 ${escapeHtml(character.availability)}</span>` : "",
      historyText ? `<span class="badge">${escapeHtml(historyText)}</span>` : ""
    ].filter(Boolean).join("");
  }

  function renderTermText(step, terms) {
    const raw = step.text || "";
    if (!step.term || !terms[step.term] || !raw.includes(step.term)) {
      return highlightRatios(raw);
    }
    const [before, ...rest] = raw.split(step.term);
    const after = rest.join(step.term);
    return `${highlightRatios(before)}<details class="term"><summary>${escapeHtml(step.term)}</summary><span class="term-box">${escapeHtml(terms[step.term])}</span></details>${highlightRatios(after)}`;
  }

  const FLOW_MODE_LABEL = {
    simultaneous: "同時に発動",
    passive: "常時",
    release: "解除条件"
    // conditional は帯の「いつ」そのものが条件なのでラベルを出さない
    // sequence は order の番号そのものが順番を示すのでラベルを出さない
  };

  const CIRCLED = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

  /** 順番の番号。順番の枠が1つしかないスキルでは番号を出さない（①だけが残るのを避ける）。 */
  function flowOrderMark(block, numbered) {
    if (!numbered || block.mode !== "sequence" || !block.order) return "";
    return `${CIRCLED[block.order] || block.order} `;
  }

  /**
   * 「倍率合計 1320%（3体分）」の（N体分 / N回分）。
   * 1ヒットだけのスキルは添えない。体か回かは倍率と対象の書き方から決める。
   */
  function hitUnit(skill, block, effect) {
    const hits = skill.damage && skill.damage.hitCount;
    if (!hits || hits < 2) return "";
    if (new RegExp(`×${hits}回`).test(effect.multiplier || "")) return `（${hits}回分）`;
    if (new RegExp(`${hits}体`).test(block.target || "")) return `（${hits}体分）`;
    return `（${hits}回分）`;
  }

  /**
   * 合計火力のラベル。スキルの damage が指す攻撃の行（effects[].damageTotal）に添える。
   * 専用武器による伸びは専用武器欄に任せるので出さない。
   * 攻撃力倍率でないスキル（nonAttackMultiplier）も合計を出さない。
   */
  function flowTotalLabel(skill, block, effect) {
    const damage = skill.damage;
    if (!effect.damageTotal || !damage || damage.nonAttackMultiplier) return "";
    if (effect.damageTotal === "base") {
      return damage.baseTotal ? `倍率合計 ${damage.baseTotal}%${hitUnit(skill, block, effect)}` : "";
    }
    if (effect.damageTotal === "conditionMax") {
      return damage.conditionMaxTotal > damage.baseTotal ? `条件時：倍率合計 ${damage.conditionMaxTotal}%` : "";
    }
    return "";
  }

  /** 専用武器ぶんのラベル。色だけに頼らず「専用Lv○」の文字で見分けられるようにする。 */
  function exclusiveChip(lv) {
    return `<span class="flow-chip excl">${escapeHtml("専用Lv" + lv)}</span>`;
  }

  /**
   * 専用武器ぶんの注記。語形は「専用Lv○：〜に変更」「専用Lv○：〜を追加」の2つだけ。
   * 矢印だけの表現は使わない（置き換えなのか追加なのかが読み取れないため）。
   */
  function exclusiveNote(lv, bodyHtml, tail) {
    return `<span class="flow-excl">${exclusiveChip(lv)}<span class="flow-excl-text">${bodyHtml}${escapeHtml(tail)}</span></span>`;
  }

  function exclusiveChange(lv, bodyHtml, suffix) {
    return exclusiveNote(lv, bodyHtml, `に変更${suffix || ""}`);
  }

  /** 枠の中で damage の合計を出している攻撃の効果。枠の対象が専用で変わると合計も変わる。 */
  function baseDamageEffect(block) {
    return (block.effects || []).find((effect) => effect.damageTotal === "base");
  }

  /**
   * 専用で合計倍率が変わるときの添え書き。damage.exclusiveLv{N}Total の値をそのまま出す
   * （専用の合計表示とデータを食い違わせないため、ここでは計算しない）。
   */
  function exclusiveTotalSuffix(skill, effect, lv) {
    if (!effect || effect.damageTotal !== "base") return "";
    const damage = skill.damage;
    if (!damage || damage.nonAttackMultiplier) return "";
    const total = damage[`exclusiveLv${lv}Total`];
    if (!total || total === damage.baseTotal) return "";
    return `（倍率合計 ${total}%）`;
  }

  /** 帯の「誰に」に添える対象の変更。枠ごと対象が入れ替わる専用効果に使う。 */
  function exclusiveTargetNotes(skill, block) {
    const list = Array.isArray(block.exclusiveTarget) ? block.exclusiveTarget : [];
    return list
      .map((item) => exclusiveChange(item.lv, escapeHtml(item.target), exclusiveTotalSuffix(skill, baseDamageEffect(block), item.lv)))
      .join("");
  }

  /** 専用で増える効果の行。同じ「いつ」＋同じ「誰に」の枠の中に1行として置く。 */
  function renderExclusiveAddLine(item, terms) {
    const before = item.chance ? `<span class="flow-chip">確率${escapeHtml(item.chance)}</span>` : "";
    const after = [
      item.multiplier ? `<span class="flow-chip num">${highlightRatios(item.multiplier)}</span>` : "",
      item.duration ? `<span class="flow-chip">${escapeHtml(item.duration)}</span>` : "",
      item.note ? `<span class="flow-note">${escapeHtml(item.note)}</span>` : ""
    ].filter(Boolean).join("");
    return `<li class="flow-excl-line">${exclusiveChip(item.lv)}<span class="flow-excl-body">${before}${renderTermText(item, terms)}${after}</span><span class="flow-excl-tail">を追加</span></li>`;
  }

  /** 効果の倍率・継続・確率・効果量が専用で置き換わるときの注記。 */
  function exclusiveChangeNotes(skill, effect, kind) {
    return (effect.exclusive || [])
      .filter((item) => item.kind !== "add")
      .filter((item) => (kind === "multiplier" ? Boolean(item.multiplier) : !item.multiplier))
      .map((item) => {
        if (item.multiplier) return exclusiveChange(item.lv, highlightRatios(item.multiplier), exclusiveTotalSuffix(skill, effect, item.lv));
        if (item.duration) return exclusiveChange(item.lv, `継続が${escapeHtml(item.duration)}`);
        if (item.chance) return exclusiveChange(item.lv, `確率が${escapeHtml(item.chance)}`);
        return exclusiveChange(item.lv, highlightRatios(item.text || ""));
      })
      .join("");
  }

  /**
   * flow の1効果。条件・確率は効果の前、倍率・合計・継続・補足は効果の後ろに添える。
   * 倍率チップがある効果も「何をするのか」の本文を残す。
   * 条件付きの行は背景を変えて、常時起きる行と見分けられるようにする。
   */
  function renderFlowEffect(skill, block, effect, terms) {
    const before = [
      effect.condition ? `<span class="flow-chip cond">${highlightRatios(effect.condition)}</span>` : "",
      effect.chance ? `<span class="flow-chip">確率${escapeHtml(effect.chance)}</span>` : ""
    ].filter(Boolean).join("");
    const total = flowTotalLabel(skill, block, effect);
    const after = [
      effect.multiplier ? `<span class="flow-chip num">${highlightRatios(effect.multiplier)}</span>` : "",
      total ? `<span class="flow-total">${escapeHtml(total)}</span>` : "",
      exclusiveChangeNotes(skill, effect, "multiplier"),
      effect.duration ? `<span class="flow-chip">${escapeHtml(effect.duration)}</span>` : "",
      effect.note ? `<span class="flow-note">${escapeHtml(effect.note)}</span>` : "",
      exclusiveChangeNotes(skill, effect, "other")
    ].filter(Boolean).join("");
    const line = `<li${effect.condition ? " class=\"flow-cond-line\"" : ""}>${before}${renderTermText(effect, terms)}${after}</li>`;
    const adds = (effect.exclusive || [])
      .filter((item) => item.kind === "add")
      .map((item) => renderExclusiveAddLine(item, terms))
      .join("");
    return `${line}${adds}`;
  }

  /**
   * 1枠。帯の見出しに「いつ」と「誰に」を並べて出す（対象は毎枠出す）。
   * 効果が1つだけの枠では「同時に発動」ラベルを出さない。
   */
  function renderFlowBlock(skill, block, terms, numbered) {
    const effects = block.effects || [];
    const mode = block.mode === "simultaneous" && effects.length < 2 ? "" : (FLOW_MODE_LABEL[block.mode] || "");
    // 専用武器でしか起きない枠。帯に「専用Lv○」を出し、枠ごと追加であることを明示する。
    const exclusiveLv = block.exclusiveLv;
    const label = exclusiveLv
      ? `${exclusiveChip(exclusiveLv)}この枠ごと追加`
      : (mode ? escapeHtml(mode) : "");
    return `
          <li class="flow-block${exclusiveLv ? " flow-block-excl" : ""}">
            <p class="flow-when"><span class="flow-when-head"><span class="flow-when-text">${escapeHtml(flowOrderMark(block, numbered))}${escapeHtml(block.when)}</span><span class="flow-when-target"><span class="flow-when-sep">｜</span>${escapeHtml(block.target)}${exclusiveTargetNotes(skill, block)}</span></span>${label ? `<span class="flow-mode">${label}</span>` : ""}</p>
            <div class="flow-row"><span class="flow-label">効果</span><ul class="flow-effects">${effects.map((effect) => renderFlowEffect(skill, block, effect, terms)).join("")}</ul></div>
          </li>
        `;
  }

  /** 「いつ・誰に・何が起きる？」。flow を持つスキルだけ表示し、steps の代わりになる。 */
  function renderFlow(skill, terms) {
    if (!Array.isArray(skill.flow) || skill.flow.length === 0) return "";
    const dict = terms || defaultTerms;
    const numbered = skill.flow.filter((block) => block.mode === "sequence").length > 1;
    const blocks = skill.flow.map((block) => renderFlowBlock(skill, block, dict, numbered)).join("");
    return `
        <div>
          <h3 class="block-title">いつ・誰に・何が起きる？</h3>
          <ol class="flow">${blocks}</ol>
        </div>
      `;
  }

  function hasFlow(skill) {
    return Array.isArray(skill.flow) && skill.flow.length > 0;
  }

  function renderSteps(skill, terms) {
    // flow があるスキルは「いつ・誰に・何が起きる？」に置き換える（steps のデータは保持する）
    if (Array.isArray(skill.flow) && skill.flow.length > 0) return renderFlow(skill, terms);
    if (Array.isArray(skill.steps) && skill.steps.length > 0) {
      return `
        <div>
          <h3 class="block-title">順番に何が起きる？</h3>
          <ol class="steps">
            ${skill.steps.map((step) => `<li>${renderTermText(step, terms)}</li>`).join("")}
          </ol>
        </div>
      `;
    }
    if (!skill.condition) return "";
    return `<div><h3 class="block-title">効果条件</h3><div class="fallback-condition">${highlightRatios(skill.condition)}</div></div>`;
  }

  function totalDamageText(skill) {
    if (!skill.damage) return "";
    // damage の数値が攻撃力倍率でないスキル（魔力・腕力・消費HP・被ダメージ参照など）は、
    // 合計値だけを出すと基準が伝わらないため multiplierText 側にフォールバックさせる。
    if (skill.damage.nonAttackMultiplier) return "";
    const base = skill.damage.baseTotal ? `通常 ${skill.damage.baseTotal}%` : "";
    const max = skill.damage.conditionMaxTotal && skill.damage.conditionMaxTotal !== skill.damage.baseTotal
      ? `最大 ${skill.damage.conditionMaxTotal}%`
      : "";
    return [base, max].filter(Boolean).join(" / ");
  }

  /**
   * スキル説明。スキルカードの最後に折りたたんで置く（初期は閉じた状態）。
   * 中身はデータの condition（出典の効果説明を比較用に要約したもの）で、
   * 公式テキストの全文転載は行わない。照合先の出典ページへのリンクを添える。
   */
  function renderOriginalText(skill) {
    if (!skill.condition) return "";
    const source = skill.sourceUrl
      ? `<p class="original-text-source"><a href="${escapeHtml(skill.sourceUrl)}" target="_blank" rel="noopener">照合した出典ページを開く</a></p>`
      : "";
    return `
        <details class="original-text">
          <summary>スキル説明</summary>
          <div class="original-text-body">
            <p class="original-text-main">${highlightRatios(skill.condition)}</p>
            <p class="original-text-note">出典の効果説明を比較用に要約したものです（全文転載ではありません）。数値は専用武器なし・スキルLv最大の値です。</p>
            ${source}
          </div>
        </details>
      `;
  }

  function renderDataRows(skill) {
    const rows = [
      skill.target ? `<dl class="data-item"><dt>対象</dt><dd>${escapeHtml(skill.target)}</dd></dl>` : "",
      (totalDamageText(skill) || skill.multiplierText) ? `<dl class="data-item"><dt>倍率・火力</dt><dd>${highlightRatios(totalDamageText(skill) || skill.multiplierText)}</dd></dl>` : "",
      valueOrDash(skill.duration) ? `<dl class="data-item"><dt>継続</dt><dd>${escapeHtml(skill.duration)}</dd></dl>` : "",
      Array.isArray(skill.verifications) && skill.verifications.some((item) => item.sourceUrl)
        ? `<dl class="data-item"><dt>検証情報</dt><dd>${skill.verifications.filter((item) => item.sourceUrl).length}件</dd></dl>`
        : ""
    ].filter(Boolean);
    return rows.length ? `<div class="data-grid">${rows.join("")}</div>` : "";
  }

  function renderVerifications(skill) {
    if (!Array.isArray(skill.verifications) || skill.verifications.length === 0) return "";
    const items = skill.verifications
      .filter((item) => item.sourceUrl)
      .map((item) => `
        <li>
          ${escapeHtml(item.text)}
          <br><a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(item.sourceLabel || "出典")}</a>
        </li>
      `);
    return items.length ? `<div><h3 class="block-title">検証情報</h3><ul class="verification-list">${items.join("")}</ul></div>` : "";
  }

  function renderSynergyNotes(skill) {
    if (!Array.isArray(skill.synergyNotes) || skill.synergyNotes.length === 0) return "";
    const items = skill.synergyNotes
      .filter((item) => item && item.text)
      .map((item) => `
        <li>
          ${escapeHtml(item.text)}
          ${item.reason ? `<br><span class="reason">根拠: ${escapeHtml(item.reason)}</span>` : ""}
        </li>
      `);
    return items.length ? `<div><h3 class="block-title">かみ合わせ</h3><ul class="verification-list synergy-list">${items.join("")}</ul></div>` : "";
  }

  // 「専用武器効果なし」だけの枠は情報が無いので出さない（表示ルール6）。
  const WEAPON_NONE_PATTERN = /^(?:専用武器効果なし|専用武器での直接強化なし|専用武器による強化なし|専用武器での強化なし|専用効果なし)$/;

  /**
   * 専用武器欄に残す行。flow に統合できた専用Lvは重複表示しないので除く（表示ルール6）。
   * 一部だけ統合できた専用Lvは exclusiveRest に残りの文章を書いて差し替える。
   */
  function weaponRows(skill) {
    const raw = String(skill.exclusiveWeapon || "").trim();
    if (!raw || WEAPON_NONE_PATTERN.test(raw)) return [];
    const integrated = new Set((skill.exclusiveIntegrated || []).map(Number));
    const rest = skill.exclusiveRest || {};
    const parts = raw.split(/(?=専用Lv\d:)/).filter(Boolean);
    if (!parts.length) return [{ head: "専用", body: raw }];
    const rows = [];
    for (const part of parts) {
      const match = part.match(/^(専用Lv(\d)):\s*([\s\S]*)$/);
      if (!match) {
        rows.push({ head: "専用", body: part });
        continue;
      }
      const lv = Number(match[2]);
      if (Object.prototype.hasOwnProperty.call(rest, String(lv))) {
        rows.push({ head: match[1], body: rest[String(lv)] });
        continue;
      }
      if (integrated.has(lv)) continue;
      rows.push({ head: match[1], body: match[3] });
    }
    return rows;
  }

  function renderWeapon(skill) {
    const rows = weaponRows(skill);
    if (!rows.length) return "";
    const html = rows
      .map((row) => `<tr><th>${escapeHtml(row.head)}</th><td>${highlightRatios(row.body)}</td></tr>`)
      .join("");
    return `<div><h3 class="block-title">専用武器</h3><table class="weapon-table">${html}</table></div>`;
  }

  function renderSkillCard(skill, terms) {
    const ct = skill.ct === null || skill.ct === undefined ? "" : skill.ct;
    return `
      <article class="skill-card">
        <header class="skill-head">
          <div class="tag-row">
            <span class="tag">S${escapeHtml(skill.number)}</span>
            ${skill.skillType ? `<span class="tag">${escapeHtml(skill.skillType)}</span>` : ""}
            ${(skill.majorCategory || skill.category) ? `<span class="tag major">${escapeHtml(skill.majorCategory || skill.category)}</span>` : ""}
            ${ct !== "" ? `<span class="tag">CT ${escapeHtml(ct)}</span>` : ""}
          </div>
          <h2>${escapeHtml(skill.name)}</h2>
          ${skill.plainSummary ? `<p class="summary">${escapeHtml(skill.plainSummary)}</p>` : ""}
        </header>
        <div class="skill-body">
          ${renderSteps(skill, terms)}
          ${hasFlow(skill) ? "" : renderDataRows(skill)}
          ${renderSynergyNotes(skill)}
          ${renderVerifications(skill)}
          ${renderWeapon(skill)}
          ${renderOriginalText(skill)}
        </div>
      </article>
    `;
  }

  function renderSkillList(skills, terms) {
    return skills.map((skill) => renderSkillCard(skill, terms || defaultTerms)).join("");
  }

  function roleMemoText(character) {
    return character.catchcopy || character.roleMemo || "";
  }

  function pageTitle(character) {
    return `${character.name} | ${TITLE_SUFFIX}`;
  }

  function canonicalUrl(character) {
    return `${SITE_ORIGIN}/pages/characters/${character.pageSlug || character.id}.html`;
  }

  /** ページごとに内容の違う meta description を組み立てる。 */
  function pageDescription(character, skills) {
    const traits = [
      character.attribute ? `${character.attribute}属性` : "",
      character.weaponType || ""
    ].filter(Boolean).join("・");
    const subject = traits ? `${character.name}(${traits})` : character.name;
    const named = skills.slice(0, 2).map((skill) => `S${skill.number} ${skill.name}`).join("、");
    const tail = named ? `${named}${skills.length > 2 ? "ほか" : ""}。` : "";
    return `${subject}のスキル${skills.length}種を効果の順番・対象・倍率で分解。${tail}`;
  }

  return {
    TITLE_SUFFIX,
    SITE_ORIGIN,
    defaultTerms,
    escapeHtml,
    valueOrDash,
    highlightRatios,
    selectSkills,
    formatDate,
    isFutureDate,
    mergePickupHistory,
    formatPickupHistory,
    renderMetaHtml,
    renderTermText,
    renderFlow,
    renderOriginalText,
    renderSteps,
    totalDamageText,
    renderDataRows,
    renderVerifications,
    renderSynergyNotes,
    weaponRows,
    renderWeapon,
    renderSkillCard,
    renderSkillList,
    roleMemoText,
    pageTitle,
    canonicalUrl,
    pageDescription
  };
}));
