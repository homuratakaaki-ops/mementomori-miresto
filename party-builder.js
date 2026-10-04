/**
 * 「編成と比較」ページ（party-builder.html）のブラウザ側スクリプト。
 *
 * 方針（memento-comparison-request 由来の仕様）。
 * - 候補一覧・PT枠・基礎スピードは data/character-index.json（軽量）から描く。
 * - スキル本文の描画は js/render-character.js の renderSkillCard だけを使う。
 *   このファイルでスキルのHTMLを組み立てないこと（キャラ詳細との食い違い防止）。
 * - data/mementomori-skills.json（1.3MB）は④⑤で初めて必要になった時点で1回だけ読む。
 * - 状態は1つのオブジェクトで持ち、保存は端末内（localStorage）のみ。
 * - スピード順は「入力値の降順の目安」。確定行動順とは書かない。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "miresto.partyBuilder.v1";
  const SLOT_COUNT = 5;
  const ATTRIBUTES = ["藍", "紅", "翠", "黄", "天", "冥"];
  const SKILL_NUMBERS = [1, 2, 3, 4];

  /** S1/S2はアクティブ、S3/S4はパッシブ。 */
  function skillKindLabel(number) {
    return number <= 2 ? "アクティブ" : "パッシブ";
  }

  /* ------------------------------------------------------------------
   * 状態
   * ------------------------------------------------------------------ */
  const state = {
    party: new Array(SLOT_COUNT).fill(null),
    activeSlot: null,
    favorites: [],
    filter: { attrs: [], favoritesOnly: false },
    compare: { A: { id: null, skill: 1 }, B: { id: null, skill: 1 } },
    partySkills: {},
    partyOrder: "slot",
    speed: {},
    // 初期開閉は夢爽が了承したデモに合わせる（②③は閉じ、④⑤は開く）。
    sections: { speed: false, candidates: false, compare: true, party: true }
  };

  let characters = [];
  const byId = new Map();

  // スキル本文（1.3MB）は④⑤で初めて必要になった時点で1回だけ読む。
  const skillsByCharacter = new Map();
  let terms = {};
  let skillsState = "idle"; // idle / loading / ready / error
  let skillsPromise = null;

  /* ------------------------------------------------------------------
   * DOM
   * ------------------------------------------------------------------ */
  const el = {};

  function cacheDom() {
    el.storageNotice = document.getElementById("storageNotice");
    el.loadError = document.getElementById("loadError");
    el.party = document.getElementById("party");
    el.slotCaption = document.getElementById("slotCaption");
    el.slotDetail = document.getElementById("slotDetail");
    el.speedList = document.getElementById("speedList");
    el.speedCount = document.getElementById("speedCount");
    el.sourceTabs = document.getElementById("sourceTabs");
    el.attributeFilter = document.getElementById("attributeFilter");
    el.roster = document.getElementById("roster");
    el.rosterCount = document.getElementById("rosterCount");
    el.favoriteCount = document.getElementById("favoriteCount");
    el.compare = document.getElementById("compare");
    el.pickerBody = document.getElementById("pickerBody");
    el.partySkills = document.getElementById("partySkills");
    el.selectedCount = document.getElementById("selectedCount");
    el.partyOrder = document.getElementById("partyOrder");
    el.folds = {
      speed: document.getElementById("foldSpeed"),
      candidates: document.getElementById("foldCandidates"),
      compare: document.getElementById("foldCompare"),
      party: document.getElementById("foldParty")
    };
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function formatSpeedNumber(value) {
    return Number(value).toLocaleString("ja-JP");
  }

  /** 並び替え用の名前。先頭の「[肩書き]」を外して素体と並べる。 */
  function sortName(name) {
    return String(name).replace(/^\[[^\]]*\]/, "");
  }

  /** 肩書き付き（[○○]名前）かどうか。同名のときは素体を先に並べる。 */
  function hasTitle(name) {
    return /^\[[^\]]*\]/.test(String(name));
  }

  /* ------------------------------------------------------------------
   * 保存（端末内のみ）。保存できない環境でも保存以外は動かす。
   * ------------------------------------------------------------------ */
  let storageUsable = true;

  function markStorageUnusable() {
    if (!storageUsable) return;
    storageUsable = false;
    if (el.storageNotice) el.storageNotice.hidden = false;
  }

  function readSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      markStorageUnusable();
      return null;
    }
  }

  function save() {
    if (!storageUsable) return;
    const payload = {
      schema: "miresto.partyBuilder/1",
      party: state.party,
      favorites: state.favorites,
      partySkills: state.partySkills,
      speed: state.speed,
      sections: state.sections,
      filter: state.filter,
      partyOrder: state.partyOrder
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      markStorageUnusable();
    }
  }

  /**
   * 保存データの取り込み。現行JSONに無いidは静かに除外し、件数だけconsoleに残す
   * （キャラの改名・削除で画面が壊れないようにするため）。
   */
  function applySaved(saved) {
    if (!saved || typeof saved !== "object") return;
    let dropped = 0;
    const known = (id) => typeof id === "string" && byId.has(id);

    if (Array.isArray(saved.party)) {
      const seen = new Set();
      for (let i = 0; i < SLOT_COUNT; i += 1) {
        const id = saved.party[i];
        if (id === null || id === undefined) continue;
        if (!known(id)) { dropped += 1; continue; }
        if (seen.has(id)) { dropped += 1; continue; }
        seen.add(id);
        state.party[i] = id;
      }
    }

    if (Array.isArray(saved.favorites)) {
      const seen = new Set();
      saved.favorites.forEach((id) => {
        if (!known(id)) { dropped += 1; return; }
        if (seen.has(id)) return;
        seen.add(id);
        state.favorites.push(id);
      });
    }

    if (saved.partySkills && typeof saved.partySkills === "object") {
      Object.keys(saved.partySkills).forEach((id) => {
        if (!known(id)) { dropped += 1; return; }
        const numbers = Array.isArray(saved.partySkills[id]) ? saved.partySkills[id] : [];
        const cleaned = SKILL_NUMBERS.filter((n) => numbers.map(Number).includes(n));
        if (cleaned.length) state.partySkills[id] = cleaned;
      });
    }

    if (saved.speed && typeof saved.speed === "object") {
      Object.keys(saved.speed).forEach((id) => {
        if (!known(id)) { dropped += 1; return; }
        const value = Number(saved.speed[id]);
        if (Number.isFinite(value) && value > 0) state.speed[id] = Math.round(value);
      });
    }

    if (saved.filter && typeof saved.filter === "object") {
      if (Array.isArray(saved.filter.attrs)) {
        state.filter.attrs = ATTRIBUTES.filter((attr) => saved.filter.attrs.includes(attr));
      }
      state.filter.favoritesOnly = Boolean(saved.filter.favoritesOnly);
    }

    if (saved.sections && typeof saved.sections === "object") {
      Object.keys(state.sections).forEach((key) => {
        if (typeof saved.sections[key] === "boolean") state.sections[key] = saved.sections[key];
      });
    }

    if (saved.partyOrder === "slot" || saved.partyOrder === "speed") {
      state.partyOrder = saved.partyOrder;
    }

    if (dropped > 0) {
      console.info(`[編成と比較] 保存データのうち、現行データに無い項目を${dropped}件除外しました。`);
    }
  }

  /* ------------------------------------------------------------------
   * 参照ヘルパ
   * ------------------------------------------------------------------ */
  /**
   * スキル本文の遅延読み込み。読み終わったら④⑤だけ描き直す。
   * 初期表示（PTも比較枠も空）では呼ばれないので、1.3MBを最初に読むことはない。
   */
  function ensureSkills() {
    // 失敗後は再描画のたびに取り直さない（描画→失敗→再描画の無限ループを避ける）。
    if (skillsState !== "idle") return skillsPromise;
    skillsState = "loading";
    skillsPromise = Promise.all([
      fetch("./data/mementomori-skills.json", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(`mementomori-skills.json: ${r.status}`);
        return r.json();
      }),
      fetch("./data/terms.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { terms: {} }))
        .catch(() => ({ terms: {} }))
    ]).then(([data, termsData]) => {
      terms = termsData.terms || {};
      (data.skills || []).forEach((skill) => {
        if (!skill.characterId) return;
        if (!skillsByCharacter.has(skill.characterId)) skillsByCharacter.set(skill.characterId, []);
        skillsByCharacter.get(skill.characterId).push(skill);
      });
      skillsByCharacter.forEach((list) => list.sort((a, b) => Number(a.number) - Number(b.number)));
      skillsState = "ready";
      renderCompare();
      renderPicker();
      renderPartySkills();
    }).catch((error) => {
      console.error(error);
      skillsState = "error";
      renderCompare();
      renderPicker();
      renderPartySkills();
    });
    return skillsPromise;
  }

  function skillOf(id, number) {
    const list = skillsByCharacter.get(id) || [];
    return list.find((skill) => Number(skill.number) === Number(number)) || null;
  }

  /** ④⑤に出すものがあるかどうか。あるときだけスキル本文を読む。 */
  function needsSkills() {
    return Boolean(state.compare.A.id || state.compare.B.id || partyIds().length);
  }

  function skillStatusHtml() {
    if (skillsState === "error") {
      return `<div class="pb-empty">スキルデータの読み込みに失敗しました。時間をおいて再読み込みしてください。</div>`;
    }
    return `<div class="pb-loading">スキルデータを読み込んでいます…</div>`;
  }

  function character(id) {
    return id ? byId.get(id) || null : null;
  }

  function isFavorite(id) {
    return state.favorites.includes(id);
  }

  function partyIds() {
    return state.party.filter(Boolean);
  }

  function slotOf(id) {
    return state.party.indexOf(id);
  }

  function baseSpeed(id) {
    const entry = character(id);
    return entry && Number.isFinite(Number(entry.speed)) ? Number(entry.speed) : 0;
  }

  /** 設定値（手入力）。未入力なら基礎値を使う。 */
  function effectiveSpeed(id) {
    const manual = state.speed[id];
    return Number.isFinite(manual) && manual > 0 ? manual : baseSpeed(id);
  }

  /** 配置順（index付き）。 */
  function membersBySlot() {
    return state.party
      .map((id, index) => (id ? { id, index } : null))
      .filter(Boolean);
  }

  /** スピード順（設定値の降順。同値は配置順）。 */
  function membersBySpeed() {
    return membersBySlot()
      .slice()
      .sort((a, b) => effectiveSpeed(b.id) - effectiveSpeed(a.id) || a.index - b.index);
  }

  function orderedMembers() {
    return state.partyOrder === "speed" ? membersBySpeed() : membersBySlot();
  }

  /* ------------------------------------------------------------------
   * ① PTの配置
   * ------------------------------------------------------------------ */
  function renderParty() {
    el.party.innerHTML = state.party.map((id, index) => {
      const entry = character(id);
      const active = state.activeSlot === index;
      const body = entry
        ? `<span class="pb-slot-name">${escapeHtml(entry.name)}</span>
           <span class="pb-slot-sub">${escapeHtml(entry.attribute)}・${escapeHtml(entry.weaponType)}</span>`
        : `<span class="pb-slot-empty" aria-hidden="true">＋</span><span class="pb-slot-sub">空き</span>`;
      return `
        <div class="pb-slot${active ? " is-active" : ""}"${entry ? ` data-pb-attr="${escapeHtml(entry.attribute)}"` : ""}>
          <button type="button" class="pb-slot-button" data-action="select-slot" data-slot="${index}" aria-pressed="${active}">
            <span class="pb-slot-no">配置${index + 1}${active ? "・入替対象" : ""}</span>
            ${body}
          </button>
        </div>
      `;
    }).join("");

    const active = state.activeSlot;
    if (active === null) {
      el.slotCaption.textContent = "枠を押すと入替対象になります。";
    } else {
      const entry = character(state.party[active]);
      el.slotCaption.textContent = `入替対象：配置${active + 1}${entry ? `・${entry.name}` : "（空き）"}`;
    }
  }

  function renderSlotDetail() {
    const index = state.activeSlot;
    if (index === null) {
      el.slotDetail.innerHTML = `<p class="pb-note">同じキャラは1体まで。素体と肩書き付き（例：アルトリアと[黄金色の聖剣使い]アルトリア）は別キャラとして同時に編成できる扱いにしています（ゲーム内仕様は未確認）。</p>`;
      return;
    }
    const id = state.party[index];
    const entry = character(id);
    if (!entry) {
      el.slotDetail.innerHTML = `
        <div class="pb-slot-detail">
          <h3>配置${index + 1}：空き</h3>
          <p class="pb-note">「候補を探す・お気に入り」または「候補を比較して入れ替える」から、この枠にキャラを入れられます。</p>
          <div class="pb-row">
            ${moveButtons(index)}
          </div>
        </div>
      `;
      return;
    }
    el.slotDetail.innerHTML = `
      <div class="pb-slot-detail" data-pb-attr="${escapeHtml(entry.attribute)}">
        <h3>配置${index + 1}：${escapeHtml(entry.name)}</h3>
        <div class="meta-row">
          <span class="badge attribute">${escapeHtml(entry.attribute)}</span>
          <span class="badge">${escapeHtml(entry.weaponType)}</span>
          <span class="badge">基礎スピード ${formatSpeedNumber(entry.speed)}</span>
          <span class="badge">入手 ${escapeHtml(entry.availability)}</span>
        </div>
        <div class="pb-row">
          <button type="button" class="pb-btn pb-small" data-action="remove-member" data-slot="${index}">外す</button>
          ${moveButtons(index)}
          <a class="pb-btn pb-small" href="./pages/characters/${escapeHtml(entry.pageSlug)}.html">キャラ詳細</a>
        </div>
        <p class="pb-note">「←」「→」は配置順の入れ替えです。スピード順は別に表示します。</p>
      </div>
    `;
  }

  function moveButtons(index) {
    return `
      <button type="button" class="pb-btn pb-small" data-action="move-member" data-slot="${index}" data-step="-1" ${index === 0 ? "disabled" : ""} aria-label="配置を1つ前へ">←</button>
      <button type="button" class="pb-btn pb-small" data-action="move-member" data-slot="${index}" data-step="1" ${index === SLOT_COUNT - 1 ? "disabled" : ""} aria-label="配置を1つ後へ">→</button>
    `;
  }

  /* ------------------------------------------------------------------
   * ② スピード順の目安（段階3で実装）
   * ------------------------------------------------------------------ */
  function renderSpeed() {
    el.speedCount.textContent = "";
    el.speedList.innerHTML = `<div class="pb-empty">この区画は準備中です。</div>`;
  }

  /* ------------------------------------------------------------------
   * ③ 候補を探す・お気に入り
   * ------------------------------------------------------------------ */
  function renderFinder() {
    el.favoriteCount.textContent = `お気に入り ${state.favorites.length}体`;

    el.sourceTabs.innerHTML = `
      <button type="button" class="pb-btn pb-small" data-action="set-source" data-source="all" aria-pressed="${!state.filter.favoritesOnly}">全キャラ</button>
      <button type="button" class="pb-btn pb-small" data-action="set-source" data-source="favorites" aria-pressed="${state.filter.favoritesOnly}">★ お気に入りのみ</button>
    `;

    el.attributeFilter.innerHTML = [
      `<button type="button" class="pb-btn pb-small" data-action="clear-attrs" aria-pressed="${state.filter.attrs.length === 0}">すべて</button>`
    ].concat(ATTRIBUTES.map((attr) => `
      <button type="button" class="pb-btn pb-small" data-action="toggle-attr" data-attr="${escapeHtml(attr)}" aria-pressed="${state.filter.attrs.includes(attr)}">${escapeHtml(attr)}</button>
    `)).join("");

    const list = filteredCandidates();
    el.rosterCount.textContent = `${list.length}体の候補 / 全${characters.length}体`;
    el.roster.innerHTML = list.length
      ? list.map(renderRosterCard).join("")
      : `<div class="pb-empty">${emptyRosterMessage()}</div>`;
  }

  function filteredCandidates() {
    return characters.filter((entry) => {
      if (state.filter.favoritesOnly && !isFavorite(entry.id)) return false;
      // 複数属性はOR。お気に入り条件とはANDで併用する。
      if (state.filter.attrs.length && !state.filter.attrs.includes(entry.attribute)) return false;
      return true;
    });
  }

  function conditionText() {
    const parts = [];
    if (state.filter.attrs.length) parts.push(state.filter.attrs.join("＋"));
    if (state.filter.favoritesOnly) parts.push("お気に入りのみ");
    return parts.join("／");
  }

  function emptyRosterMessage() {
    if (state.filter.favoritesOnly && state.favorites.length === 0) {
      const tail = state.filter.attrs.length ? `（条件: ${escapeHtml(conditionText())}）` : "";
      return `お気に入りがまだありません${tail}。候補の☆を押すと登録できます。`;
    }
    const condition = conditionText();
    return `該当する候補がいません${condition ? `（条件: ${escapeHtml(condition)}）` : ""}。`;
  }

  function renderRosterCard(entry) {
    const inParty = partyIds().includes(entry.id);
    const canPlace = state.activeSlot !== null && (!inParty || slotOf(entry.id) === state.activeSlot);
    const placeLabel = state.activeSlot === null
      ? "枠を選ぶと入れられます"
      : (inParty && slotOf(entry.id) !== state.activeSlot ? "PTに編成済み" : `配置${state.activeSlot + 1}に入れる`);
    return `
      <article class="pb-roster-card" data-pb-attr="${escapeHtml(entry.attribute)}">
        <div class="pb-roster-head">
          <span class="pb-roster-name">${escapeHtml(entry.name)}</span>
          ${starButton(entry)}
        </div>
        <div class="meta-row">
          <span class="badge attribute">${escapeHtml(entry.attribute)}</span>
          <span class="badge">${escapeHtml(entry.weaponType)}</span>
          <span class="badge">スピード ${formatSpeedNumber(entry.speed)}</span>
          <span class="badge">入手 ${escapeHtml(entry.availability)}</span>
        </div>
        <div class="pb-roster-actions">
          <button type="button" class="pb-btn pb-small" data-action="send-compare" data-id="${escapeHtml(entry.id)}" data-side="A" aria-pressed="${state.compare.A.id === entry.id}">Aへ</button>
          <button type="button" class="pb-btn pb-small" data-action="send-compare" data-id="${escapeHtml(entry.id)}" data-side="B" aria-pressed="${state.compare.B.id === entry.id}">Bへ</button>
          <button type="button" class="pb-btn pb-small pb-primary pb-btn-wide" data-action="place-member" data-id="${escapeHtml(entry.id)}" ${canPlace ? "" : "disabled"}>${escapeHtml(placeLabel)}</button>
        </div>
      </article>
    `;
  }

  function starButton(entry) {
    const on = isFavorite(entry.id);
    return `<button type="button" class="pb-star" data-action="toggle-favorite" data-id="${escapeHtml(entry.id)}" aria-pressed="${on}" aria-label="${escapeHtml(entry.name)}をお気に入り${on ? "解除" : "登録"}">${on ? "★" : "☆"}</button>`;
  }

  /* ------------------------------------------------------------------
   * ④ 候補を比較して入れ替える
   *
   * スキルカードは js/render-character.js の renderSkillCard をそのまま呼ぶ。
   * キャラ詳細と同じHTMLになるので、専用武器・条件・倍率の表示が食い違わない。
   * ------------------------------------------------------------------ */
  function renderCompare() {
    if (needsSkills()) ensureSkills();
    el.compare.innerHTML = ["A", "B"].map(renderCompareColumn).join("");
  }

  function renderCompareColumn(side) {
    const slot = state.compare[side];
    const entry = character(slot.id);
    if (!entry) {
      return `
        <div class="pb-compare-col">
          <div class="pb-compare-head">
            <span class="pb-compare-side">候補${side}</span>
            <p class="pb-note">「候補を探す・お気に入り」の「${side}へ」で候補を入れると、ここにスキルが出ます。</p>
          </div>
        </div>
      `;
    }
    const number = SKILL_NUMBERS.includes(Number(slot.skill)) ? Number(slot.skill) : 1;
    const inOtherSlot = partyIds().includes(entry.id) && slotOf(entry.id) !== state.activeSlot;
    const canPlace = state.activeSlot !== null && !inOtherSlot;
    const placeLabel = state.activeSlot === null
      ? "枠を選ぶと入れられます"
      : (inOtherSlot ? "PTに編成済み" : `${side}を配置${state.activeSlot + 1}へ入れる`);

    return `
      <div class="pb-compare-col" data-pb-attr="${escapeHtml(entry.attribute)}">
        <div class="pb-compare-head">
          <span class="pb-compare-side">候補${side}</span>
          <div class="pb-compare-name">
            <h3>${escapeHtml(entry.name)}</h3>
            ${starButton(entry)}
          </div>
          <div class="meta-row">
            <span class="badge attribute">${escapeHtml(entry.attribute)}</span>
            <span class="badge">${escapeHtml(entry.weaponType)}</span>
            <span class="badge">基礎スピード ${formatSpeedNumber(entry.speed)}</span>
          </div>
          <div class="pb-skill-tabs" role="group" aria-label="${escapeHtml(entry.name)}の見たいスキル">
            ${SKILL_NUMBERS.map((n) => `
              <button type="button" class="pb-skill-tab" data-action="set-compare-skill" data-side="${side}" data-skill="${n}" aria-pressed="${n === number}">
                S${n}<span>${skillKindLabel(n)}</span>
              </button>
            `).join("")}
          </div>
          <button type="button" class="pb-btn pb-primary" data-action="place-member" data-id="${escapeHtml(entry.id)}" data-skill="${number}" ${canPlace ? "" : "disabled"}>${escapeHtml(placeLabel)}</button>
        </div>
        ${renderSkillCardHtml(entry.id, number)}
      </div>
    `;
  }

  /** スキルカード1枚。HTMLの組み立ては共通モジュールに任せる。 */
  function renderSkillCardHtml(id, number) {
    if (skillsState !== "ready") return skillStatusHtml();
    const skill = skillOf(id, number);
    if (!skill) return `<div class="pb-empty">S${number}のデータが見つかりません。</div>`;
    const renderer = window.MirestoRenderCharacter;
    if (!renderer) return `<div class="pb-empty">描画モジュール（js/render-character.js）が読み込まれていません。</div>`;
    return `<div class="skill-list">${renderer.renderSkillCard(skill, terms)}</div>`;
  }

  /* ------------------------------------------------------------------
   * ⑤ PTの関連スキルを見比べる
   * ------------------------------------------------------------------ */
  function renderPicker() {
    const members = membersBySlot();
    if (!members.length) {
      el.pickerBody.innerHTML = `<div class="pb-empty">PTにキャラを入れると、ここで見たいスキルを選べます。</div>`;
      return;
    }
    if (needsSkills()) ensureSkills();
    el.pickerBody.innerHTML = members.map(({ id, index }) => {
      const entry = character(id);
      const chosen = state.partySkills[id] || [];
      return `
        <div class="pb-picker-group" data-pb-attr="${escapeHtml(entry.attribute)}">
          <h3>配置${index + 1}　${escapeHtml(entry.name)}</h3>
          ${SKILL_NUMBERS.map((n) => {
            const skill = skillsState === "ready" ? skillOf(id, n) : null;
            const name = skill ? skill.name : (skillsState === "ready" ? "（データなし）" : "読み込み中…");
            return `
              <label class="pb-check">
                <input type="checkbox" data-skill-check data-id="${escapeHtml(id)}" data-skill="${n}" ${chosen.includes(n) ? "checked" : ""}>
                <span>S${n} ${skillKindLabel(n)}<br><span class="pb-check-name">${escapeHtml(name)}</span></span>
              </label>
            `;
          }).join("")}
        </div>
      `;
    }).join("");
  }

  function selectedSkillItems() {
    return orderedMembers().flatMap(({ id, index }) =>
      SKILL_NUMBERS
        .filter((n) => (state.partySkills[id] || []).includes(n))
        .map((n) => ({ id, index, number: n })));
  }

  function renderPartySkills() {
    const items = selectedSkillItems();
    el.selectedCount.textContent = `${items.length}スキル表示`;
    if (!items.length) {
      el.partySkills.innerHTML = `<div class="pb-empty">「表示するスキルを選ぶ」から、見たいスキルにチェックを入れてください。</div>`;
      return;
    }
    if (needsSkills()) ensureSkills();
    el.partySkills.innerHTML = items.map(({ id, index, number }) => {
      const entry = character(id);
      return `
        <div class="pb-skill-cell" data-pb-attr="${escapeHtml(entry.attribute)}">
          <div class="pb-skill-owner">
            <strong>${escapeHtml(entry.name)}</strong>
            <span class="pb-note">配置${index + 1}・設定スピード ${formatSpeedNumber(effectiveSpeed(id))}・S${number} ${skillKindLabel(number)}</span>
          </div>
          ${renderSkillCardHtml(id, number)}
        </div>
      `;
    }).join("");
  }

  /* ------------------------------------------------------------------
   * 描画のまとめ
   * ------------------------------------------------------------------ */
  function renderAll() {
    renderParty();
    renderSlotDetail();
    renderSpeed();
    renderFinder();
    renderCompare();
    renderPicker();
    renderPartySkills();
  }

  /* ------------------------------------------------------------------
   * 操作
   * ------------------------------------------------------------------ */
  function selectSlot(index) {
    state.activeSlot = state.activeSlot === index ? null : index;
    renderParty();
    renderSlotDetail();
    renderFinder();
    renderCompare();
  }

  function placeMember(id, skillNumber) {
    const index = state.activeSlot;
    if (index === null || !byId.has(id)) return;
    const existing = slotOf(id);
    if (existing !== -1 && existing !== index) return; // 同一idの重複編成は不可
    state.party[index] = id;
    // 入ったメンバーの初期表示スキル（デモ準拠：比較枠から入れたときはその番号）。
    const initial = SKILL_NUMBERS.includes(Number(skillNumber)) ? Number(skillNumber) : 1;
    if (!state.partySkills[id] || !state.partySkills[id].length) {
      state.partySkills[id] = [initial];
    }
    save();
    renderAll();
  }

  function removeMember(index) {
    // 外したメンバーの表示スキル選択・設定スピードは残す（再編成で戻す手間を省く）。
    state.party[index] = null;
    save();
    renderAll();
  }

  function moveMember(index, step) {
    const target = index + step;
    if (target < 0 || target >= SLOT_COUNT) return;
    const current = state.party[index];
    state.party[index] = state.party[target];
    state.party[target] = current;
    state.activeSlot = target;
    save();
    renderAll();
  }

  function toggleFavorite(id) {
    if (!byId.has(id)) return;
    const index = state.favorites.indexOf(id);
    if (index === -1) state.favorites.push(id);
    else state.favorites.splice(index, 1);
    save();
    renderFinder();
    renderCompare();
  }

  function setSource(source) {
    state.filter.favoritesOnly = source === "favorites";
    save();
    renderFinder();
  }

  function toggleAttr(attr) {
    const index = state.filter.attrs.indexOf(attr);
    if (index === -1) state.filter.attrs.push(attr);
    else state.filter.attrs.splice(index, 1);
    state.filter.attrs = ATTRIBUTES.filter((item) => state.filter.attrs.includes(item));
    save();
    renderFinder();
  }

  function clearAttrs() {
    state.filter.attrs = [];
    save();
    renderFinder();
  }

  function sendToCompare(side, id) {
    if (!byId.has(id) || (side !== "A" && side !== "B")) return;
    state.compare[side] = { id, skill: 1 };
    // 比較は開いて見せる（デモ準拠）。
    state.sections.compare = true;
    el.folds.compare.open = true;
    save();
    renderFinder();
    renderCompare();
  }

  function setCompareSkill(side, number) {
    if (side !== "A" && side !== "B") return;
    if (!SKILL_NUMBERS.includes(Number(number))) return;
    state.compare[side].skill = Number(number);
    renderCompare();
  }

  function togglePartySkill(id, number, checked) {
    if (!byId.has(id) || !SKILL_NUMBERS.includes(Number(number))) return;
    const current = state.partySkills[id] || [];
    const next = checked
      ? SKILL_NUMBERS.filter((n) => current.includes(n) || n === Number(number))
      : current.filter((n) => n !== Number(number));
    if (next.length) state.partySkills[id] = next;
    else delete state.partySkills[id];
    save();
    renderPartySkills();
  }

  function setPartyOrder(value) {
    state.partyOrder = value === "speed" ? "speed" : "slot";
    save();
    renderPartySkills();
  }

  function bindEvents() {
    const main = document.querySelector("main");

    main.addEventListener("change", (event) => {
      const target = event.target;
      if (target.id === "partyOrder") setPartyOrder(target.value);
      else if (target.hasAttribute("data-skill-check")) {
        togglePartySkill(target.dataset.id, target.dataset.skill, target.checked);
      }
    });

    main.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.action;
      if (action === "select-slot") selectSlot(Number(button.dataset.slot));
      else if (action === "remove-member") removeMember(Number(button.dataset.slot));
      else if (action === "move-member") moveMember(Number(button.dataset.slot), Number(button.dataset.step));
      else if (action === "toggle-favorite") toggleFavorite(button.dataset.id);
      else if (action === "set-source") setSource(button.dataset.source);
      else if (action === "toggle-attr") toggleAttr(button.dataset.attr);
      else if (action === "clear-attrs") clearAttrs();
      else if (action === "send-compare") sendToCompare(button.dataset.side, button.dataset.id);
      else if (action === "set-compare-skill") setCompareSkill(button.dataset.side, button.dataset.skill);
      else if (action === "place-member") placeMember(button.dataset.id, button.dataset.skill);
    });

    // 折りたたみの開閉だけを保存する。他の操作で開閉を勝手に戻さない。
    Object.keys(el.folds).forEach((key) => {
      const fold = el.folds[key];
      if (!fold) return;
      fold.addEventListener("toggle", () => {
        state.sections[key] = fold.open;
        save();
      });
    });
  }

  function applySections() {
    Object.keys(el.folds).forEach((key) => {
      const fold = el.folds[key];
      if (fold) fold.open = Boolean(state.sections[key]);
    });
  }

  /* ------------------------------------------------------------------
   * 起動
   * ------------------------------------------------------------------ */
  async function init() {
    cacheDom();
    try {
      const response = await fetch("./data/character-index.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`character-index.json: ${response.status}`);
      const json = await response.json();
      characters = (json.characters || [])
        .filter((entry) => entry.id && entry.name)
        // 実装日は data/character-index.json に無い（初回実装の記録があるのは119体中22体）ため、
        // 並びは名前順。肩書きは並び替えのキーから外し、素体と別バージョンが隣に来るようにする。
        .sort((a, b) =>
          sortName(a.name).localeCompare(sortName(b.name), "ja")
          || (hasTitle(a.name) ? 1 : 0) - (hasTitle(b.name) ? 1 : 0)
          || String(a.name).localeCompare(String(b.name), "ja"));
    } catch (error) {
      console.error(error);
      el.loadError.hidden = false;
      return;
    }
    characters.forEach((entry) => byId.set(entry.id, entry));

    applySaved(readSaved());
    applySections();
    if (el.partyOrder) el.partyOrder.value = state.partyOrder;
    bindEvents();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
