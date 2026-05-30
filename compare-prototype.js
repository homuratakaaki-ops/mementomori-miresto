const state = { mode: "active", attribute: "all", search: "", selectedId: null, pinnedIds: new Set() };
const datasets = { active: [], passive: [] };
const existingCharacterPages = new Set(["potpourri", "rea"]);
const modeMeta = {
  active: { title: "アクティブスキル", subtitle: "火力・回復・追加効果を、対象や条件と一緒に比較します。", notice: "アクティブスキルは、ダメージ倍率だけでなく追加効果と対象指定が重要です。", detail: "アクティブ" },
  passive: { title: "パッシブスキル", subtitle: "自己強化、全体強化、耐久補助、初動効果などを比較します。", notice: "パッシブスキルは発動タイミング、解除可否、対象範囲を分けて確認してください。", detail: "パッシブ" }
};
const el = {
  tabs: document.querySelectorAll(".tab"), search: document.querySelector("#searchInput"), attributeFilter: document.querySelector("#attributeFilter"), tableHead: document.querySelector("#tableHead"), tableBody: document.querySelector("#tableBody"), title: document.querySelector("#tableTitle"), subtitle: document.querySelector("#tableSubtitle"), notice: document.querySelector("#modeNotice"), summaryChars: document.querySelector("#summaryChars"), summarySkills: document.querySelector("#summarySkills"), summaryRows: document.querySelector("#summaryRows"), reset: document.querySelector("#resetButton"), detailAvatar: document.querySelector("#detailAvatar"), detailMode: document.querySelector("#detailMode"), detailTitle: document.querySelector("#detailTitle"), detailMeta: document.querySelector("#detailMeta"), detailList: document.querySelector("#detailList"), detailLink: document.querySelector("#detailLink"), compareBinEmpty: document.querySelector("#compareBinEmpty"), compareBinList: document.querySelector("#compareBinList"), clearPinned: document.querySelector("#clearPinnedButton"), boardCount: document.querySelector("#boardCount"), compareBoardEmpty: document.querySelector("#compareBoardEmpty"), compareBoard: document.querySelector("#compareBoard")
};
function attrClass(attribute) { return `attr-${attribute}`; }
function getInitial(name) { return name.replace(/^\[.*?\]/, "").trim().slice(0, 1); }
function valueOrDash(value) { return value === null || value === undefined || value === "" ? "-" : value; }
function normalizeSkill(rawSkill, character) {
  return { id: rawSkill.id, characterId: rawSkill.characterId, character: character?.name ?? rawSkill.characterId, attribute: character?.attribute ?? "", weaponType: character?.weaponType ?? "", speed: character?.speed ?? null, availability: character?.availability ?? "", roleMemo: character?.roleMemo ?? "", skill: rawSkill.name, skillNumber: rawSkill.number, skillType: rawSkill.skillType, category: rawSkill.category, subtype: rawSkill.subCategory, target: rawSkill.target, multiplierText: rawSkill.multiplierText, duration: rawSkill.duration, ct: rawSkill.ct, condition: rawSkill.condition, exclusiveWeapon: rawSkill.exclusiveWeapon, memo: rawSkill.compareMemo, source: character?.pageSlug && existingCharacterPages.has(character.pageSlug) ? `./pages/characters/${character.pageSlug}.html` : rawSkill.sourceUrl || character?.sourceUrl || "#" };
}
function buildDatasets(data) {
  const charactersById = new Map(data.characters.map((character) => [character.id, character]));
  const skills = data.skills.map((skill) => normalizeSkill(skill, charactersById.get(skill.characterId)));
  datasets.active = skills.filter((skill) => skill.skillType !== "パッシブ").map((skill) => ({ ...skill, mode: "active" }));
  datasets.passive = skills.filter((skill) => skill.skillType === "パッシブ").map((skill) => ({ ...skill, mode: "passive" }));
}
async function fetchJson(path, optional = false) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    if (optional && response.status === 404) return { characters: [], skills: [] };
    throw new Error(`JSON読み込み失敗: ${response.status}`);
  }
  return response.json();
}
function mergeSkillData(baseData, overlayData) {
  const characters = new Map((baseData.characters || []).map((character) => [character.id, character]));
  const skills = new Map((baseData.skills || []).map((skill) => [skill.id, skill]));
  (overlayData.characters || []).forEach((character) => characters.set(character.id, character));
  (overlayData.skills || []).forEach((skill) => skills.set(skill.id, skill));
  return { ...baseData, characters: [...characters.values()], skills: [...skills.values()] };
}
async function loadData() {
  const baseData = await fetchJson("./data/mementomori-skills.json");
  const overlayData = await fetchJson("./data/rea-overlay.json", true);
  return mergeSkillData(baseData, overlayData);
}
function currentRows() {
  const query = state.search.trim().toLowerCase();
  let rows = [...datasets[state.mode]].filter((row) => state.attribute === "all" || row.attribute === state.attribute);
  if (query) {
    rows = rows.filter((row) => [row.character, row.skill, row.skillType, row.category, row.subtype, row.target, row.multiplierText, row.condition, row.exclusiveWeapon, row.memo].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  }
  rows.sort((a, b) => (a.character || "").localeCompare(b.character || "", "ja") || (a.skillNumber || 0) - (b.skillNumber || 0));
  return rows;
}
function renderHeader() {
  const headers = ["キャラ", "スキル", "種別", "対象", "CT", "効果", "条件・追加効果", "専用武器"];
  el.tableHead.innerHTML = `<tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>`;
}
function characterCell(row) { return `<div class="character-cell"><span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span><span>${row.character}</span></div>`; }
function renderRows(rows) {
  if (rows.length === 0) { el.tableBody.innerHTML = `<tr><td class="empty-state" colspan="8"><strong>該当するスキルがありません</strong>属性や検索条件を少し広げてください。</td></tr>`; return; }
  el.tableBody.innerHTML = rows.map((row) => {
    const selected = row.id === state.selectedId ? " class=\"selected\"" : "";
    const checked = state.pinnedIds.has(row.id) ? " checked" : "";
    return `<tr data-id="${row.id}"${selected}><td><label class="row-check"><input type="checkbox" data-pin-id="${row.id}"${checked} aria-label="${row.character} ${row.skill}を比較候補に残す">${characterCell(row)}</label></td><td><strong>${row.skill}</strong><br><span class="pill">スキル${row.skillNumber}</span></td><td><span class="pill">${valueOrDash(row.category)}</span><br>${valueOrDash(row.subtype)}</td><td class="target-cell">${valueOrDash(row.target)}</td><td>${valueOrDash(row.ct)}</td><td>${valueOrDash(row.multiplierText)}</td><td class="condition-cell">${valueOrDash(row.condition || row.duration)}</td><td class="condition-cell">${valueOrDash(row.exclusiveWeapon)}</td></tr>`;
  }).join("");
}
function findAnyRow(id) { return Object.values(datasets).flat().find((row) => row.id === id); }
function renderPinned() {
  const rows = [...state.pinnedIds].map(findAnyRow).filter(Boolean);
  el.compareBinEmpty.style.display = rows.length ? "none" : "";
  el.compareBinList.innerHTML = rows.map((row) => `<div class="compare-chip"><span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span><div><strong>${row.character}</strong><span>${row.skill}</span></div><button class="remove-chip" data-remove-pin="${row.id}" type="button" title="比較候補から外す">×</button></div>`).join("");
}
function renderBoard() {
  const rows = [...state.pinnedIds].map(findAnyRow).filter(Boolean);
  el.boardCount.textContent = `${rows.length}件`;
  el.compareBoardEmpty.style.display = rows.length ? "none" : "";
  el.compareBoard.style.display = rows.length ? "grid" : "none";
  el.compareBoard.innerHTML = rows.map((row) => `<article class="board-card"><div class="board-card-head"><span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span><div><strong>${row.character}</strong><span>${row.skill}</span></div></div><dl class="board-note"><div><dt>種別</dt><dd>${valueOrDash(row.skillType)} / ${valueOrDash(row.subtype)}</dd></div><div><dt>対象</dt><dd>${valueOrDash(row.target)}</dd></div><div><dt>効果</dt><dd>${valueOrDash(row.multiplierText)}</dd></div><div><dt>条件・追加効果</dt><dd>${valueOrDash(row.condition || row.duration)}</dd></div><div><dt>専用武器</dt><dd>${valueOrDash(row.exclusiveWeapon)}</dd></div><div><dt>比較メモ</dt><dd>${valueOrDash(row.memo)}</dd></div></dl></article>`).join("");
}
function renderDetail(row) {
  if (!row) { el.detailAvatar.textContent = "技"; el.detailAvatar.className = "avatar attr-藍"; el.detailMode.textContent = modeMeta[state.mode].detail; el.detailTitle.textContent = "スキルを選択"; el.detailMeta.textContent = "行を選ぶと、効果や条件を確認できます。"; el.detailList.innerHTML = ""; el.detailLink.href = "#"; return; }
  el.detailAvatar.textContent = getInitial(row.character);
  el.detailAvatar.className = `avatar ${attrClass(row.attribute)}`;
  el.detailMode.textContent = modeMeta[state.mode].detail;
  el.detailTitle.textContent = `${row.character} / ${row.skill}`;
  el.detailMeta.textContent = `${row.attribute}属性・${row.skillType}・${row.subtype}`;
  el.detailLink.href = row.source;
  const pairs = [["対象", row.target], ["CT", valueOrDash(row.ct)], ["効果", row.multiplierText], ["持続", row.duration], ["条件・追加効果", row.condition], ["専用武器", row.exclusiveWeapon], ["比較メモ", row.memo]];
  el.detailList.innerHTML = pairs.filter(([, value]) => value !== "" && value !== null && value !== undefined).map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join("");
}
function updateModeUi() { const meta = modeMeta[state.mode]; el.title.textContent = meta.title; el.subtitle.textContent = meta.subtitle; el.notice.textContent = meta.notice; document.querySelectorAll(".metric-only").forEach((node) => { node.style.display = "none"; }); }
function render() { updateModeUi(); const rows = currentRows(); if (!rows.some((row) => row.id === state.selectedId)) state.selectedId = rows[0]?.id ?? null; renderHeader(); renderRows(rows); el.summaryRows.textContent = rows.length; renderDetail(rows.find((row) => row.id === state.selectedId)); renderPinned(); renderBoard(); }
function bindEvents() {
  el.tabs.forEach((tab) => tab.addEventListener("click", () => { el.tabs.forEach((item) => item.classList.remove("active")); tab.classList.add("active"); state.mode = tab.dataset.mode; state.selectedId = null; render(); }));
  el.attributeFilter.addEventListener("click", (event) => { const button = event.target.closest("button"); if (!button) return; el.attributeFilter.querySelectorAll("button").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.attribute = button.dataset.value; state.selectedId = null; render(); });
  el.search.addEventListener("input", () => { state.search = el.search.value; state.selectedId = null; render(); });
  el.tableBody.addEventListener("click", (event) => { const checkbox = event.target.closest("input[data-pin-id]"); if (checkbox) { const id = checkbox.dataset.pinId; checkbox.checked ? state.pinnedIds.add(id) : state.pinnedIds.delete(id); render(); return; } const row = event.target.closest("tr"); if (!row) return; state.selectedId = row.dataset.id; render(); });
  el.compareBinList.addEventListener("click", (event) => { const button = event.target.closest("button[data-remove-pin]"); if (!button) return; state.pinnedIds.delete(button.dataset.removePin); render(); });
  el.clearPinned.addEventListener("click", () => { state.pinnedIds.clear(); render(); });
  el.reset.addEventListener("click", () => { state.attribute = "all"; state.search = ""; state.selectedId = null; el.search.value = ""; el.attributeFilter.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.value === "all")); render(); });
}
function renderLoadError(error) { el.tableHead.innerHTML = ""; el.tableBody.innerHTML = `<tr><td class="empty-state"><strong>データを読み込めませんでした</strong>${error.message}</td></tr>`; }
async function init() { bindEvents(); try { const data = await loadData(); buildDatasets(data); el.summaryChars.textContent = data.characters.length; el.summarySkills.textContent = data.skills.length; render(); } catch (error) { renderLoadError(error); console.error(error); } }
init();
