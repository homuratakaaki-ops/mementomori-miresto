/* アルカナ検索。判定はDOMに依存せず、依存関数と判定日時を受け取る。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MirestoArcanaSearch = api;
    api.init(root.document);
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";
  const loads = new WeakMap();

  function defaultState() {
    return { an: "", cn: "", character: "", effect: [], target: [], stage: "lr",
      count: [], status: [], basis: "end", minDays: "", maxDays: "", scope: "any", sort: "catalog", open: "" };
  }
  // URLの複数値は「すべての効果」等の表示順で正規化する。
  const queryLists = {
    effect: ["attack", "hp", "defense", "physical_defense", "magical_defense", "strength", "dexterity", "magic", "stamina",
      "critical", "critical_resistance", "critical_damage", "physical_critical_mitigation", "magical_critical_mitigation",
      "accuracy", "evasion", "debuff_accuracy", "debuff_resistance", "hp_drain", "counter", "physical_penetration",
      "physical_magical_penetration", "penetration", "party_level_cap", "member_awakening_cap"],
    target: ["all", "members", "party", "other", "unknown"], count: ["2", "3", "4"],
    status: ["ongoing", "upcoming", "waiting", "permanent", "history_unknown"]
  };
  const queryEnums = { stage: ["lr", "any"], basis: ["end", "start"], scope: ["any", "all", "named"],
    sort: ["catalog", "name", "count", "days_desc"] };
  function parseQuery(search) {
    const params = new URLSearchParams(search), state = defaultState();
    let warning = false;
    for (const key of new Set(params.keys())) {
      if (!Object.hasOwn(state, key)) { warning = true; continue; }
      const values = params.getAll(key), value = values[0];
      if (queryLists[key]) {
        const requested = values.flatMap(v => v.split(","));
        warning ||= requested.some(v => !queryLists[key].includes(v));
        state[key] = queryLists[key].filter(v => requested.includes(v));
      } else {
        warning ||= values.length > 1;
        if (queryEnums[key]) {
          if (queryEnums[key].includes(value)) state[key] = value;
          else warning = true;
        } else if (["minDays", "maxDays"].includes(key)) {
          if (/^\d+$/.test(value) && Number(value) <= 99999) state[key] = String(Number(value));
          else if (value !== "") warning = true;
        } else if (key === "open") {
          if (/^A\d{3}$/.test(value)) state.open = value;
          else if (value) warning = true;
        } else state[key] = value;
      }
    }
    const scopeExplicit = queryEnums.scope.includes(params.get("scope"));
    if (!scopeExplicit && (state.cn.trim() || state.character)) state.scope = "named";
    return { state, warning, scopeExplicit };
  }
  function formatQuery(value) {
    const state = { ...defaultState(), ...value }, defaults = defaultState(), params = new URLSearchParams();
    for (const key of Object.keys(defaults)) {
      if (queryLists[key]) {
        const selected = queryLists[key].filter(v => state[key].includes(v));
        if (selected.length) params.set(key, selected.join(","));
      } else {
        // 名前指定時の暗黙値はnamed。明示されたanyは省略すると意味が変わる。
        const initial = key === "scope" && (state.cn.trim() || state.character) ? "named" : defaults[key];
        if (state[key] !== initial) params.set(key, state[key]);
      }
    }
    const query = params.toString().replace(/%2C/g, ",");
    return query ? `?${query}` : "";
  }
  // IDの存在確認は取得済み索引を受け取る別の純粋関数で行う。
  function resolveQuery(parsed, index) {
    const state = { ...parsed.state };
    let characterMissing = false, warning = parsed.warning;
    if (state.character) {
      if (Object.hasOwn(index.characters, state.character)) state.cn = index.characters[state.character].name;
      else {
        state.character = ""; state.cn = ""; characterMissing = true;
        if (!parsed.scopeExplicit) state.scope = "any";
      }
    }
    if (state.open && !index.arcana.some(item => item.id === state.open)) { state.open = ""; warning = true; }
    return { ...parsed, state, warning, characterMissing };
  }
  function dependencies(deps) {
    if (deps) return deps;
    return typeof module === "object" && module.exports
      ? { ...require("./gacha-status.js"), ...require("./search-normalize.js") }
      : { ...globalThis.MirestoGachaStatus, ...globalThis.MirestoSearchNormalize };
  }
  function contains(value, text, deps) {
    return deps.normalizeVariants(text).some(query =>
      deps.normalizeVariants(value).some(candidate => candidate.includes(query)));
  }
  function matchCharacters(index, text, deps) {
    deps = dependencies(deps);
    if (!text.trim()) return [];
    return Object.entries(index.characters).filter(([, c]) => {
      const title = c.name.match(/^[\[［【](.*?)[\]］】]/);
      return [c.name, title ? c.name.slice(title[0].length) : c.name, title?.[1],
        c.reading?.name, c.reading?.title, ...(c.reading?.aliases || [])]
        .filter(Boolean).some(value => contains(value, text, deps));
    }).map(([id, c]) => ({ ...c, id }));
  }
  function validateDays(state) {
    const parse = value => value === "" || value == null ? null :
      /^\d+$/.test(String(value)) && Number(value) <= 99999 ? Number(value) : NaN;
    const min = parse(state.minDays), max = parse(state.maxDays);
    const error = Number.isNaN(min) || Number.isNaN(max) ? "日数は0〜99999の整数で入力してください" :
      min !== null && max !== null && min > max ? "最小日数が最大日数を超えています" : "";
    return { min, max, error, active: !error && (min !== null || max !== null) };
  }
  function summarizeCharacters(index, now, deps) {
    deps = dependencies(deps);
    return Object.fromEntries(Object.entries(index.characters).map(([id, c]) => [id,
      c.pageSlug ? deps.arcanaGachaSummary(c, now) : unknownSummary()]));
  }
  function unknownSummary() { return { state: "history_unknown", daysSinceEnd: null, daysSinceStart: null }; }
  function filterArcana(index, state, now, deps) {
    deps = dependencies(deps);
    state = { ...defaultState(), ...state };
    const days = validateDays(state);
    const summaries = summarizeCharacters(index, now, deps);
    const named = new Set(state.character && index.characters[state.character] ? [state.character] :
      matchCharacters(index, state.cn, deps).map(c => c.id));
    const hasName = !!(state.cn.trim() || (state.character && index.characters[state.character]));
    const effectActive = state.effect.length || state.target.length;
    return index.arcana.flatMap(item => {
      if (state.an.trim() && !contains(item.name, state.an, deps)) return [];
      if (hasName && !item.members.some(id => named.has(id))) return [];
      if (state.count.length && !state.count.map(Number).includes(item.members.length)) return [];
      const matchedStages = effectActive ? item.stages.filter(stage => !stage.pending &&
        (state.stage === "any" || stage.label === "LR") && stage.effects.some(effect => !effect.pending &&
          (!state.effect.length || state.effect.includes(effect.statKey)) &&
          (!state.target.length || state.target.includes(effect.target)))).map(stage => stage.label) : [];
      if (effectActive && !matchedStages.length) return [];
      if (state.status.length || days.active) {
        const members = state.scope === "named" && hasName ? item.members.filter(id => named.has(id)) : item.members;
        const satisfies = id => {
          if (!id && state.scope === "all" && !state.status.includes("history_unknown")) return false;
          const summary = summaries[id] || unknownSummary();
          const value = state.basis === "start" ? summary.daysSinceStart : summary.daysSinceEnd;
          return (!state.status.length || state.status.includes(summary.state)) &&
            (!days.active || (value != null && (days.min === null || value >= days.min) && (days.max === null || value <= days.max)));
        };
        if (!members.length || !(state.scope === "all" ? members.every(satisfies) : members.some(satisfies))) return [];
      }
      return [{ ...item, matchedStages }];
    });
  }
  function maximumDays(item, state, summaries) {
    const values = item.members.map(id => summaries[id]?.[state.basis === "start" ? "daysSinceStart" : "daysSinceEnd"])
      .filter(value => value != null);
    return values.length ? Math.max(...values) : -1;
  }
  function sortArcana(list, state, summaries = {}) {
    return list.slice().sort((a, b) => {
      const order = state.sort === "name" ? a.name.normalize("NFKC").localeCompare(b.name.normalize("NFKC"), "ja") :
        state.sort === "count" ? a.members.length - b.members.length : state.sort === "days_desc" ?
          maximumDays(b, state, summaries) - maximumDays(a, state, summaries) : 0;
      return order || a.id.localeCompare(b.id);
    });
  }

  function bindSearch(document, container, index) {
    const panel = container.querySelector("[data-search-controls]");
    const results = container.querySelector(".arcana-results");
    const view = document.defaultView;
    let now, summaries;
    const cards = new Map(index.arcana.map(item => [item.id, document.getElementById(`arcana-${item.id}`)]));
    const controls = [...panel.querySelectorAll("input, select")];
    const defaults = defaultState();
    let parsed = resolveQuery(parseQuery(view.location.search), index);
    let state = parsed.state, timer, composing = false;
    let scopeExplicit = parsed.scopeExplicit;
    const detailsState = new WeakMap();
    function writeUrl() {
      const url = view.location.pathname + formatQuery(state) + view.location.hash;
      view.history.replaceState(view.history.state, "", url);
    }
    function restoreDetails(scroll) {
      cards.forEach((card, id) => {
        const details = card.querySelector(".arcana-details");
        const open = id === state.open;
        detailsState.set(details, open);
        details.open = open;
      });
      const card = cards.get(state.open);
      if (scroll && card && !card.hidden) card.scrollIntoView();
    }
    function refreshClock() {
      now = new Date();
      summaries = summarizeCharacters(index, now);
      index.arcana.forEach(item => {
        cards.get(item.id).querySelectorAll(".arcana-member").forEach((row, slot) => {
          const status = row.querySelector(".arcana-status");
          if (status) status.textContent = view.MirestoArcana.statusText(summaries[item.members[slot]] || unknownSummary());
        });
      });
      document.querySelector("[data-status-time]").textContent =
        `開催状況：${view.MirestoGachaStatus.jstNow(now).replace(/-/g, "/").replace("T", " ")} 時点`;
      update(false);
    }
    const labels = new Map(controls.filter(input => input.closest("label")?.querySelector("span"))
      .map(input => [`${input.name}:${input.value}`, input.closest("label").querySelector("span").textContent]));
    const button = (label, action) => {
      const node = document.createElement("button");
      node.type = "button";
      node.textContent = label;
      node.className = "arcana-filter-chip";
      node.addEventListener("click", action);
      return node;
    };
    function syncControls() {
      controls.forEach(input => {
        if (input.name === "effectGroup") {
          const values = input.value.split(",");
          input.checked = values.every(value => state.effect.includes(value));
          input.indeterminate = !input.checked && values.some(value => state.effect.includes(value));
        } else if (input.type === "checkbox") input.checked = state[input.name].includes(input.value);
        else if (input.type === "radio") input.checked = state[input.name] === input.value;
        else if (state[input.name] !== "invalid" && input.value !== String(state[input.name])) input.value = state[input.name];
      });
    }
    function removeCondition(key, value) {
      if (Array.isArray(state[key])) state[key] = state[key].filter(item => item !== value);
      else state[key] = defaults[key];
      if (key === "cn" || key === "character") { state.cn = ""; state.character = ""; }
      syncControls();
      update();
    }
    function updateChips() {
      const chips = [];
      for (const key of ["effect", "target", "count", "status"]) {
        state[key].forEach(value => chips.push({ key, value, label: labels.get(`${key}:${value}`) }));
      }
      for (const key of ["an", "cn", "stage", "basis", "minDays", "maxDays", "scope"]) {
        if (state[key] === defaults[key]) continue;
        const prefix = { an: "アルカナ名：", cn: state.character ? "キャラ固定：" : "キャラ名：", minDays: "最小日数：", maxDays: "最大日数：" };
        chips.push({ key, label: prefix[key] ? prefix[key] + state[key] : labels.get(`${key}:${state[key]}`) });
      }
      for (const selector of ["[data-active-filters]", "[data-empty-filters]"]) {
        container.querySelector(selector).replaceChildren(...chips.map(chip =>
          button(`${chip.label} ×`, () => removeCondition(chip.key, chip.value))));
      }
      const advanced = chips.filter(chip => ["count", "status", "basis", "minDays", "maxDays", "scope"].includes(chip.key)).length;
      container.querySelector("[data-advanced-count]").textContent = `${advanced}件適用中`;
    }
    function update(saveUrl = true) {
      // 時計更新は入力確定待ちのURL保存を取り消さない。
      if (saveUrl) clearTimeout(timer);
      if (composing) return;
      const days = validateDays(state);
      const error = container.querySelector("[data-search-error]");
      error.textContent = [parsed.warning ? "一部の条件を読み取れませんでした" : "",
        parsed.characterMissing ? "対象のキャラが見つかりません" : "", days.error].filter(Boolean).join("。 ");
      error.hidden = !error.textContent;
      const list = sortArcana(filterArcana(index, state, now), state, summaries);
      const matches = new Map(list.map(item => [item.id, item]));
      cards.forEach((card, id) => {
        const match = matches.get(id);
        card.hidden = !match;
        const stages = state.stage === "any" && match && !match.matchedStages.includes("LR") ? match.matchedStages : [];
        let note = card.querySelector("[data-matched-stages]");
        if (!note) {
          note = document.createElement("p");
          note.dataset.matchedStages = "";
          note.className = "arcana-match-note";
          card.querySelector(".arcana-lr").before(note);
        }
        note.hidden = !stages.length;
        note.textContent = stages.length ? `一致した段階：${stages.join("・")}` : "";
        card.querySelectorAll(".arcana-stage-details .arcana-stage").forEach(section => {
          const matched = stages.includes(section.querySelector("h3").textContent);
          section.classList.toggle("arcana-stage-matched", matched);
          let label = section.querySelector("[data-stage-match]");
          if (!label) {
            label = document.createElement("p");
            label.dataset.stageMatch = "";
            label.textContent = "検索条件に一致";
            section.prepend(label);
          }
          label.hidden = !matched;
        });
      });
      // 既存要素の移動だけで並べ替え、detailsの開閉状態を保つ。
      list.forEach(item => results.append(cards.get(item.id)));
      container.querySelector("[data-result-count]").textContent = `検索結果 ${list.length}件／全${index.arcana.length}件`;
      container.querySelector("[data-empty-results]").hidden = list.length !== 0;
      container.querySelector("[data-sort-note]").hidden = state.sort !== "days_desc";
      const candidates = state.character ? [] : matchCharacters(index, state.cn);
      container.querySelector("[data-character-candidates]").replaceChildren(...(candidates.length <= 10 ? candidates : []).map(c =>
        button(`${c.name} ${c.attribute}`, () => {
          state.character = c.id;
          state.cn = c.name;
          syncControls();
          update();
        })));
      updateChips();
      container.querySelector("[data-hidden-open]").hidden = !state.open || !cards.get(state.open)?.hidden;
      if (saveUrl) writeUrl();
    }
    function readText(input) {
      if (input.name === "cn") {
        if (!scopeExplicit && !state.cn.trim() && input.value.trim()) state.scope = "named";
        state.character = "";
        parsed.characterMissing = false;
      }
      state[input.name] = input.validity?.badInput ? "invalid" : input.value;
    }
    panel.addEventListener("compositionstart", () => { composing = true; clearTimeout(timer); });
    panel.addEventListener("compositionend", event => {
      composing = false;
      readText(event.target);
      timer = setTimeout(() => { syncControls(); update(); }, 200);
    });
    panel.addEventListener("input", event => {
      const input = event.target;
      if (!["an", "cn", "minDays", "maxDays"].includes(input.name) || composing || event.isComposing) return;
      readText(input);
      clearTimeout(timer);
      timer = setTimeout(() => { syncControls(); update(); }, 200);
    });
    panel.addEventListener("change", event => {
      const input = event.target;
      if (composing || ["an", "cn", "minDays", "maxDays"].includes(input.name)) return;
      if (input.name === "scope") scopeExplicit = true;
      if (input.name === "effectGroup") {
        const values = input.value.split(",");
        state.effect = [...new Set([...state.effect.filter(value => !values.includes(value)), ...(input.checked ? values : [])])];
      } else if (input.type === "checkbox") {
        state[input.name] = [...state[input.name].filter(value => value !== input.value), ...(input.checked ? [input.value] : [])];
      } else state[input.name] = input.value;
      syncControls();
      update();
    });
    container.querySelectorAll("[data-clear-filters]").forEach(control => control.addEventListener("click", () => {
      state = defaultState(); parsed = { warning: false, characterMissing: false }; scopeExplicit = false;
      syncControls(); update(); restoreDetails(false);
    }));
    container.querySelector("[data-reveal-open]").addEventListener("click", () => {
      state = { ...defaultState(), open: state.open };
      parsed = { warning: false, characterMissing: false }; scopeExplicit = false;
      syncControls(); update(); restoreDetails(true);
    });
    cards.forEach((card, id) => {
      const details = card.querySelector(".arcana-details");
      detailsState.set(details, details.open);
      details.addEventListener("toggle", () => {
        if (detailsState.get(details) === details.open) return;
        detailsState.set(details, details.open);
        if (details.open) state.open = id;
        else if (state.open === id) state.open = "";
        update();
      });
    });
    view.addEventListener("popstate", () => {
      clearTimeout(timer); composing = false;
      parsed = resolveQuery(parseQuery(view.location.search), index);
      state = parsed.state; scopeExplicit = parsed.scopeExplicit;
      syncControls(); refreshClock(); restoreDetails(false);
    });
    view.setInterval(refreshClock, 60000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshClock(); });
    syncControls();
    refreshClock();
    restoreDetails(false);
    panel.hidden = false;
    document.querySelector("[data-search-fallback]").hidden = true;
    if (state.open) restoreDetails(true);
  }

  function init(document) {
    const container = document.querySelector("[data-arcana-search]");
    if (!container) return Promise.resolve(null);
    if (loads.has(container)) return loads.get(container);
    const load = Promise.resolve().then(() => fetch(container.dataset.indexSrc))
      .then(response => {
        if (!response.ok) throw new Error("index request failed");
        return response.json();
      }).then(index => {
        bindSearch(document, container, index);
        return index;
      }).catch(() => {
        const message = container.querySelector("[data-search-error]");
        message.textContent = "検索用データを読み込めませんでした。再読み込みしてください";
        message.hidden = false;
        return null;
      });
    loads.set(container, load);
    return load;
  }

  return { init, defaultState, parseQuery, formatQuery, resolveQuery, matchCharacters, validateDays, summarizeCharacters, filterArcana, sortArcana };
}));
