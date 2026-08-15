(function () {
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

  async function fetchJson(path, fallback) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 404) return fallback;
      throw new Error(`JSON読み込み失敗: ${response.status}`);
    }
    return response.json();
  }

  function overlayPath(characterId) {
    return `../../data/${String(characterId).replaceAll("_", "-")}-overlay.json`;
  }

  function mergeSkillData(baseData, overlayData) {
    const characters = new Map((baseData.characters || []).map((character) => [character.id, character]));
    const skills = new Map((baseData.skills || []).map((skill) => [skill.id, skill]));
    (overlayData.characters || []).forEach((character) => characters.set(character.id, character));
    (overlayData.skills || []).forEach((skill) => skills.set(skill.id, skill));
    return { ...baseData, characters: [...characters.values()], skills: [...skills.values()] };
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

  function renderMeta(character, newsData) {
    const meta = document.querySelector("#characterMeta");
    const historyText = formatPickupHistory(mergePickupHistory(character, newsData));
    document.body.dataset.attribute = character.attribute || "";
    meta.innerHTML = [
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

  function renderSteps(skill, terms) {
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
    const base = skill.damage.baseTotal ? `通常 ${skill.damage.baseTotal}%` : "";
    const max = skill.damage.conditionMaxTotal && skill.damage.conditionMaxTotal !== skill.damage.baseTotal
      ? `最大 ${skill.damage.conditionMaxTotal}%`
      : "";
    return [base, max].filter(Boolean).join(" / ");
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

  function renderWeapon(skill) {
    if (!skill.exclusiveWeapon) return "";
    const parts = String(skill.exclusiveWeapon).split(/(?=専用Lv\d:)/).filter(Boolean);
    const rows = parts.length ? parts.map((part) => {
      const match = part.match(/^(専用Lv\d):\s*(.*)$/);
      if (!match) return `<tr><th>専用</th><td>${highlightRatios(part)}</td></tr>`;
      return `<tr><th>${escapeHtml(match[1])}</th><td>${highlightRatios(match[2])}</td></tr>`;
    }) : [`<tr><th>専用</th><td>${highlightRatios(skill.exclusiveWeapon)}</td></tr>`];
    return `<div><h3 class="block-title">専用武器</h3><table class="weapon-table">${rows.join("")}</table></div>`;
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
          ${renderDataRows(skill)}
          ${renderVerifications(skill)}
          ${renderWeapon(skill)}
        </div>
      </article>
    `;
  }

  function setText(selector, text) {
    const node = document.querySelector(selector);
    if (node) node.textContent = text || "";
  }

  async function initCharacterPage() {
    const root = document.querySelector("[data-character-page]");
    const characterId = root && root.dataset.characterId;
    if (!characterId) throw new Error("characterIdが設定されていません");

    const [baseData, overlayData, newsData, termsData] = await Promise.all([
      fetchJson("../../data/mementomori-skills.json", { characters: [], skills: [] }),
      fetchJson(overlayPath(characterId), { characters: [], skills: [] }),
      fetchJson("../../data/news.json", { items: [] }),
      fetchJson("../../data/terms.json", { terms: defaultTerms })
    ]);
    const data = mergeSkillData(baseData, overlayData);
    const character = (data.characters || []).find((item) => item.id === characterId);
    const skills = (data.skills || [])
      .filter((skill) => skill.characterId === characterId)
      .sort((a, b) => a.number - b.number);
    if (!character) throw new Error("キャラが見つかりません");

    document.title = `${character.name} | ミレストのメメントモリ分析データ室`;
    setText("#characterName", character.name);
    setText("#roleMemo", character.catchcopy || character.roleMemo || "");
    renderMeta(character, newsData);
    document.querySelector("#skillList").innerHTML = skills.map((skill) => renderSkillCard(skill, termsData.terms || defaultTerms)).join("");

    if (character.noteUrl) {
      const notePanel = document.querySelector("#notePanel");
      const noteLink = document.querySelector("#noteLink");
      notePanel.hidden = false;
      noteLink.href = character.noteUrl;
    }
  }

  window.MirestoCharacterPage = { init: initCharacterPage };
}());
