const state = {
  mode: "active",
  attribute: "all",
  search: "",
  sort: "base",
  reality: new Set(["高", "中", "低"]),
  rankTarget: new Set(["基本", "条件込み"]),
  selectedId: null,
  pinnedIds: new Set()
};

const datasets = {
  active: [],
  passive: []
};

const existingCharacterPages = new Set(["potpourri", "rea", "sophia", "veela", "sivi", "cerberus", "aa_dark", "cattleya", "claudia", "yuni", "alexandra", "mira", "soltina", "amleth", "fenrir", "florence", "moddey", "sonya", "stella", "fenny", "tropon_holy_night", "giluial", "liselotte", "eir", "ivy", "minasumari", "nina", "nina_summer", "serruria", "eureka", "cordie", "cordie_ringmaster", "merlyn_winter", "merlin", "evelyn", "fia", "fia_trace", "sabrina", "sabrina_cool_breeze", "freycia", "amour", "lean", "chiffon", "artie", "belle", "dian", "cordie_summer", "priscilla", "matilda", "aishe", "lilicotte", "morgana", "soltina_warm_memory", "artoria", "shizu_snow", "lucile", "flack", "liebe", "mertillier", "luke"]);

const modeMeta = {
  active: {
    title: "アクティブスキル",
    subtitle: "火力・回復・追加効果を、対象や条件と一緒に比較します。",
    notice: "火力目安はスキルLv最大（240レベル到達時）前提です。倍率だけでなく追加効果と対象指定も確認してください。",
    detail: "アクティブ"
  },
  passive: {
    title: "パッシブスキル",
    subtitle: "自己強化、全体強化、耐久補助、初動効果などを比較します。",
    notice: "パッシブスキルは発動タイミング、解除可否、対象範囲を分けて確認してください。",
    detail: "パッシブ"
  }
};

const el = {
  tabs: document.querySelectorAll(".tab"),
  search: document.querySelector("#searchInput"),
  attributeFilter: document.querySelector("#attributeFilter"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  title: document.querySelector("#tableTitle"),
  subtitle: document.querySelector("#tableSubtitle"),
  notice: document.querySelector("#modeNotice"),
  summaryChars: document.querySelector("#summaryChars"),
  summarySkills: document.querySelector("#summarySkills"),
  summaryRows: document.querySelector("#summaryRows"),
  resetButtons: document.querySelectorAll("[data-reset-filters]"),
  sort: document.querySelector("#sortSelect"),
  realityFilters: document.querySelectorAll("input[name=\"reality\"]"),
  rankTargetFilters: document.querySelectorAll("input[name=\"rankTarget\"]"),
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

function attrClass(attribute) {
  return `attr-${attribute}`;
}

function getInitial(name) {
  return name.replace(/^\[.*?\]/, "").trim().slice(0, 1);
}

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function normalizeTurnText(value) {
  return typeof value === "string" ? value.replace(/(\d+)T/g, "$1ターン") : value;
}

function isWeaponPassiveMemo(value) {
  if (typeof value !== "string") return false;
  return /(?:魔力|腕力|技力|攻撃力|HP|クリティカル|弱体効果耐性|防御貫通|物魔防御貫通)\+\d+%/.test(value);
}

function summarizeEffectTags(row) {
  const text = [
    row.multiplierText,
    row.duration,
    row.condition,
    row.exclusiveWeapon
  ].filter(Boolean).join(" ");

  const tagRules = [
    ["HP回復", "HP回復"],
    ["再生", "再生"],
    ["シールド", "シールド"],
    ["ステルス", "ステルス"],
    ["被ダメージ増加", "被ダメ増"],
    ["被ダメージ減少", "被ダメ減"],
    ["魔法防御力減少", "魔防減"],
    ["物理防御力減少", "物防減"],
    ["防御力減少", "防御減"],
    ["回避率減少", "回避減"],
    ["命中率減少", "命中減"],
    ["攻撃力増加", "攻撃増"],
    ["攻撃力減少", "攻撃減"],
    ["クリティカル率増加", "クリ率増"],
    ["クリティカル率減少", "クリ率減"],
    ["最大HP増加", "最大HP増"],
    ["HPドレイン増加", "HPドレイン増"],
    ["直接攻撃", "直接攻撃"],
    ["気絶", "気絶"],
    ["沈黙", "沈黙"],
    ["遅延", "遅延"],
    ["脱力", "脱力"],
    ["毒", "毒"],
    ["浸食", "浸食"],
    ["バフ無効", "バフ無効"],
    ["解除不可", "解除不可"],
    ["必ず命中", "必中"],
    ["再発動", "再発動"],
    ["スキルCT", "CT操作"]
  ];

  const tags = tagRules
    .filter(([keyword]) => text.includes(keyword))
    .map(([, label]) => label);
  return tags.length ? tags.join(" / ") : "追加効果";
}

function displaySubtype(row) {
  if (String(row.subtype || "").includes("画像記載効果")) {
    return summarizeEffectTags(row);
  }
  return row.subtype;
}

function displayValue(value) {
  return valueOrDash(normalizeTurnText(value));
}

function normalizeRankingTarget(value) {
  return value === "対象" ? "基本" : value;
}

function getDamageValue(row, key = state.sort) {
  if (!row.damage) return null;
  const damageKeyMap = {
    base: "baseTotal",
    lv1: "exclusiveLv1Total",
    lv2: "exclusiveLv2Total",
    lv3: "exclusiveLv3Total",
    max: "conditionMaxTotal"
  };
  const value = row.damage[damageKeyMap[key] || "baseTotal"];
  return Number.isFinite(value) ? value : null;
}

function formatSelectedDamage(row) {
  const value = getDamageValue(row);
  return Number.isFinite(value) ? `${value}%` : "-";
}

function formatDamageStages(row) {
  if (!row.damage || row.mode !== "active") return "";

  const stages = [
    { label: "専用なし", value: row.damage.baseTotal },
    { label: "Lv1", value: row.damage.exclusiveLv1Total },
    { label: "Lv2", value: row.damage.exclusiveLv2Total },
    { label: "Lv3", value: row.damage.exclusiveLv3Total }
  ].filter((stage) => Number.isFinite(stage.value));

  if (!stages.length) return "";

  const grouped = [];
  stages.forEach((stage) => {
    const last = grouped[grouped.length - 1];
    if (last && last.value === stage.value) {
      last.labels.push(stage.label);
    } else {
      grouped.push({ labels: [stage.label], value: stage.value });
    }
  });

  const parts = grouped.map((group) => {
    const label = group.labels.length === 1
      ? group.labels[0]
      : `${group.labels[0]}-${group.labels[group.labels.length - 1]}`;
    return `${label}: ${group.value}%`;
  });

  if (Number.isFinite(row.damage.conditionMaxTotal) && row.damage.conditionMaxTotal > Math.max(...stages.map((stage) => stage.value))) {
    parts.push(`理論値: ${row.damage.conditionMaxTotal}%`);
  }

  return parts.join(" / ");
}

function renderDefinitionPairs(pairs) {
  return pairs
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([key, value]) => `<div><dt>${key}</dt><dd>${displayValue(value)}</dd></div>`)
    .join("");
}

function normalizeSkill(rawSkill, character) {
  const weaponPassive = rawSkill.weaponPassive || (isWeaponPassiveMemo(rawSkill.compareMemo) ? rawSkill.compareMemo : "");
  const compareMemo = isWeaponPassiveMemo(rawSkill.compareMemo) ? "" : rawSkill.compareMemo;
  let damage = rawSkill.damage ? { ...rawSkill.damage } : null;

  if (rawSkill.id === "stella_holy_dark_star-s1" && damage) {
    damage.exclusiveLv1Total = 3600;
    damage.exclusiveLv2Total = 3600;
    damage.exclusiveLv3Total = 3600;
    damage.conditionMaxTotal = Math.max(damage.conditionMaxTotal || 0, 3600);
    damage.conditionMaxNote = damage.conditionMaxNote || "専用Lv1以降で魔法720%×5体";
  }

  if (rawSkill.id === "stella_holy_dark_star-s2" && damage) {
    damage.exclusiveLv3Total = 3120;
    damage.conditionMaxTotal = Math.max(damage.conditionMaxTotal || 0, 3120);
    damage.conditionMaxNote = damage.conditionMaxNote || "専用Lv3で魔法780%×4回";
  }

  if (rawSkill.id === "luke-s2" && !damage) {
    damage = {
      singleMultiplier: 520,
      hitCount: 1,
      baseTotal: 520,
      exclusiveLv1Total: 520,
      exclusiveLv2Total: 520,
      exclusiveLv3Total: 520,
      conditionMaxTotal: 780,
      conditionMaxNote: "対象がシールドなしなら直接攻撃ダメージ1.5倍",
      powerType: "直接攻撃",
      maxStacks: null,
      realityRank: "中",
      rankingTarget: "条件込み",
      damageMemo: "腕力参照の直接攻撃。通常の物理/魔法倍率とは別枠"
    };
  }

  if (damage) {
    damage.realityRank = damage.realityRank || "中";
    damage.rankingTarget = normalizeRankingTarget(damage.rankingTarget || "条件込み");
  }

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
    memo: compareMemo,
    weaponPassive,
    source: character?.pageSlug && existingCharacterPages.has(character.pageSlug)
      ? `./pages/characters/${character.pageSlug}.html`
      : rawSkill.sourceUrl || character?.sourceUrl || "#",
    noteUrl: rawSkill.noteUrl || character?.noteUrl || "",
    imageUrl: rawSkill.imageUrl || character?.imageUrl || "",
    damage
  };
}

function skillMode(skill) {
  return skill.skillType === "パッシブ" ? "passive" : "active";
}

function buildDatasets(data) {
  const charactersById = new Map(data.characters.map((character) => [character.id, character]));
  const skills = data.skills.map((skill) => normalizeSkill(skill, charactersById.get(skill.characterId)));

  datasets.active = skills
    .filter((skill) => skillMode(skill) === "active")
    .map((skill) => ({ ...skill, mode: "active" }));

  datasets.passive = skills
    .filter((skill) => skillMode(skill) === "passive")
    .map((skill) => ({ ...skill, mode: "passive" }));
}

async function fetchJson(path, optional = false) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    if (optional && response.status === 404) {
      return { characters: [], skills: [] };
    }
    throw new Error(`JSON読み込み失敗: ${response.status}`);
  }
  return response.json();
}

function mergeSkillData(baseData, overlayData) {
  const characters = new Map((baseData.characters || []).map((character) => [character.id, character]));
  const skills = new Map((baseData.skills || []).map((skill) => [skill.id, skill]));

  (overlayData.characters || []).forEach((character) => characters.set(character.id, character));
  (overlayData.skills || []).forEach((skill) => skills.set(skill.id, skill));

  return {
    ...baseData,
    characters: [...characters.values()],
    skills: [...skills.values()]
  };
}

async function loadData() {
  const baseData = await fetchJson("./data/mementomori-skills.json");
  const overlays = await Promise.all([
    fetchJson("./data/rea-overlay.json", true),
    fetchJson("./data/sophia-overlay.json", true),
    fetchJson("./data/veela-overlay.json", true),
    fetchJson("./data/sivi-overlay.json", true),
    fetchJson("./data/cerberus-overlay.json", true),
    fetchJson("./data/aa-dark-overlay.json", true),
    fetchJson("./data/cattleya-overlay.json", true),
    fetchJson("./data/soltina-overlay.json", true),
    fetchJson("./data/amleth-overlay.json", true),
    fetchJson("./data/fenrir-overlay.json", true),
    fetchJson("./data/florence-overlay.json", true),
    fetchJson("./data/moddey-overlay.json", true),
    fetchJson("./data/sonya-overlay.json", true),
    fetchJson("./data/stella-overlay.json", true),
    fetchJson("./data/fenny-overlay.json", true),
    fetchJson("./data/tropon-holy-night-overlay.json", true),
    fetchJson("./data/giluial-overlay.json", true),
    fetchJson("./data/liselotte-overlay.json", true),
    fetchJson("./data/eir-overlay.json", true),
    fetchJson("./data/minasumari-overlay.json", true),
    fetchJson("./data/nina-overlay.json", true),
    fetchJson("./data/nina-summer-overlay.json", true),
    fetchJson("./data/serruria-overlay.json", true),
    fetchJson("./data/eureka-overlay.json", true),
    fetchJson("./data/cordie-overlay.json", true),
    fetchJson("./data/cordie-ringmaster-overlay.json", true),
    fetchJson("./data/merlyn-winter-overlay.json", true),
    fetchJson("./data/merlin-overlay.json", true),
    fetchJson("./data/evelyn-overlay.json", true),
    fetchJson("./data/fia-overlay.json", true),
    fetchJson("./data/claudia-overlay.json", true),
    fetchJson("./data/yuni-overlay.json", true),
    fetchJson("./data/alexandra-overlay.json", true),
    fetchJson("./data/mira-overlay.json", true),
    fetchJson("./data/fia-trace-overlay.json", true),
    fetchJson("./data/sabrina-overlay.json", true),
    fetchJson("./data/sabrina-cool-breeze-overlay.json", true),
    fetchJson("./data/freycia-overlay.json", true),
    fetchJson("./data/amour-overlay.json", true),
    fetchJson("./data/lean-overlay.json", true),
    fetchJson("./data/chiffon-overlay.json", true),
    fetchJson("./data/artie-overlay.json", true),
    fetchJson("./data/belle-overlay.json", true),
    fetchJson("./data/dian-overlay.json", true),
    fetchJson("./data/cordie-summer-overlay.json", true),
    fetchJson("./data/priscilla-overlay.json", true),
    fetchJson("./data/matilda-overlay.json", true),
    fetchJson("./data/aishe-overlay.json", true),
    fetchJson("./data/lilicotte-overlay.json", true),
    fetchJson("./data/ivy-overlay.json", true),
    fetchJson("./data/morgana-overlay.json", true),
    fetchJson("./data/soltina-warm-memory-overlay.json", true),
    fetchJson("./data/artoria-overlay.json", true),
    fetchJson("./data/shizu-snow-overlay.json", true),
    fetchJson("./data/lucile-overlay.json", true),
    fetchJson("./data/flack-overlay.json", true),
    fetchJson("./data/liebe-overlay.json", true),
    fetchJson("./data/mertillier-overlay.json", true),
    fetchJson("./data/luke-overlay.json", true)
  ]);
  return overlays.reduce((data, overlayData) => mergeSkillData(data, overlayData), baseData);
}

function currentRows() {
  const query = state.search.trim().toLowerCase();
  let rows = [...datasets[state.mode]];

  rows = rows.filter((row) => state.attribute === "all" || row.attribute === state.attribute);

  if (state.mode === "active") {
    rows = rows.filter((row) => {
      const realityRank = row.damage?.realityRank || "中";
      const rankingTarget = normalizeRankingTarget(row.damage?.rankingTarget || "条件込み");
      return state.reality.has(realityRank) && state.rankTarget.has(rankingTarget);
    });
  }

  if (query) {
    rows = rows.filter((row) => [
      row.character,
      row.skill,
      row.skillType,
      row.category,
      row.subtype,
      row.target,
      row.multiplierText,
      row.condition,
      row.exclusiveWeapon,
      row.memo,
      row.weaponPassive
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)));
  }

  rows.sort((a, b) => {
    if (state.mode === "active") {
      const damageDiff = (getDamageValue(b) ?? -1) - (getDamageValue(a) ?? -1);
      if (damageDiff !== 0) return damageDiff;
    }
    if ((a.character || "") !== (b.character || "")) {
      return (a.character || "").localeCompare(b.character || "", "ja");
    }
    return (a.skillNumber || 0) - (b.skillNumber || 0);
  });

  return rows;
}

function renderHeader() {
  const headers = state.mode === "active"
    ? ["キャラ", "スキル", "種別", "対象", "CT", "効果", "火力", "条件・追加効果", "専用武器"]
    : ["キャラ", "スキル", "種別", "対象", "CT", "効果", "条件・追加効果", "専用武器"];
  el.tableHead.innerHTML = `<tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>`;
}

function characterCell(row) {
  return `
    <div class="character-cell">
      <span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span>
      <span>${row.character}</span>
    </div>
  `;
}

function renderRows(rows) {
  if (rows.length === 0) {
    const colspan = state.mode === "active" ? 9 : 8;
    el.tableBody.innerHTML = `
      <tr>
        <td class="empty-state" colspan="${colspan}">
          <strong>該当するスキルがありません</strong>
          属性や検索条件を少し広げてください。
        </td>
      </tr>
    `;
    return;
  }

  el.tableBody.innerHTML = rows.map((row) => {
    const selected = row.id === state.selectedId ? " class=\"selected\"" : "";
    const checked = state.pinnedIds.has(row.id) ? " checked" : "";
    const damageCell = state.mode === "active" ? `<td class="number">${formatSelectedDamage(row)}</td>` : "";
    return `
      <tr data-id="${row.id}"${selected}>
        <td>
          <label class="row-check">
            <input type="checkbox" data-pin-id="${row.id}"${checked} aria-label="${row.character} ${row.skill}を比較候補に残す">
            ${characterCell(row)}
          </label>
        </td>
        <td><strong>${row.skill}</strong><br><span class="pill">スキル${row.skillNumber}</span></td>
        <td><span class="pill">${displayValue(row.category)}</span><br>${displayValue(displaySubtype(row))}</td>
        <td class="target-cell">${displayValue(row.target)}</td>
        <td>${displayValue(row.ct)}</td>
        <td>${displayValue(row.multiplierText)}</td>
        ${damageCell}
        <td class="condition-cell">${displayValue(row.condition || row.duration)}</td>
        <td class="condition-cell">${displayValue(row.exclusiveWeapon)}</td>
      </tr>
    `;
  }).join("");
}

function findAnyRow(id) {
  return Object.values(datasets).flat().find((row) => row.id === id);
}

function renderPinned() {
  const rows = [...state.pinnedIds].map(findAnyRow).filter(Boolean);
  el.compareBinEmpty.style.display = rows.length ? "none" : "";
  el.compareBinList.innerHTML = rows.map((row) => `
    <div class="compare-chip">
      <span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span>
      <div>
        <strong>${row.character}</strong>
        <span>${row.skill}</span>
      </div>
      <button class="remove-chip" data-remove-pin="${row.id}" type="button" title="比較候補から外す">×</button>
    </div>
  `).join("");
}

function renderBoard() {
  const rows = [...state.pinnedIds].map(findAnyRow).filter(Boolean);
  el.boardCount.textContent = `${rows.length}件`;
  el.compareBoardEmpty.style.display = rows.length ? "none" : "";
  el.compareBoard.style.display = rows.length ? "grid" : "none";

  el.compareBoard.innerHTML = rows.map((row) => `
    <article class="board-card">
      <div class="board-card-head">
        <span class="mini-avatar ${attrClass(row.attribute)}">${getInitial(row.character)}</span>
        <div>
          <strong>${row.character}</strong>
          <span>${row.skill}</span>
        </div>
      </div>
      <dl class="board-note">
        ${renderDefinitionPairs([
          ["種別", `${displayValue(row.skillType)} / ${displayValue(displaySubtype(row))}`],
          ["対象", row.target],
          ["効果", row.multiplierText],
          ["表示火力", state.mode === "active" ? formatSelectedDamage(row) : ""],
          ["火力目安", formatDamageStages(row)],
          ["現実性", row.damage?.realityRank],
          ["ランキング対象", normalizeRankingTarget(row.damage?.rankingTarget)],
          ["条件・追加効果", row.condition || row.duration],
          ["専用武器", row.exclusiveWeapon],
          ["専用武器パッシブ", row.weaponPassive],
          ["比較メモ", row.memo]
        ])}
      </dl>
    </article>
  `).join("");
}

function renderDetail(row) {
  if (!row) {
    el.detailAvatar.textContent = "技";
    el.detailAvatar.className = "avatar attr-藍";
    el.detailMode.textContent = modeMeta[state.mode].detail;
    el.detailTitle.textContent = "スキルを選択";
    el.detailMeta.textContent = "行を選ぶと、効果や条件を確認できます。";
    el.detailList.innerHTML = "";
    el.detailLink.href = "#";
    return;
  }

  el.detailAvatar.textContent = getInitial(row.character);
  el.detailAvatar.className = `avatar ${attrClass(row.attribute)}`;
  el.detailMode.textContent = modeMeta[state.mode].detail;
  el.detailTitle.textContent = `${row.character} / ${row.skill}`;
  el.detailMeta.textContent = `${row.attribute}属性・${row.skillType}・${displaySubtype(row)}`;
  el.detailLink.href = row.source;

  const pairs = [
    ["対象", row.target],
    ["CT", valueOrDash(row.ct)],
    ["効果", row.multiplierText],
    ["表示火力", state.mode === "active" ? formatSelectedDamage(row) : ""],
    ["火力目安", formatDamageStages(row)],
    ["現実性", row.damage?.realityRank],
    ["ランキング対象", normalizeRankingTarget(row.damage?.rankingTarget)],
    ["持続", row.duration],
    ["条件・追加効果", row.condition],
    ["専用武器", row.exclusiveWeapon],
    ["専用武器パッシブ", row.weaponPassive],
    ["比較メモ", row.memo]
  ];

  el.detailList.innerHTML = renderDefinitionPairs(pairs);
}

function updateModeUi() {
  const meta = modeMeta[state.mode];
  el.title.textContent = meta.title;
  el.subtitle.textContent = meta.subtitle;
  el.notice.textContent = meta.notice;
  document.querySelectorAll(".metric-only").forEach((node) => {
    node.style.display = state.mode === "active" ? "" : "none";
  });
}

function render() {
  updateModeUi();
  const rows = currentRows();
  if (!rows.some((row) => row.id === state.selectedId)) {
    state.selectedId = rows[0]?.id ?? null;
  }
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

  el.search.addEventListener("input", () => {
    state.search = el.search.value;
    state.selectedId = null;
    render();
  });

  el.sort.addEventListener("change", () => {
    state.sort = el.sort.value;
    state.selectedId = null;
    render();
  });

  el.realityFilters.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      checkbox.checked ? state.reality.add(checkbox.value) : state.reality.delete(checkbox.value);
      state.selectedId = null;
      render();
    });
  });

  el.rankTargetFilters.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      checkbox.checked ? state.rankTarget.add(checkbox.value) : state.rankTarget.delete(checkbox.value);
      state.selectedId = null;
      render();
    });
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

  el.clearPinned.addEventListener("click", () => {
    state.pinnedIds.clear();
    render();
  });

  const resetFilters = () => {
    state.attribute = "all";
    state.search = "";
    state.sort = "base";
    state.reality = new Set(["高", "中", "低"]);
    state.rankTarget = new Set(["基本", "条件込み"]);
    state.selectedId = null;
    el.search.value = "";
    el.sort.value = "base";
    el.realityFilters.forEach((checkbox) => {
      checkbox.checked = state.reality.has(checkbox.value);
    });
    el.rankTargetFilters.forEach((checkbox) => {
      checkbox.checked = state.rankTarget.has(checkbox.value);
    });
    el.attributeFilter.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.value === "all");
    });
    render();
  };

  el.resetButtons.forEach((button) => {
    button.addEventListener("click", resetFilters);
  });
}

function renderLoadError(error) {
  el.tableHead.innerHTML = "";
  el.tableBody.innerHTML = `
    <tr>
      <td class="empty-state">
        <strong>データを読み込めませんでした</strong>
        ${error.message}
      </td>
    </tr>
  `;
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
