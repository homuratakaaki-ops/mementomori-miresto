/* party-builder.js の同名関数と同じ仕様。将来こちらへ統合する */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MirestoSearchNormalize = api;
}(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";
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

  return { normalizeText, normalizeVariants };
}));
