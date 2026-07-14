# OGPタグ雛形

ページの`<head>`内に静的に記述する。JSによる動的挿入は、note/Xのクローラーが拾えないため不可。

```html
<!-- OGP -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="ミレストのメメントモリ分析データ室">
<meta property="og:locale" content="ja_JP">
<meta property="og:title" content="{ページごとに設定}">
<meta property="og:description" content="{ページごとに設定}">
<meta property="og:url" content="{ページごとに設定・絶対URL}">
<meta property="og:image" content="{ページごとに設定・絶対URL}">
<meta name="twitter:card" content="summary_large_image">
```

## ページ追加時のルール

ページ追加時に書き換えるのは、次の4行のみ。

- `og:title`
- `og:description`
- `og:url`
- `og:image`

`og:url`と`og:image`は、必ず`https://memento.musoudc.com/`始まりの絶対URLで指定する。相対パスは使わない。

## 画像仕様

- サイズ: 1200×630
- 容量: 300KB前後
- 形式: PNG
- 配置先: `assets/ogp/`
- 指定方法: `og:image`には絶対URLを記述する

## 今後の横展開対象

- `gacha-calc.html`
- `speed-calc.html`
- `dedicated-weapon-calc.html`

専用画像は未作成。作成までは`ogp-common.png`をフォールバックとして設定してよい。
