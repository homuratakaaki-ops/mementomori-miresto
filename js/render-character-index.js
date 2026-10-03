/**
 * キャラ一覧（pages/characters/index.html）のカード描画ロジック（共通モジュール）。
 *
 * ブラウザ: <script src="../../js/render-character-index.js"> で読み込むと
 *           window.MirestoRenderCharacterIndex に公開される。
 * Node:     scripts/build-character-pages.mjs から require して
 *           公開前のHTML生成に使う。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.MirestoRenderCharacterIndex = api;
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  /** 詳細ページが存在する pageSlug。ここに無いキャラは「準備中」表示になる。 */
  const EXISTING_PAGES = ["aa_dark","aa_rusted_sky","aine","aishe","alexandra","amleth","amleth_summer","amour","amour_holy_night","armstrong","artie","artoria","artoria_golden","asahi","belle","carmilla","cattleya","cerberus","cerberus_candy","chiffon","claudia","cordie","cordie_ringmaster","cordie_summer","cusith","dd","dian","eir","elaine","elfriede","eureka","evelyn","fenny","fenrir","fenrir_treasure","fia","fia_trace","flack","florence","florence_twilight","fortina","fortina_twilight","freycia","giluial","guinevere","hathor","idyne","illya_gods_curse","irene","iris_black","ivy","kaguya","karol","kobell","lean","liebe","lilicotte","lily","liselotte","lucile","luke","lumika","lunalynn","lunalynn_holy_night","matilda","meria","merlin","merlyn","merlyn_winter","mertillier","mifuri","mimi","minasumari","mira","moddey","moddey_summer","moineau","morgana","natasha","natasha_bouquet","nebra","nina","nina_summer","olivia","ophelia","paladea","paula","potpourri","primavera","primavera_summer","priscilla","rea","regina","rishess","rivelia","rosalie_caritas","rusalka","rustica","sabrina","sabrina_cool_breeze","serruria","shiloh","shizu_snow","sivi","soltina","soltina_warm_memory","sonya","sophia","stella","stella_holy_dark_star","tama","tilly","tricksy","tropon","tropon_holy_night","valriede","wheeler","yuni","yurdiz"];

  const existingPages = new Set(EXISTING_PAGES);

  function statusClass(status) {
    if (status === "PU中") return "pickup";
    if (!status || status === "復刻待ち") return "waiting";
    return "";
  }

  function displayGachaStatus(status) {
    return status || "復刻待ち";
  }

  function hasPage(character) {
    return existingPages.has(character.pageSlug);
  }

  function hrefFor(character) {
    return hasPage(character) ? `./${character.pageSlug}.html` : "#";
  }

  function filterCharacters(characters, activeAttribute) {
    return characters.filter((character) => activeAttribute === "all" || character.attribute === activeAttribute);
  }

  function countText(filteredLength, totalLength) {
    return `${filteredLength}件表示 / 全${totalLength}キャラ`;
  }

  function renderCard(character) {
    const linked = hasPage(character);
    return `
          <article class="card">
            <div class="badge-row">
              <span class="badge">${character.attribute}</span>
              <span class="badge ${statusClass(character.gachaStatus)}">${displayGachaStatus(character.gachaStatus)}</span>
            </div>
            <div>
              <h2>${character.name}</h2>
              <p>${character.catchcopy || character.roleMemo}</p>
            </div>
            <a class="button ${linked ? "primary" : "disabled"}" href="${hrefFor(character)}">${linked ? "詳細を見る" : "準備中"}</a>
          </article>
        `;
  }

  function renderGrid(characters, activeAttribute) {
    const filtered = filterCharacters(characters, activeAttribute || "all");
    if (filtered.length === 0) {
      return `<div class="empty">該当するキャラがありません。</div>`;
    }
    return filtered.map(renderCard).join("");
  }

  return {
    EXISTING_PAGES,
    statusClass,
    displayGachaStatus,
    hasPage,
    hrefFor,
    filterCharacters,
    countText,
    renderCard,
    renderGrid
  };
}));
