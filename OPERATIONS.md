# 運用対応履歴

このファイルは、インフラ・ドメイン・DNS・サーバー設定など、サイト運用に関わる作業の事後記録を残す場所。
機能構想・実装案は `IDEAS.md` に記載する。

## 運用ルール

- 作業日・対象サイト・原因・対応内容・確認結果の順で記録する
- 今後の参考になる注意点があれば末尾に残す
- 削除せず、時系列で積み重ねる（新しいものを上に追加）

## リポジトリ運用ルール

- リポジトリの正はpublish側。Git管理・commit・pushはすべて `_publish_soltina` で行う。ルート側は非Git管理の作業コピーであり、`.git` を作成しない。
- 同期フローは、ルートで開発、publish側へコピー、`diff` またはSHA256で一致確認、publish側でcommitの順とする。
- commitはファイル明示指定のみ。`git add .` は禁止し、`git add <対象ファイル>` で対象を列挙する。commit前に `git diff --cached --name-status` でstage対象が意図した数と一致することを確認する。
- push前QAを必須とする。commit後、pushの前にシオンのQAと夢爽の公開承認を得る。例外は夢爽が明示的に「QA省略で公開まで」と指示した場合のみ。
- 1タスク1commit。無関係の変更を同一commitに混ぜない。

---

## ファイル構成ルール（2026-07策定）

- 公開HTMLツールの正本は `_publish_soltina/` 配下。ここがGit管理・公開の実体。
- 作業ルート直下の同名HTMLはGit管理外のローカルコピー。存在しても正とみなさない。
- 迷ったら「Gitに入っている方が正」。
- ミコト（Codex）向けの作業規約はリポジトリ直下の `AGENTS.md` に記載。
  規約を変更した場合は AGENTS.md 側も必ず更新すること。

---

## 2026-06-19 slot-tools.jp HTTPS化対応

原因：
GitHubアカウント単位のドメイン所有権検証（Verified domains）が未完了だったため。

対応内容：
1. `github.com/settings/pages` → Add a domain → `slot-tools.jp`
2. 発行されたTXTレコードをお名前.comのDNS設定に追加
3. GitHub側で Verify 成功
4. `slot-tools/settings/pages` で Enforce HTTPS 有効化
5. `https://slot-tools.jp/` で保護接続を確認

今後の参考：
GitHub Pagesでカスタムドメインを使う際は、Aレコードに加えて account-level の Verified domains 設定も必須。
