/**
 * キャラページのブラウザ側スクリプト。
 *
 * 本文は scripts/build-character-pages.mjs が公開前にHTMLへ書き込む。
 * そのため、生成済みページ（body[data-prerendered]）では何も描画しない。
 * HTMLに本文が無いページだけ、従来どおり fetch して描画するフォールバックとして働く。
 *
 * 描画のHTML組み立ては js/render-character.js に集約してある（二重管理の禁止）。
 * データの唯一の正は data/mementomori-skills.json。data/*-overlay.json は参照しない。
 */
(function () {
  async function fetchJson(path, fallback) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 404) return fallback;
      throw new Error(`JSON読み込み失敗: ${response.status}`);
    }
    return response.json();
  }

  function setText(selector, text) {
    const node = document.querySelector(selector);
    if (node) node.textContent = text || "";
  }

  function isPrerendered(root) {
    return root.hasAttribute("data-prerendered");
  }

  async function initCharacterPage() {
    const root = document.querySelector("[data-character-page]");
    const characterId = root && root.dataset.characterId;
    if (!characterId) throw new Error("characterIdが設定されていません");

    // 生成済みページは再描画しない（二重描画の防止）。
    if (isPrerendered(root)) return;

    const renderer = window.MirestoRenderCharacter;
    if (!renderer) throw new Error("render-character.jsが読み込まれていません");

    const [data, newsData, termsData] = await Promise.all([
      fetchJson("../../data/mementomori-skills.json", { characters: [], skills: [] }),
      fetchJson("../../data/news.json", { items: [] }),
      fetchJson("../../data/terms.json", { terms: renderer.defaultTerms })
    ]);
    const character = (data.characters || []).find((item) => item.id === characterId);
    const skills = renderer.selectSkills(data, characterId);
    if (!character) throw new Error("キャラが見つかりません");

    document.title = renderer.pageTitle(character);
    setText("#characterName", character.name);
    setText("#roleMemo", renderer.roleMemoText(character));
    document.body.dataset.attribute = character.attribute || "";
    document.querySelector("#characterMeta").innerHTML = renderer.renderMetaHtml(character, newsData);
    document.querySelector("#skillList").innerHTML = renderer.renderSkillList(skills, termsData.terms || renderer.defaultTerms);

    if (character.noteUrl) {
      const notePanel = document.querySelector("#notePanel");
      const noteLink = document.querySelector("#noteLink");
      notePanel.hidden = false;
      noteLink.href = character.noteUrl;
    }
  }

  window.MirestoCharacterPage = { init: initCharacterPage };
}());
