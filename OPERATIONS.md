# 運用対応履歴

このファイルは、インフラ・ドメイン・DNS・サーバー設定など、サイト運用に関わる作業の事後記録を残す場所。
機能構想・実装案は `IDEAS.md` に記載する。

## 運用ルール

- 作業日・対象サイト・原因・対応内容・確認結果の順で記録する
- 今後の参考になる注意点があれば末尾に残す
- 削除せず、時系列で積み重ねる（新しいものを上に追加）

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
