# 仕様書：状態異常ガイド「カウンタ・カウンタ変更」（layout: article）＋簡易スライド

- 作成：シオン 2026-10-06／実装：ミコト／基準コミット：main 86a1bc3
- 原稿の正：Notion「カウンタ・カウンタ変更｜特殊効果ガイド 記事原稿」。サイト用に転記済みの正は `data/status/counter.json`（本パッケージ同梱）。**文章はこのJSONから変えないこと。**

## 0. 前提と方針

- 状態異常ガイドの型（AGENTS.md「状態異常ガイドの型」）を壊さずに拡張する。**手書きHTMLは作らない。** ページは従来どおり `node scripts/build-character-pages.mjs` → `build-status-guides.mjs` で生成する。
- 既存の毒ガイド（`layout` なし＝従来型）は**出力が1バイトも変わらないこと**（`pages/status/poison.html` の差分ゼロを検証で確認）。
- 新しい型 `layout: "article"` は「見出し付きの節（sections）×部品（blocks）」で本文を組む汎用型。今回の部品は §2.3 の7種類だけ。これ以上の汎用化はしない。

## 1. 同梱ファイル（そのまま配置）

| 置き場所 | 内容 |
|---|---|
| `data/status/counter.json` | ガイド本文（正） |
| `assets/status/counter-slide-{1..5}-*.webp` | 1672×941 |
| `assets/status/counter-slide-{1..5}-*-960.webp` | 960×540（スマホ用） |
| `assets/status/counter-slide-{1..5}-*.jpg` | 1672×941（webp非対応の予備） |

画像は夢爽提供の完成品を変換しただけ。**再生成・再デザイン・トリミングはしない。**

## 2. counter.json の読み方（article型）

### 2.1 トップレベル

`layout`="article"、`label`（h1・title の「｜」の後ろ。従来型は「状態異常ガイド」固定のまま）、`description`（meta description。article型ではこれを使う）、`summary`（入口ページのカード文）、`sections[]`、`ignore[]`、`sources`。`lastCrossCheck`・`crossCheckNote`・`term` は従来どおり。

- `<title>` = `{name}｜{label} | {TITLE_SUFFIX}`、h1 = `{name}｜{label}`。
- `sections[]` は `{ id, heading, blocks[] }`。各節は既存の `card(id, heading, body)` でそのまま描く（`id` がアンカー）。節の並びはJSONの順。出典カードは最後に自動で付ける。

### 2.2 文字列の中の記法（全ブロック共通）

すべての文字列は**最初にHTMLエスケープ**し、そのあとで次の3つだけを置き換える。

| 記法 | 出力 |
|---|---|
| `**文字**` | `<strong>文字</strong>` |
| `{{skill:キャラID:番号}}` | `<a href="../characters/{pageSlug}.html#skill-{番号}">{キャラ名} S{番号} {スキル名}</a>` |
| `{{skill:キャラID:番号\|表示名}}` | 同じリンクで表示名だけ差し替え |
| `{{ref:キー}}` | `<a href="{url}" target="_blank" rel="noopener">{name}さん「{title}」</a>`（`sources.verification[].key` を引く） |
| `{{ref:キー\|表示名}}` | 同じリンクで表示名だけ差し替え |

未知の記法・閉じていない `{{` / `**` はビルドエラー。

### 2.3 ブロック（7種）

| type | 中身 | HTML |
|---|---|---|
| `p` | `text` | `<p>` |
| `h3` | `text` | `<h3 class="guide-sub">` |
| `list` | `items[]` | `<ul class="guide-bullets">` |
| `callout` | `title`, `body[]` | `<div class="guide-callout"><p class="guide-callout-title">…</p><p>…</p>…</div>` |
| `table` | `head[]`, `rows[][]` | 既存 `.guide-table` に `guide-table--wrap` を足す。各行の1列目は `<th scope="row">`、2列目以降は `<td data-label="{head[i]}">` |
| `skillTable` | `head[]`, `rows[{skill:"id:番号", cells[]}]` | 同上。1列目はスキルへのリンク（`{{skill}}`と同じ表示）、残りは `cells` |
| `slides` | `label`, `items[]` | §4 |


## 3. 検証（ビルドで止める。緩めないこと）

article型には従来の givers/users/amplifiers 検査（`validateLists`・`validateGiverNumbers`）を**かけない**。代わりに次を全部かける。

1. **取りこぼし検査**：`flow`（枠の when/target・効果の text/condition/note/duration・exclusive 内も含む）に `term`（「カウンタ」）を含むスキルを正規データから全件抽出し、本文中の `{{skill}}` と `skillTable` の行で参照されているか確かめる。漏れはエラー（載せない場合は `ignore` に `{ kind:"mentions", skillId, reason }`）。不要な ignore もエラー。2026-10-06時点の抽出は11件で、JSONは11件すべて参照済み。
2. **リンク先検査**：参照したスキルがすべて実在し、生成済みキャラページに `id="skill-N"` があること（既存 `validateLinks` と同じ方法）。
3. **数値検査**：`skillTable` の各セルに出てくる `N%` が、その行のスキルの `flow`（exclusive込みの文字列）に `N%` として含まれること。
4. **出典検査**：`{{ref}}` のキーがすべて `sources.verification` にあること。逆に、本文で一度も使われない verification があればエラー。
5. **スライド検査**：各 item の `webp`・`webpSmall`・`src` が実在、`width`/`height` が正の整数、`alt` が空でない、`duration` が 0.5〜10（秒）。
6. 既存の `validateTermLink`（`data/terms.json` の「カウンタ」の guideUrl が `/pages/status/counter.html`）と `FORBIDDEN_WORDS` の本文検査をそのまま通す。

## 4. 簡易スライド

### 4.1 生成するHTML（JSなしでも1枚目が見える形）

```html
<div class="guide-slides" data-guide-slides role="region" aria-roledescription="carousel" aria-label="{label}">
  <div class="guide-slides-viewport" aria-live="off">
    <figure class="guide-slide is-active" data-duration="2000" aria-roledescription="slide" aria-label="1 / 5">
      <picture>
        <source type="image/webp" srcset="../../{webpSmall} 960w, ../../{webp} 1672w" sizes="(max-width: 880px) 100vw, 880px">
        <img src="../../{src}" width="1672" height="941" alt="{alt}" decoding="async">
      </picture>
    </figure>
    <!-- 2枚目以降は is-active なし、img に loading="lazy" -->
  </div>
  <div class="guide-slides-controls" hidden>
    <button type="button" data-slides-prev aria-label="前の図へ">‹</button>
    <button type="button" data-slides-toggle aria-label="一時停止">❚❚</button>
    <button type="button" data-slides-next aria-label="次の図へ">›</button>
    <span class="guide-slides-dots"><!-- 枚数分 --><button type="button" data-slides-dot="0" aria-label="1枚目へ" aria-current="true"></button>…</span>
  </div>
</div>
```

- 1枚目は `loading` を付けない（即時読み込み）。`data-duration` は秒×1000の整数。
- slides ブロックがあるページだけ、`</body>` 直前に `<script src="../../js/guide-slides.js" defer></script>` を出す。

### 4.2 CSS（`assets/status-guide.css` に追記）

- `.guide-slides` は `width:100%; max-width:880px; margin:0 auto`。
- `.guide-slides-viewport` は `display:grid`。`.guide-slide` は全員 `grid-area:1/1; margin:0`、既定 `opacity:0; visibility:hidden`、`.is-active` だけ `opacity:1; visibility:visible`。切り替えは `opacity .4s`（非表示側は `visibility` を .4s 遅らせる）。→ 重ねて置くので高さは1枚分、読み込み前も width/height 属性で場所を確保（CLS防止）。
- `img { display:block; width:100%; height:auto; border-radius:8px }`。
- 操作列は本文より目立たせない：`--muted` 系の色、枠線なし〜細線、ボタンは見た目小さめでも**タップ領域44px**。ドットは見た目8px程度・現在位置だけアクセント色。
- `@media (prefers-reduced-motion: reduce)` で transition を無効化。
- `.guide-table--wrap td, th { white-space: normal }`（既存の2〜4列目 nowrap を打ち消す）。`.guide-bullets`・`.guide-callout`（`--accent-faint` 背景・`--accent-soft` 枠・角丸8px）・`.guide-callout-title`（太字）を追加。既存クラスの見た目は変えない。

### 4.3 JS（新規 `js/guide-slides.js`、依存なし・IIFE・`[data-guide-slides]` ごとに動く）

- 起動時：操作列の `hidden` を外す。2枚目以降の画像は、表示の1枚前になったら `loading="eager"` にして先読み（フェード中に白くならないため）。
- 表示時間は各スライドの `data-duration`（2.0/3.0/3.5/3.5/2.5秒）。最後の次は1枚目へ戻る（ループ）。無音・フェードのみ。
- 再生/一時停止ボタン：ラベルと `aria-label` を「一時停止 ❚❚」⇔「再生 ▶」で切替。再生中は viewport の `aria-live="off"`、停止中は `"polite"`。
- 前へ/次へ/ドット：再生状態は変えず、表示中スライドの残り時間を最初から数え直す。ドットは `aria-current` を移す。各 figure の `aria-hidden` は付けない（非表示は visibility で外れる）。
- **自動で止める条件（ユーザーの再生/停止の選択は上書きしない「一時中断」）**：タブが非表示（`visibilitychange`）、スライドが画面外（IntersectionObserver、可視25%未満）、スライド内にキーボードフォーカスがある間（`focusin`/`focusout`）。
- `prefers-reduced-motion: reduce` のときは**停止状態で開始**（1枚目を表示、ボタンは「再生 ▶」）。ユーザーが再生を押したら動いてよい（切り替えはフェードなし）。
- キーボード操作はボタンの標準動作のみ。矢印キー等の独自操作は付けない。

## 5. 出典カード（article型）

```
出典：ゲーム内ヘルプ／ゲーム内スキル説明
{officialNote}
検証参考：ワーズさんが公開されている検証結果を参考にさせていただきました。
・<a>ワーズさん「【メメントモリ】カウンタ」</a> … {note}
・…（3件）
```

- 感謝文は**1回だけ**（従来型の「1件ごとに繰り返す」書き方は article 型では使わない。従来型の出力は変えない）。
- いちごゲームさんは公開ページの出典に書かない（AGENTS.md の既存ルール）。

## 6. 付随するデータ修正

### 6.1 `data/terms.json` に2語追加

```json
"カウンタ": { "text": "敵から受けたダメージに応じて、攻撃してきた敵へダメージを返す能力。", "guideUrl": "/pages/status/counter.html" },
"カウンタ変更": { "text": "通常のカウンタの代わりに、スキルで決められた量のカウンタダメージを与える効果。受けたダメージ量やカウンタの増減の影響を受けない。", "guideUrl": "/pages/status/counter.html" }
```

### 6.2 `data/mementomori-skills.json` の効果行に `term` を付ける（キャラページの用語折りたたみ→ガイドへの導線。毒と同じ方式）

| スキル | 対象の効果行（text） | term |
|---|---|---|
| fortina-s4 | 防御力20%増加・カウンタ20%増加・物理防御力50%増加 | カウンタ |
| amour-s2 | 被ダメージを50%減少し、カウンタを100%増加 | カウンタ |
| ophelia-s3 | 同時に被ダメージ30%減少・カウンタ50%増加 | カウンタ |
| fia-s4 | カウンタを10%増加 | カウンタ |
| idyne-s3 | 旺花1スタックにつき攻撃力5%・カウンタ1%増加 | カウンタ |
| sophia-s3 | カウンタを55%増加 | カウンタ |
| shizu_snow-s4 | カウンタを40%減少 | カウンタ |
| moddey_summer-s3 | カウンタダメージを受けたときも75%遮断する | カウンタ |
| kaguya-s3 | カウンタ変更を付与 ／ カウンタ変更を解除（2行） | カウンタ変更 |
| moddey-s3 | カウンタ変更を付与 | カウンタ変更 |

dd-s4 は専用武器の変更文の中にしか出てこないので付けない。既に別の `term` が付いている行は無い（確認済み）。

### 6.3 ソフィアS3の専用武器表示の誤り（**別コミット**）

`sophia-s3` の3つ目の枠（when=「ターン開始時」、カウンタを55%増加）は、原文では**専用Lv1で追加される効果**なのに、基本効果として表示されている（`exclusiveWeapon` の記載「専用Lv1: ターン開始時、2ターンの間自身のカウンタが55%増加」と食い違い）。この枠に `"exclusiveLv": 1` を追加する。他の値は触らない。

## 7. AGENTS.md への追記

「状態異常ガイドの型」節に、article 型の要点（§2の記法とブロック、§3の検査、§4のスライドのルール：画像は差し替えのみ・表示時間はJSON・reduced-motion は停止開始・JSなしで1枚目表示）を短く追記する。

## 8. やらないこと

「○○返し」まで広げない／画像を作り直さない・動画化しない／入口ページ（状態異常ガイド一覧）の名称・説明文は変えない／おすすめ編成などの新機能を足さない／毒ガイドの見た目を変えない。
