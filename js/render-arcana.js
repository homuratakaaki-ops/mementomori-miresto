/* アルカナ一覧の共通描画。データと開催状況を受け取る純粋関数。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  } else {
    root.MirestoArcana = api;
  }
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";
  const targets = { all: "全キャラ", members: "構成キャラ", party: "パーティ", other: "その他", unknown: "対象確認中" };
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }
  function monthDay(value) {
    const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match ? `${Number(match[1])}/${Number(match[2])}` : String(value || "");
  }
  function statusText(summary) {
    if (summary.state === "ongoing") {
      // 判定済みの回から表示用の終了を選ぶ。終了不明の回があれば未公表とする。
      if (summary.ongoing.some(entry => !entry.endDate)) return "開催中（終了日未公表）";
      const entry = summary.ongoing.slice().sort((a, b) =>
        `${b.endDate}T${b.endTime || "23:59"}`.localeCompare(`${a.endDate}T${a.endTime || "23:59"}`))[0];
      return `開催中（〜${monthDay(entry.endDate)}${entry.endTime ? ` ${entry.endTime}` : ""}）`;
    }
    if (summary.state === "upcoming") {
      return `開催予定（${monthDay(summary.upcoming[0].date)}〜）` +
        (summary.daysSinceEnd == null ? "" : `・前回終了から ${summary.daysSinceEnd}日`);
    }
    if (summary.state === "waiting") {
      if (summary.endUnknown) return "復刻待ち・終了日未確認";
      return `復刻待ち・前回終了から ${summary.daysSinceEnd}日` +
        (summary.endPrecision === "date_based" ? "（終了時刻未確認）" : "");
    }
    return summary.state === "permanent" ? "恒常" : "履歴未確認";
  }
  function renderMember(character, summary) {
    if (!character) return '<li class="arcana-member">未特定キャラ</li>';
    const name = escapeHtml(character.name);
    const linked = character.pageSlug
      ? `<a href="../characters/${escapeHtml(encodeURIComponent(character.pageSlug))}.html">${name}</a>`
      : `<span>${name}</span>`;
    return `<li class="arcana-member"><div class="arcana-member-name">${linked}<small>${escapeHtml(character.attribute)}</small></div>` +
      (character.pageSlug ? "" : '<p class="arcana-note">キャラ詳細未掲載</p>') +
      `<p class="arcana-status">${escapeHtml(character.pageSlug ? statusText(summary) : "履歴未確認")}</p></li>`;
  }
  function renderStage(stage) {
    return `<section class="arcana-stage"><h3>${escapeHtml(stage.label)}</h3><p>条件：${escapeHtml(stage.condition)}</p>` +
      (stage.pending ? '<p class="arcana-pending">この段階は確認中です</p>' :
        `<ul class="arcana-effects">${stage.effects.map(effect =>
          `<li${effect.pending ? ' class="arcana-pending"' : ""}>${escapeHtml(targets[effect.target] || targets.unknown)}：${escapeHtml(effect.text)}</li>`).join("")}</ul>`) + '</section>';
  }
  function renderStages(stages) {
    const later = stages.filter(stage => /^LR\+/.test(stage.label));
    return '<details class="arcana-details"><summary>段階別効果・条件</summary><div class="arcana-stage-details">' +
      stages.filter(stage => !/^LR\+/.test(stage.label)).map(renderStage).join("\n") +
      (later.length ? '<details><summary>LR+5以降</summary>' + later.map(renderStage).join("\n") + '</details>' : "") +
      '</div></details>';
  }
  function renderCard(arcana, characters, summaries) {
    const lr = arcana.stages.filter(stage => stage.label === "LR");
    return `<article class="arcana-card" id="arcana-${escapeHtml(arcana.id)}">\n` +
      `<header><small>${escapeHtml(arcana.id)}</small><h2>${escapeHtml(arcana.name)}</h2></header>\n` +
      `<div class="arcana-lr">${lr.map(renderStage).join("\n")}</div>\n` +
      '<div class="arcana-card-body"><section class="arcana-members"><h3>構成キャラ</h3><ul>' +
      arcana.members.map(id => renderMember(characters[id], summaries[id])).join("\n") + '</ul></section>\n' +
      renderStages(arcana.stages) + '</div>\n</article>';
  }
  return { escapeHtml, statusText, renderCard, renderMember, renderStages, renderStage };
}));
