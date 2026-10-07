/*
 * 状態異常対策キャラ検索の絞り込み（pages/status/countermeasures.html）。
 * 表はビルド時に全件出してあり、ここでは行の表示・非表示と件数だけを切り替える。
 * JS が無い環境では絞り込み欄を出さず、全件の表をそのまま読める。
 */
(function () {
  "use strict";

  function init() {
    var filters = document.querySelector("[data-cm-filters]");
    if (!filters) return;
    var status = document.getElementById("cm-status");
    var type = document.getElementById("cm-type");
    var attribute = document.getElementById("cm-attribute");
    var rows = Array.prototype.slice.call(document.querySelectorAll("[data-cm-row]"));
    var count = document.querySelector("[data-cm-count]");
    var empty = document.querySelector("[data-cm-empty]");
    var hints = document.querySelector("[data-cm-hints]");
    var selects = [
      { el: status, label: "状態異常" },
      { el: type, label: "対策タイプ" },
      { el: attribute, label: "属性" }
    ];

    // data-coverage は「対策タイプ:効く状態異常」の並び（例 "cleanse:all ccImmune:気絶,睡眠,混乱,沈黙,金縛り"）。
    // 状態異常と対策タイプは、同じタイプの組で両方を満たすときだけ当てはまる。
    function matches(row, values) {
      if (values.attribute !== "all" && row.getAttribute("data-attribute") !== values.attribute) return false;
      var pairs = row.getAttribute("data-coverage").split(" ");
      for (var i = 0; i < pairs.length; i += 1) {
        var parts = pairs[i].split(":");
        var statuses = parts[1].split(",");
        if (values.type !== "all" && parts[0] !== values.type) continue;
        if (values.status !== "all" && statuses.indexOf("all") === -1 && statuses.indexOf(values.status) === -1) continue;
        return true;
      }
      return false;
    }

    function current() {
      return { status: status.value, type: type.value, attribute: attribute.value };
    }

    function countFor(values) {
      var n = 0;
      for (var i = 0; i < rows.length; i += 1) if (matches(rows[i], values)) n += 1;
      return n;
    }

    function keyOf(el) {
      return el === status ? "status" : el === type ? "type" : "attribute";
    }

    function update() {
      var values = current();
      var shown = 0;
      for (var i = 0; i < rows.length; i += 1) {
        var ok = matches(rows[i], values);
        rows[i].hidden = !ok;
        if (ok) shown += 1;
      }
      count.textContent = "該当 " + shown + "件";
      empty.hidden = shown !== 0;
      hints.textContent = "";
      if (shown !== 0) return;
      // 0件のときは、1つだけ「すべて」に戻した場合の件数を添えて戻すボタンを出す
      selects.forEach(function (item) {
        if (item.el.value === "all") return;
        var widened = current();
        widened[keyOf(item.el)] = "all";
        var n = countFor(widened);
        if (!n) return;
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = item.label + "を「すべて」に戻す（" + n + "件）";
        button.addEventListener("click", function () {
          item.el.value = "all";
          update();
          item.el.focus();
        });
        hints.appendChild(button);
      });
    }

    selects.forEach(function (item) { item.el.addEventListener("change", update); });
    filters.hidden = false;
    update();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
