const state = {
  mode: "damage",
  attribute: "all",
  search: "",
  sort: "base",
  realities: new Set(["高", "中", "低"]),
  rankTargets: new Set(["基本", "条件込み"]),
  selectedId: null,
  pinnedIds: new Set()
};

const datasets = {
  damage: [],
  shield: [],
  control: []
};

const existingCharacterPages = new Set(["potpourri", "rea"]);

const modeMeta = {
  damage: {
    title: "火力比較",
    subtitle: "基本倍率、専用Lv別、条件MAXを分けて表示します。",
    notice: "条件MAXは理論値を含みます。実戦で安定して出る火力とは限らないため、基本火力順と分けて見てください。",
    detail: "火力比較"
  },
  shield: {
    title: "シールド比較",
    subtitle: "シールド量、対象、持続、発動条件を並べて確認します。",
    notice: "シールドは耐久値だけでなく、対象・持続・発動タイミングで価値が変わります。",
    detail: "シールド比較"
  },
  control: {
    title: "行動阻害比較",
    subtitle: "睡眠・気絶・沈黙などの対象、継続、条件を比較します。",
    notice: "行動阻害は確率、対象、解除条件で実戦性が変わります。付与率だけで判断しないでください。",
    detail: "行動阻害比較"
  }
};

const sortKey = {
  base: "base",
  lv1: "lv1",
  lv2: "lv2",
  lv3: "lv3",
  max: "max"
};

const el = {
  tabs: document.querySelectorAll(".tab"),
  search: document.querySelector("#searchInput"),
  attributeFilter: document.querySelector("#attributeFilter"),
  sort: document.querySelector("#sortSelect"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  title: document.querySelector("#tableTitle"),
  subtitle: document.querySelector("#tableSubtitle"),
  notice: document.querySelector("#modeNotice"),
  summaryChars: document.querySelector("#summaryChars"),
  summarySkills: document.querySelector("#summarySkills"),
  summaryRows: document.querySelector("#summaryRows"),
  reset: document.querySelector("#resetButton"),
  detailAvatar: document.querySelector("#detailAvatar"),
  detailMode: document.querySelector("#detailMode"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  detailList: document.querySelector("#detailList"),
  detailLink: document.querySelector("#detailLink"),
  compareBinEmpty: document.querySelector("#compareBinEmpty"),
  compareBinList: document.querySelector("#compareBinList"),
  clearPinned: document.querySelector("#clearPinnedButton"),
  boardCount: document.querySelector("#boardCount"),
  compareBoardEmpty: document.querySelector("#compareBoardEmpty"),
  compareBoard: document.querySelector("#compareBoard")
};

function attrClass(attribute) { return `attr-${attribute}`; }

function getInitial(name) { return name.replace(/^\[.*?\]/, "").trim().slice(0, 1); }

function realityClass(value) {
  if (value === "高") return "reality-high";
  if (value === "中") return "reality-mid";
  return "reality-low";
}

function formatPercent(value) { return value || value === 0 ? `${value}%` : "-"; }

function normalizeSkill(rawSkill, character) {
  return {
    id: rawSkill.id,
    characterId: rawSkill.characterId,
    character: character?.name ?? rawSkill.characterId,
    attribute: character?.attribute ?? "",
    weaponType: character?.weaponType ?? "",
    speed: character?.speed ?? null,
    availability: character?.availability ?? "",
    roleMemo: character?.roleMemo ?? "",
    skill: rawSkill.name,
    skillNumber: rawSkill.number,
    skillType: rawSkill.skillType,
    category: rawSkill.category,
    subtype: rawSkill.subCategory,
    target: rawSkill.target,
    multiplierText: rawSkill.multiplierText,
    duration: rawSkill.duration,
    ct: rawSkill.ct,
    condition: rawSkill.condition,
    exclusiveWeapon: rawSkill.exclusiveWeapon,
    memo: rawSkill.compareMemo,
    source: character?.pageSlug && existingCharacterPages.has(character.pageSlug)
      ? `./pages/characters/${character.pageSlug}.html`
      : rawSkill.sourceUrl || character?.sourceUrl || "#",
    noteUrl: rawSkill.noteUrl || character?.noteUrl || "",
    imageUrl: rawSkill.imageUrl || character?.imageUrl || "",
    damage: rawSkill.damage || null
  };
}

function buildDatasets(data) {
  const charactersById = new Map(data.characters.map((character) => [character.id, character]));
  const skills = data.skills.map((skill) => normalizeSkill(skill, charactersById.get(skill.characterId)));

  datasets.damage = skills
    .filter((skill) => skill.damage)
    .map((skill) => ({
      ...skill,
      mode: "damage",
      base: skill.damage.baseTotal,
      lv1: skill.damage.exclusiveLv1Total,
      lv2: skill.damage.exclusiveLv2Total,
      lv3: skill.damage.exclusiveLv3Total,
      max: skill.damage.conditionMaxTotal,
      conditionMax: skill.damage.conditionMaxNote,
      powerType: skill.damage.powerType,
      maxStack: skill.damage.maxStacks,
      reality: skill.damage.realityRank,
      rankTarget: skill.damage.rankingTarget,
      damageMemo: skill.damage.damageMemo
    }));

  datasets.shield = skills
    .filter((skill) => skill.category === "シールド")
    .map((skill) => ({ ...skill, mode: "shield", shield: skill.multiplierText }));

  datasets.control = skills
    .filter((skill) => skill.category === "行動阻害")
    .map((skill) => ({ ...skill, mode: "control" }));
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
  let rows = [...datasets[state.mode]];
  rows = rows.filter((row) => state.attribute === "all" || row.attribute === state.attribute);

  if (query) {
    rows = rows.filter((row) => [row.character, row.skill, row.subtype, row.target, row.condition, row.memo, row.conditionMax, row.damageMemo]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)));
  }

  if (state.mode === "damage") {
    rows = rows.filter((row) => state.realities.has(row.reality) && state.rankTargets.has(row.rankTarget));
    rows.sort((a, b) => (b[sortKey[state.sort]] || 0) - (a[sortKey[state.sort]] || 0));
  }
  return rows;
}

function renderHeader() {
  const headers = state.mode === "damage"
    ? ["順位", "キャラ", "スキル", "対象", "CT", "基本", "専用Lv3", "条件MAX", "現実性", "条件"]
    : state.mode === "shield"
      ? ["キャラ", "スキル", "種別", "対象", "量/基準", "持続", "条件"]
      : ["キャラ", "スキル", "状態異常", "対象", "継続", "CT", "条件"];
  el.tableHead.innerHTML = `<tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>`;
}

function characterCell(row) {
  return `<div class="character-cell"><span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span><span>${row.character}</span></div>`;
}

function renderRows(rows) {
  if (rows.length === 0) {
    const colSpan = state.mode === "damage" ? 10 : 7;
    el.tableBody.innerHTML = `<tr><td class="empty-state" colspan="${colSpan}"><strong>該当するスキルがありません</strong>属性や現実性、ランキング対象の条件を少し広げてください。</td></tr>`;
    return;
  }

  el.tableBody.innerHTML = rows.map((row, index) => {
    const selected = row.id === state.selectedId ? " class=\"selected\"" : "";
    const checked = state.pinnedIds.has(row.id) ? " checked" : "";
    if (state.mode === "damage") {
      return `
        <tr data-id="${row.id}"${selected}>
          <td class="number"><label class="row-check"><input type="checkbox" data-pin-id="${row.id}"${checked} aria-label="${row.character} ${row.skill}を比較候補に残す"><span>${index + 1}</span></label></td>
          <td>${characterCell(row)}</td>
          <td><strong>${row.skill}</strong><br><span class="pill">${row.subtype}</span></td>
          <td class="target-cell">${row.target}</td>
          <td>${row.ct || "-"}</td>
          <td class="number">${formatPercent(row.base)}</td>
          <td class="number">${formatPercent(row.lv3)}</td>
          <td class="number">${formatPercent(row.max)}</td>
          <td><span class="pill ${realityClass(row.reality)}">${row.reality}</span></td>
          <td class="condition-cell">${row.conditionMax}</td>
        </tr>`;
    }
    if (state.mode === "shield") {
      return `<tr data-id="${row.id}"${selected}><td>${characterCell(row)}</td><td><strong>${row.skill}</strong></td><td><span class="pill">${row.subtype}</span></td><td class="target-cell">${row.target}</td><td>${row.shield}</td><td>${row.duration}</td><td class="condition-cell">${row.condition}</td></tr>`;
    }
    return `<tr data-id="${row.id}"${selected}><td>${characterCell(row)}</td><td><strong>${row.skill}</strong></td><td><span class="pill">${row.subtype}</span></td><td class="target-cell">${row.target}</td><td>${row.duration}</td><td>${row.ct || "-"}</td><td class="condition-cell">${row.condition}</td></tr>`;
  }).join("");
}

function findAnyRow(id) { return Object.values(datasets).flat().find((row) => row.id === id); }

function renderPinned() {
  const rows = [...state.pinnedIds].map(findAnyRow).filter(Boolean);
  el.compareBinEmpty.style.display = rows.length ? "none" : "";
  el.compareBinList.innerHTML = rows.map((row) => `
    <div class="compare-chip"><span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span><div><strong>${row.character}</strong><span>${row.skill}</span></div><button class="remove-chip" data-remove-pin="${row.id}" type="button" title="比較候補から外す">×</button></div>
  `).join("");
}

function renderBoard() {
  const rows = [...state.pinnedIds].map(findAnyRow).filter(Boolean);
  el.boardCount.textContent = `${rows.length}件`;
  el.compareBoardEmpty.style.display = rows.length ? "none" : "";
  el.compareBoard.style.display = rows.length ? "grid" : "none";

  el.compareBoard.innerHTML = rows.map((row) => {
    if (row.mode !== "damage") {
      return `<article class="board-card"><div class="board-card-head"><span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span><div><strong>${row.character}</strong><span>${row.skill}</span></div></div><dl class="board-note"><div><dt>種別</dt><dd>${row.subtype}</dd></div><div><dt>対象</dt><dd>${row.target}</dd></div><div><dt>条件</dt><dd>${row.condition || "-"}</dd></div><div><dt>比較メモ</dt><dd>${row.memo}</dd></div></dl></article>`;
    }
    return `<article class="board-card"><div class="board-card-head"><span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span><div><strong>${row.character}</strong><span>${row.skill}</span></div></div><dl class="board-metrics"><div><dt>基本</dt><dd>${formatPercent(row.base)}</dd></div><div><dt>専用Lv3</dt><dd>${formatPercent(row.lv3)}</dd></div><div><dt>条件MAX</dt><dd>${formatPercent(row.max)}</dd></div></dl><dl class="board-note"><div><dt>現実性</dt><dd><span class="pill ${realityClass(row.reality)}">${row.reality}</span></dd></div><div><dt>条件メモ</dt><dd>${row.conditionMax}</dd></div><div><dt>火力メモ</dt><dd>${row.damageMemo || row.memo}</dd></div></dl></article>`;
  }).join("");
}

function renderDetail(row) {
  if (!row) {
    el.detailAvatar.textContent = "火";
    el.detailAvatar.className = "avatar attr-紅";
    el.detailMode.textContent = modeMeta[state.mode].detail;
    el.detailTitle.textContent = "スキルを選択";
    el.detailMeta.textContent = "行を選ぶと、条件や比較メモを確認できます。";
    el.detailList.innerHTML = "";
    el.detailLink.href = "#";
    return;
  }

  el.detailAvatar.textContent = getInitial(row.character);
  el.detailAvatar.className = `avatar ${attrClass(row.attribute)}`;
  el.detailMode.textContent = modeMeta[state.mode].detail;
  el.detailTitle.textContent = `${row.character} / ${row.skill}`;
  el.detailMeta.textContent = `${row.attribute}属性・${row.subtype}`;
  el.detailLink.href = row.source;

  const pairs = state.mode === "damage"
    ? [["基本", formatPercent(row.base)], ["専用Lv1", formatPercent(row.lv1)], ["専用Lv2", formatPercent(row.lv2)], ["専用Lv3", formatPercent(row.lv3)], ["条件MAX", formatPercent(row.max)], ["条件MAX前提", row.conditionMax], ["現実性", row.reality], ["ランキング対象", row.rankTarget], ["火力メモ", row.damageMemo || row.memo]]
    : state.mode === "shield"
      ? [["対象", row.target], ["量/基準", row.shield], ["持続", row.duration], ["発動条件", row.condition], ["比較メモ", row.memo]]
      : [["対象", row.target], ["継続", row.duration], ["CT", row.ct || "-"], ["発動条件", row.condition], ["比較メモ", row.memo]];

  el.detailList.innerHTML = pairs
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`)
    .join("");
}

function updateModeUi() {
  const meta = modeMeta[state.mode];
  el.title.textContent = meta.title;
  el.subtitle.textContent = meta.subtitle;
  el.notice.textContent = meta.notice;
  document.querySelectorAll(".damage-only").forEach((node) => {
    node.style.display = state.mode === "damage" ? "" : "none";
  });
}

function render() {
  updateModeUi();
  const rows = currentRows();
  if (!rows.some((row) => row.id === state.selectedId)) state.selectedId = rows[0]?.id ?? null;
  renderHeader();
  renderRows(rows);
  el.summaryRows.textContent = rows.length;
  renderDetail(rows.find((row) => row.id === state.selectedId));
  renderPinned();
  renderBoard();
}

function bindEvents() {
  el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      el.tabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      state.mode = tab.dataset.mode;
      state.selectedId = null;
      render();
    });
  });

  el.attributeFilter.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    el.attributeFilter.querySelectorAll("button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.attribute = button.dataset.value;
    state.selectedId = null;
    render();
  });

  el.search.addEventListener("input", () => { state.search = el.search.value; state.selectedId = null; render(); });
  el.sort.addEventListener("change", () => { state.sort = el.sort.value; state.selectedId = null; render(); });

  document.querySelectorAll("input[name='reality']").forEach((input) => {
    input.addEventListener("change", () => { input.checked ? state.realities.add(input.value) : state.realities.delete(input.value); state.selectedId = null; render(); });
  });

  document.querySelectorAll("input[name='rankTarget']").forEach((input) => {
    input.addEventListener("change", () => { input.checked ? state.rankTargets.add(input.value) : state.rankTargets.delete(input.value); state.selectedId = null; render(); });
  });

  el.tableBody.addEventListener("click", (event) => {
    const checkbox = event.target.closest("input[data-pin-id]");
    if (checkbox) {
      const id = checkbox.dataset.pinId;
      checkbox.checked ? state.pinnedIds.add(id) : state.pinnedIds.delete(id);
      render();
      return;
    }
    const row = event.target.closest("tr");
    if (!row) return;
    state.selectedId = row.dataset.id;
    render();
  });

  el.compareBinList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-remove-pin]");
    if (!button) return;
    state.pinnedIds.delete(button.dataset.removePin);
    render();
  });

  el.clearPinned.addEventListener("click", () => { state.pinnedIds.clear(); render(); });

  el.reset.addEventListener("click", () => {
    state.attribute = "all";
    state.search = "";
    state.sort = "base";
    state.realities = new Set(["高", "中", "低"]);
    state.rankTargets = new Set(["基本", "条件込み"]);
    state.selectedId = null;
    el.search.value = "";
    el.sort.value = "base";
    el.attributeFilter.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.value === "all"));
    document.querySelectorAll("input[name='reality']").forEach((input) => input.checked = true);
    document.querySelectorAll("input[name='rankTarget']").forEach((input) => { input.checked = input.value !== "対象外"; });
    render();
  });
}

function renderLoadError(error) {
  el.tableHead.innerHTML = "";
  el.tableBody.innerHTML = `<tr><td class="empty-state"><strong>データを読み込めませんでした</strong>${error.message}</td></tr>`;
}

async function init() {
  bindEvents();
  try {
    const data = await loadData();
    buildDatasets(data);
    el.summaryChars.textContent = data.characters.length;
    el.summarySkills.textContent = data.skills.length;
    render();
  } catch (error) {
    renderLoadError(error);
    console.error(error);
  }
}

init();
