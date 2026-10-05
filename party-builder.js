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
    favorites: [],
    filter: { attrs: [], favoritesOnly: false, search: "" },
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
    el.rail = document.getElementById("partyRail");
    el.party = document.getElementById("party");
    el.sectionParty = document.getElementById("sectionParty");
    el.slotCaption = document.getElementById("slotCaption");
    el.searchInput = document.getElementById("searchInput");
    el.toast = document.getElementById("toast");
    el.toastText = document.getElementById("toastText");
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

  /** 肩書きだけ（括弧の中身）。素体なら空文字。 */
  function titleOf(name) {
    const match = String(name).match(/^\[([^\]]*)\]/);
    return match ? match[1] : "";
  }

  /**
   * 枠に出す短い名前。44pxのマスに入れるため、肩書きを外して先頭3文字まで。
   * 素体と別バージョンは3文字では見分けられないので、別バージョンには
   * 描画側で「◆」の目印を付ける（full name は title / aria-label に残す）。
   */
  function shortName(name) {
    const base = sortName(name);
    // 別バージョンは「◆」の目印ぶん幅を取るので2文字まで。
    if (hasTitle(name)) return base.slice(0, 2);
    return base.length <= 4 ? base : base.slice(0, 3);
  }

  /** 小書き仮名 → 大書き仮名。「大小を同一視」のため。 */
  const LARGE_KANA = {
    "ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ",
    "ッ": "ツ", "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ", "ヮ": "ワ",
    "ヵ": "カ", "ヶ": "ケ"
  };

  /**
   * 「ヴ」はば行と同じ音として扱う。
   * 「ゔぁ」は変換しないと打てないので、「ばるりーで」でも
   * 「ゔぁるりーで」でも同じ候補に行き着くようにするため。
   * 小書き仮名を大書きに直す前に通すこと（ヴァ→ヴア になると揃わない）。
   */
  const VU_PAIRS = [
    ["ヴァ", "バ"], ["ヴィ", "ビ"], ["ヴゥ", "ブ"], ["ヴェ", "ベ"], ["ヴォ", "ボ"],
    ["ヴャ", "ビャ"], ["ヴュ", "ビュ"], ["ヴョ", "ビョ"], ["ヴ", "ブ"]
  ];

  /**
   * 検索用の正規化。ひらがな・カタカナ・英字の大小・全角半角・空白・
   * 小書き仮名を同一視する。`foldVu` を立てるとヴもば行に寄せる。
   * 濁点は落とさない（「ハ」と「バ」は別の名前なので）。
   *
   * 最初に Unicode NFKC を通すこと。半角カタカナ（ﾌﾛｰﾚﾝｽ）と半角濁点（ｺﾍﾞﾙ）が
   * 全角の形に揃うので、半角で打った人も全角と同じ候補に行き着く。
   * NFKCは全角の英数記号も半角へ直すので、文字コード計算での変換は不要。
   */
  function normalizeText(value, foldVu) {
    let text = String(value === null || value === undefined ? "" : value)
      // 半角カタカナ・半角濁点・全角英数記号をまとめて揃える
      .normalize("NFKC")
      .toLowerCase()
      // ひらがな → カタカナ
      .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));
    if (foldVu) for (const [from, to] of VU_PAIRS) text = text.split(from).join(to);
    return text
      .replace(/[ァィゥェォッャュョヮヵヶ]/g, (char) => LARGE_KANA[char] || char)
      .replace(/[\s　]/g, "");
  }

  /**
   * ヴのままの形と、ば行に寄せた形の両方を返す（同じになるなら1つ）。
   * 入力と照合先の両方をこの形にして突き合わせるので、
   * 「ばるりーで」「ゔぁるりーで」「ヴ」のどれでも取りこぼさない。
   */
  function normalizeVariants(value) {
    const plain = normalizeText(value, false);
    const folded = normalizeText(value, true);
    return plain === folded ? [plain] : [plain, folded];
  }

  /**
   * 検索対象は、表示名・肩書きを除いた名前・肩書き単体に加えて、
   * 読み（reading.name / reading.title / reading.aliases）。
   * 漢字の肩書きを変換せずに探せるようにするため。
   */
  function searchKeys(entry) {
    const reading = entry.reading || {};
    return [entry.name, sortName(entry.name), titleOf(entry.name),
      reading.name, reading.title]
      .concat(Array.isArray(reading.aliases) ? reading.aliases : [])
      .filter(Boolean)
      .flatMap(normalizeVariants);
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
      partyOrder: state.partyOrder,
      // 候補A/Bも保存する（再読み込みで比較の続きが消えないため）。
      compare: state.compare
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
      if (typeof saved.filter.search === "string") state.filter.search = saved.filter.search.slice(0, 60);
    }

    if (saved.sections && typeof saved.sections === "object") {
      Object.keys(state.sections).forEach((key) => {
        if (typeof saved.sections[key] === "boolean") state.sections[key] = saved.sections[key];
      });
    }

    if (saved.partyOrder === "slot" || saved.partyOrder === "speed") {
      state.partyOrder = saved.partyOrder;
    }

    // 候補A/Bの復元。現行データに無いidは空き枠へ落とす（画面を壊さないため）。
    if (saved.compare && typeof saved.compare === "object") {
      ["A", "B"].forEach((side) => {
        const slot = saved.compare[side];
        if (!slot || typeof slot !== "object") return;
        if (!known(slot.id)) {
          if (slot.id !== null && slot.id !== undefined) dropped += 1;
          return;
        }
        state.compare[side].id = slot.id;
        if (SKILL_NUMBERS.includes(Number(slot.skill))) state.compare[side].skill = Number(slot.skill);
      });
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

  /**
   * スピードの計算は js/speed-model.js に任せる（speed-calc.html と同じ式）。
   * v1はルーン・バフの入力UIを作らないので、ここでは手入力だけを渡す。
   * ルーン・装備からの算出を足すときは rune / speedBuffRate を埋めればよい。
   */
  function speedInput(id) {
    const manual = state.speed[id];
    return {
      rune: [0, 0, 0],
      manualSpeed: Number.isFinite(manual) ? manual : "",
      manualSpeedEnabled: true,
      speedBuffRate: ""
    };
  }

  /** 設定値（手入力）。未入力なら基礎値を使う。 */
  function effectiveSpeed(id) {
    const model = window.MirestoSpeedModel;
    if (!model) return Number.isFinite(state.speed[id]) ? state.speed[id] : baseSpeed(id);
    return model.finalSpeed(baseSpeed(id), speedInput(id));
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
   * 画面上部の編成帯（A・B・配置1〜5）。押すとその区画へ移動する。
   * ------------------------------------------------------------------ */
  function railCell(key, entry, target, label) {
    const filled = Boolean(entry);
    const value = filled
      ? `<span class="pb-rail-val${hasTitle(entry.name) ? " is-alt" : ""}">${escapeHtml(shortName(entry.name))}</span>`
      : `<span class="pb-rail-val" aria-hidden="true">＋</span>`;
    return `
      <button type="button" class="pb-rail-cell ${filled ? "is-filled" : "is-empty"}"
              data-action="go-section" data-target="${target}"
              title="${escapeHtml(filled ? `${label}：${entry.name}` : `${label}：空き`)}"
              aria-label="${escapeHtml(filled ? `${label} ${entry.name} へ移動` : `${label} 空き へ移動`)}">
        <span class="pb-rail-key" aria-hidden="true">${escapeHtml(key)}</span>${value}
      </button>
    `;
  }

  function renderRail() {
    const cells = [
      railCell("A", character(state.compare.A.id), "compare", "候補A"),
      railCell("B", character(state.compare.B.id), "compare", "候補B")
    ].concat(state.party.map((id, index) =>
      railCell(String(index + 1), character(id), "party", `配置${index + 1}`)));
    el.rail.innerHTML = cells.join("");
  }

  /* ------------------------------------------------------------------
   * ① PTの配置
   * ------------------------------------------------------------------ */
  function renderParty() {
    el.party.innerHTML = state.party.map((id, index) => {
      const entry = character(id);
      const body = entry
        ? `<a class="pb-slot-name" href="./pages/characters/${escapeHtml(entry.pageSlug)}.html">${escapeHtml(entry.name)}</a>
           <span class="pb-slot-sub">${escapeHtml(entry.attribute)}・${escapeHtml(entry.weaponType)}</span>`
        : `<span class="pb-slot-empty" aria-hidden="true">＋</span><span class="pb-slot-sub">空き</span>`;
      return `
        <div class="pb-slot" id="pb-slot-${index}"${entry ? ` data-pb-attr="${escapeHtml(entry.attribute)}"` : ""}>
          <span class="pb-slot-no">配置${index + 1}</span>
          ${body}
          <div class="pb-slot-actions">
            <button type="button" class="pb-btn pb-small" data-action="move-member" data-slot="${index}" data-step="-1" ${index === 0 || !entry ? "disabled" : ""} aria-label="配置${index + 1}を1つ前へ">←</button>
            <button type="button" class="pb-btn pb-small" data-action="move-member" data-slot="${index}" data-step="1" ${index === SLOT_COUNT - 1 || !entry ? "disabled" : ""} aria-label="配置${index + 1}を1つ後へ">→</button>
            <button type="button" class="pb-btn pb-small pb-wide" data-action="remove-member" data-slot="${index}" ${entry ? "" : "disabled"}>外す</button>
          </div>
        </div>
      `;
    }).join("");
    el.slotCaption.textContent = `編成 ${partyIds().length} / ${SLOT_COUNT}体。候補の「1〜5」を押すとその枠に入ります。`;
  }

  /**
   * 候補の行き先ボタン列「A ｜ B ｜ 1 2 3 4 5」。
   * 空枠は「＋」、埋まっている枠はそのキャラの短い名前、
   * この候補が入っている枠は「登録済み」として強調する。
   */
  function placeRow(entry, skillNumber) {
    const cells = ["A", "B"].map((side) => {
      const current = character(state.compare[side].id);
      const chosen = state.compare[side].id === entry.id;
      const value = chosen
        ? "選択中"
        : (current ? shortName(current.name) : "＋");
      return `
        <button type="button" class="pb-place${current || chosen ? "" : " is-empty"}"
                data-action="send-compare" data-side="${side}" data-id="${escapeHtml(entry.id)}"
                aria-pressed="${chosen}"
                title="${escapeHtml(`候補${side}へ${current ? `（いま ${current.name}）` : ""}`)}">
          <span class="pb-place-key" aria-hidden="true">${side}</span>
          <span class="pb-place-val${!chosen && current && hasTitle(current.name) ? " is-alt" : ""}">${escapeHtml(value)}</span>
        </button>
      `;
    });

    const slots = state.party.map((id, index) => {
      const current = character(id);
      const here = id === entry.id;
      const value = here ? "登録済み" : (current ? shortName(current.name) : "＋");
      const hint = here
        ? `配置${index + 1}に登録済み`
        : (current ? `配置${index + 1}の${current.name}を${entry.name}に入れ替える` : `配置${index + 1}に${entry.name}を入れる`);
      return `
        <button type="button" class="pb-place${current ? "" : " is-empty"}"
                data-action="place-member" data-id="${escapeHtml(entry.id)}" data-slot="${index}"${skillNumber ? ` data-skill="${skillNumber}"` : ""}
                aria-pressed="${here}" ${here ? "disabled" : ""}
                title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}">
          <span class="pb-place-key" aria-hidden="true">${index + 1}</span>
          <span class="pb-place-val${!here && current && hasTitle(current.name) ? " is-alt" : ""}">${escapeHtml(value)}</span>
        </button>
      `;
    });

    return `<div class="pb-place-row" role="group" aria-label="${escapeHtml(`${entry.name}の行き先`)}">${cells.concat(slots).join("")}</div>`;
  }

  /* ------------------------------------------------------------------
   * ② スピード順の目安
   *
   * 並びは設定値の降順（同値は配置順）。配置順とは別物なので、
   * ここを変えてもPTの配置は動かさない。
   *
   * 入力のたびに innerHTML を入れ替えないこと。入力欄ごと作り直すと、
   * 次に押した欄が押す前に消えてフォーカスが外れる（2026-10-05 ネネ報告 F02）。
   * メンバーが変わったときだけ組み直し、値の変更は既存の行を書き換える。
   * ------------------------------------------------------------------ */
  // 入力中はCSSの order で見た目だけ入れ替え、フォーカスが外れたらDOMを揃える。
  let speedOrderPending = false;

  /** いま出ている行（id → 要素）。まだ組んでいなければ null。 */
  function speedRows() {
    const list = el.speedList.querySelector("[data-speed-list]");
    if (!list) return null;
    const rows = new Map();
    list.querySelectorAll("[data-speed-row]").forEach((row) => rows.set(row.dataset.id, row));
    return { list, rows };
  }

  function sameSpeedMembers(found, members) {
    return Boolean(found) && found.rows.size === members.length
      && members.every(({ id }) => found.rows.has(id));
  }

  function renderSpeed() {
    const members = membersBySpeed();
    el.speedCount.textContent = members.length ? `${members.length}体` : "";
    if (!members.length) {
      speedOrderPending = false;
      el.speedList.innerHTML = `<div class="pb-empty">PTにキャラを入れると、ここに並びます。</div>`;
      return;
    }
    const found = speedRows();
    // メンバーが同じなら組み直さない（入力中の欄を消さないため）。
    if (sameSpeedMembers(found, members)) {
      syncSpeedRows(found, members);
      return;
    }
    speedOrderPending = false;
    el.speedList.innerHTML = `<div class="pb-speed-list" data-speed-list>${members.map(({ id, index }, rank) => {
      const entry = character(id);
      const manual = state.speed[id];
      return `
        <div class="pb-speed-item" data-speed-row data-id="${escapeHtml(id)}" data-pb-attr="${escapeHtml(entry.attribute)}">
          <span class="pb-speed-rank" data-speed-rank>${rank + 1}</span>
          <span>
            <span class="pb-speed-name">${escapeHtml(entry.name)}</span>
            <br><span class="pb-note" data-speed-note>配置${index + 1}・基礎スピード ${formatSpeedNumber(entry.speed)}</span>
          </span>
          <span class="pb-speed-input">
            <label for="pb-speed-${escapeHtml(id)}">設定値（未入力なら基礎値）</label>
            <input id="pb-speed-${escapeHtml(id)}" type="number" inputmode="numeric" min="1" max="99999" step="1"
                   data-speed-input data-id="${escapeHtml(id)}"
                   value="${Number.isFinite(manual) ? manual : ""}"
                   placeholder="${escapeHtml(entry.speed)}">
          </span>
        </div>
      `;
    }).join("")}</div>`;
  }

  /**
   * 既存の行を更新する。順位・配置・設定値を書き換え、並びはまずCSSの order で
   * 入れ替える。入力中の欄が残っている間はDOMを動かさない（動かすとカーソルが飛ぶ）。
   */
  function syncSpeedRows(found, members) {
    members.forEach(({ id, index }, rank) => {
      const row = found.rows.get(id);
      const entry = character(id);
      row.style.order = String(rank + 1);
      const rankCell = row.querySelector("[data-speed-rank]");
      if (rankCell) rankCell.textContent = String(rank + 1);
      const note = row.querySelector("[data-speed-note]");
      if (note) note.textContent = `配置${index + 1}・基礎スピード ${formatSpeedNumber(entry.speed)}`;
      const input = row.querySelector("[data-speed-input]");
      // 打ちかけの欄は上書きしない。
      if (input && input !== document.activeElement) {
        input.value = Number.isFinite(state.speed[id]) ? String(state.speed[id]) : "";
      }
    });
    if (found.list.contains(document.activeElement)) {
      speedOrderPending = true;
      return;
    }
    applySpeedOrder(found, members);
  }

  /** CSSで入れ替えていた並びを、DOMの並びに揃える。 */
  function applySpeedOrder(found, members) {
    members.forEach(({ id }, position) => {
      const row = found.rows.get(id);
      if (found.list.children[position] !== row) {
        found.list.insertBefore(row, found.list.children[position] || null);
      }
      row.style.order = "";
    });
    speedOrderPending = false;
  }

  /** 入力欄から離れたときに呼ぶ。 */
  function settleSpeedOrder() {
    if (!speedOrderPending) return;
    const found = speedRows();
    const members = membersBySpeed();
    if (!sameSpeedMembers(found, members)) {
      speedOrderPending = false;
      renderSpeed();
      return;
    }
    applySpeedOrder(found, members);
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
    const queries = normalizeVariants(state.filter.search).filter(Boolean);
    return characters.filter((entry) => {
      if (state.filter.favoritesOnly && !isFavorite(entry.id)) return false;
      // 複数属性はOR。お気に入り・検索の条件とはANDで併用する。
      if (state.filter.attrs.length && !state.filter.attrs.includes(entry.attribute)) return false;
      if (queries.length && !entry.searchKeys.some((key) => queries.some((q) => key.includes(q)))) return false;
      return true;
    });
  }

  function conditionText() {
    const parts = [];
    if (state.filter.search.trim()) parts.push(`「${state.filter.search.trim()}」`);
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
        ${placeRow(entry, null)}
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
          ${placeRow(entry, number)}
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
    renderRail();
    renderParty();
    renderSpeed();
    renderFinder();
    renderCompare();
    renderPicker();
    renderPartySkills();
  }

  /* ------------------------------------------------------------------
   * 入替のお知らせ（元に戻す付き）
   * ------------------------------------------------------------------ */
  const TOAST_MS = 7000;
  let undoSnapshot = null;
  let toastTimer = null;

  function hideToast() {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    undoSnapshot = null;
    if (el.toast) el.toast.hidden = true;
  }

  function showToast(message, snapshot) {
    if (!el.toast) return;
    if (toastTimer) clearTimeout(toastTimer);
    undoSnapshot = snapshot;
    el.toastText.textContent = message;
    el.toast.hidden = false;
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }

  /**
   * 通知は出さずに取り消し地点だけ取り直す。
   * 配置が変わらない操作（表示スキルのチェック）用。
   * ここで古い通知を閉じないと、前の編成を指した通知が残ったままになり、
   * 押した人の後続操作が黙って消える（2026-10-05 ネネ報告 F01）。
   */
  function setUndoPoint(snapshot) {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (el.toast) el.toast.hidden = true;
    undoSnapshot = snapshot;
  }

  function undoPlace() {
    if (!undoSnapshot) { hideToast(); return; }
    state.party = undoSnapshot.party.slice();
    state.partySkills = undoSnapshot.partySkills;
    hideToast();
    save();
    renderAll();
  }

  function snapshot() {
    const skills = {};
    Object.keys(state.partySkills).forEach((id) => { skills[id] = state.partySkills[id].slice(); });
    return { party: state.party.slice(), partySkills: skills };
  }

  /* ------------------------------------------------------------------
   * 操作
   * ------------------------------------------------------------------ */
  /**
   * 候補を枠へ入れる。枠が埋まっていれば即時入替し、画面下に1行出す。
   * 同じid（全く同じキャラ）だけが重複不可。別バージョンは同時に編成できる。
   * すでにPTにいる候補を別の枠へ入れたときは、2つの枠を入れ替える。
   */
  function placeMember(id, index, skillNumber) {
    if (!byId.has(id)) return;
    if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return;
    if (state.party[index] === id) return;

    const before = snapshot();
    const replaced = character(state.party[index]);
    const from = slotOf(id);
    if (from !== -1) state.party[from] = state.party[index]; // PT内の移動は入れ替え
    state.party[index] = id;

    // 表示スキルの引き継ぎ。
    // - 比較枠から入れたとき（data-skill あり）は、いま見ていたスキルを「追加」する。
    //   既存の選択は消さず、同じ番号は増やさない。
    // - 候補一覧から入れたときは表示スキルを増やさない（空のときだけS1）。
    const chosen = state.partySkills[id] || [];
    const fromCompare = SKILL_NUMBERS.includes(Number(skillNumber));
    if (fromCompare) {
      state.partySkills[id] = SKILL_NUMBERS.filter((n) => chosen.includes(n) || n === Number(skillNumber));
    } else if (!chosen.length) {
      state.partySkills[id] = [1];
    }

    const entry = character(id);
    let message;
    if (replaced && from !== -1) {
      message = `配置${index + 1}を${replaced.name}から${entry.name}へ入替（${replaced.name}は配置${from + 1}へ）`;
    } else if (replaced) {
      message = `配置${index + 1}を${replaced.name}から${entry.name}へ入替`;
    } else if (from !== -1) {
      message = `${entry.name}を配置${from + 1}から配置${index + 1}へ移動`;
    } else {
      message = `配置${index + 1}に${entry.name}を入れました`;
    }
    showToast(message, before);
    save();
    renderAll();
  }

  function removeMember(index) {
    const entry = character(state.party[index]);
    if (!entry) return;
    const before = snapshot();
    // 外したメンバーの表示スキル選択・設定スピードは残す（再編成で戻す手間を省く）。
    state.party[index] = null;
    showToast(`配置${index + 1}の${entry.name}を外しました`, before);
    save();
    renderAll();
  }

  /**
   * 矢印での移動。これも「元に戻す」の対象にする。
   * snapshotを取らずに通知を残すと、古い通知がこの移動より前の編成を指したまま残り、
   * 押した人の矢印操作が黙って消える（2026-10-05 ネネ報告 F01）。
   */
  function moveMember(index, step) {
    const target = index + step;
    if (target < 0 || target >= SLOT_COUNT) return;
    const current = state.party[index];
    if (!current) return;
    const before = snapshot();
    const mover = character(current);
    const other = character(state.party[target]);
    state.party[index] = state.party[target];
    state.party[target] = current;
    showToast(other
      ? `配置${index + 1}の${mover.name}と配置${target + 1}の${other.name}を入れ替えました`
      : `${mover.name}を配置${index + 1}から配置${target + 1}へ移動しました`, before);
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

  function setSearch(value) {
    state.filter.search = String(value).slice(0, 60);
    save();
    renderFinder();
  }

  /**
   * 編成帯から該当区画へ移動する。閉じている区画は開いてから運ぶ。
   * スクロールは即時（behavior は指定しない）。なめらかスクロールは
   * 動きを減らす設定の端末で無視され、押しても動かないボタンになるため。
   */
  function goSection(target) {
    if (target === "compare") {
      state.sections.compare = true;
      el.folds.compare.open = true;
      el.folds.compare.scrollIntoView({ block: "start" });
    } else {
      el.sectionParty.scrollIntoView({ block: "start" });
    }
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
    renderRail();
    renderFinder();
    renderCompare();
  }

  function setCompareSkill(side, number) {
    if (side !== "A" && side !== "B") return;
    if (!SKILL_NUMBERS.includes(Number(number))) return;
    state.compare[side].skill = Number(number);
    save();
    renderCompare();
  }

  /**
   * 表示スキルのチェック。配置は変わらないので通知は出さないが、
   * snapshot は取り直して古い通知を閉じる。
   * 残すと、入替の通知が残ったまま「元に戻す」でこの選択が消える（F01）。
   */
  function togglePartySkill(id, number, checked) {
    if (!byId.has(id) || !SKILL_NUMBERS.includes(Number(number))) return;
    const before = snapshot();
    const current = state.partySkills[id] || [];
    const next = checked
      ? SKILL_NUMBERS.filter((n) => current.includes(n) || n === Number(number))
      : current.filter((n) => n !== Number(number));
    if (next.length) state.partySkills[id] = next;
    else delete state.partySkills[id];
    setUndoPoint(before);
    save();
    renderPartySkills();
  }

  /**
   * 設定スピードの手入力。空欄なら基礎値に戻す。
   * 速度を変えても配置（state.party）は動かさない。
   *
   * 打っている途中（input）で受け取り、範囲外の値はその場では黙って無視する。
   * ここで描き直すと打ちかけの欄が消えるため。しまい直しは確定（change）で行う。
   */
  function setSpeed(id, raw) {
    if (!byId.has(id)) return;
    const text = String(raw).replace(/,/g, "").trim();
    if (!text) delete state.speed[id];
    else {
      const value = Number(text);
      if (!Number.isFinite(value) || value < 1 || value > 99999) return;
      state.speed[id] = Math.round(value);
    }
    save();
    renderSpeed();
    schedulePartySkills();
  }

  /** 入力確定時に、受け付けなかった値を保存済みの値へ戻す。 */
  function commitSpeedInput(input) {
    const id = input.dataset.id;
    if (!byId.has(id)) return;
    const stored = Number.isFinite(state.speed[id]) ? String(state.speed[id]) : "";
    if (String(input.value).replace(/,/g, "").trim() !== stored) input.value = stored;
  }

  /**
   * ⑤の描き直しは1打ごとに走らせない（スキルカードを何枚も組み直すため）。
   * 打ち終わりに1回だけまとめて描く。
   */
  let partySkillsTimer = null;

  function schedulePartySkills() {
    if (partySkillsTimer) clearTimeout(partySkillsTimer);
    partySkillsTimer = setTimeout(() => {
      partySkillsTimer = null;
      renderPartySkills();
    }, 250);
  }

  function setPartyOrder(value) {
    state.partyOrder = value === "speed" ? "speed" : "slot";
    save();
    renderPartySkills();
  }

  function bindEvents() {
    // 編成帯と入替のお知らせは <main> の外にあるので body でまとめて拾う。
    const root = document.body;

    root.addEventListener("change", (event) => {
      const target = event.target;
      if (target.id === "partyOrder") setPartyOrder(target.value);
      else if (target.hasAttribute("data-speed-input")) commitSpeedInput(target);
      else if (target.hasAttribute("data-skill-check")) {
        togglePartySkill(target.dataset.id, target.dataset.skill, target.checked);
      }
    });

    // スピードは打つたびに受け取る。changeだけで受けると、次の欄を押した瞬間に
    // 入力欄を組み直すことになり、押した欄が消えてフォーカスが外れる（F02）。
    root.addEventListener("input", (event) => {
      const target = event.target;
      if (target.hasAttribute && target.hasAttribute("data-speed-input")) {
        setSpeed(target.dataset.id, target.value);
      }
    });

    // 入力欄から離れたら、CSSで入れ替えていた並びをDOMにも反映する。
    // 次も速度の入力欄ならまだ揃えない（Tabでの連続入力を止めないため）。
    root.addEventListener("focusout", (event) => {
      const target = event.target;
      if (!target.hasAttribute || !target.hasAttribute("data-speed-input")) return;
      const next = event.relatedTarget;
      if (next && next.hasAttribute && next.hasAttribute("data-speed-input")) return;
      settleSpeedOrder();
    });

    // 検索は打つたびに絞る。入力欄は再描画しないので、文字が消えることはない。
    if (el.searchInput) {
      el.searchInput.addEventListener("input", (event) => setSearch(event.target.value));
    }

    root.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.action;
      if (action === "remove-member") removeMember(Number(button.dataset.slot));
      else if (action === "move-member") moveMember(Number(button.dataset.slot), Number(button.dataset.step));
      else if (action === "toggle-favorite") toggleFavorite(button.dataset.id);
      else if (action === "set-source") setSource(button.dataset.source);
      else if (action === "toggle-attr") toggleAttr(button.dataset.attr);
      else if (action === "clear-attrs") clearAttrs();
      else if (action === "clear-search") {
        el.searchInput.value = "";
        setSearch("");
        el.searchInput.focus();
      } else if (action === "send-compare") sendToCompare(button.dataset.side, button.dataset.id);
      else if (action === "set-compare-skill") setCompareSkill(button.dataset.side, button.dataset.skill);
      else if (action === "place-member") {
        placeMember(button.dataset.id, Number(button.dataset.slot), button.dataset.skill);
      } else if (action === "undo-place") undoPlace();
      else if (action === "go-section") goSection(button.dataset.target);
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
    characters.forEach((entry) => {
      entry.searchKeys = searchKeys(entry); // 検索のたびに作り直さない
      byId.set(entry.id, entry);
    });

    applySaved(readSaved());
    applySections();
    if (el.partyOrder) el.partyOrder.value = state.partyOrder;
    if (el.searchInput) el.searchInput.value = state.filter.search;
    bindEvents();
    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
