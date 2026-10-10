/**
 * 生成ページが読み込む CSS・JS・画像の URL に「中身の印」を付ける（例：status-guide.css?v=1a2b3c4d）。
 *
 * ねらい：ブラウザは同じ URL のファイルをしばらく覚えている（GitHub Pages は約10分）。
 * CSS や画像を差し替えた直後に、新しい HTML と古い CSS・画像が組み合わさって崩れるのを防ぐ。
 * 印はファイルの中身から決まる（md5 の先頭8文字）ので、中身が変わったときだけ URL が変わり、
 * 変わらないファイルは今までどおりブラウザの記憶を使える。ビルドを何度回しても同じ結果になる。
 *
 * 文字のファイル（CSS・JS など）は改行コードをそろえてから印を作る。Windows の作業環境
 * （改行が CRLF になる）と GitHub の自動ビルド（LF）で印が食い違わないようにするため。
 *
 * 使い方：versioned("assets/status-guide.css") → "assets/status-guide.css?v=xxxxxxxx"
 * パスはリポジトリのルートからの相対パスで渡す。ページからの "../../" などは呼び出し側で前に付ける。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
const TEXT_EXT = /\.(css|js|mjs|json|html|svg|txt)$/i;

function contentForHash(pathFromRoot) {
  const buf = readFileSync(join(ROOT, pathFromRoot));
  if (!TEXT_EXT.test(pathFromRoot)) return buf;
  return Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

export function versioned(pathFromRoot) {
  if (!cache.has(pathFromRoot)) {
    const hash = createHash("md5").update(contentForHash(pathFromRoot)).digest("hex").slice(0, 8);
    cache.set(pathFromRoot, pathFromRoot + "?v=" + hash);
  }
  return cache.get(pathFromRoot);
}
