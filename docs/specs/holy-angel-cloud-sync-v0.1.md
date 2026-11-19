# 聖天使の神託｜共有保存の安全設計 v0.1（第13工程）

記録日：2026-10-12／担当：ネネ。**これは設計審査資料。Cloudflare作成・接続・デプロイ・本番マージの許可ではない。**

## 目的と絶対条件
- GitHub Pagesの静的編集画面から、別端末で同じ育成計画・実績を保存し直せる。毎回の自動同期や複数人でのリアルタイム編集は行わない。
- 「計画の予測」と「本人が確認した実際のガチャ実績」は独立の意味を持つ。実績イベントでのみ所持在庫を更新。旧v1計画・旧v2実績の保存キーを変更しない。現行v3統合データを送受信する。
- **Workers Free + D1 Freeのまま運用し、月額の追加費用0円を優先。** 勝手にWorkers Paid・他の有料商品へアップグレードしない。
- 開発・DB作成/外部設定・本番公開は別々の明示承認。今回のPR #2はDraftで、既存ページを変更しない。

## 最新の無料利用枠（公式・2026-10-12時点）
| 項目 | Workers Free / D1 Free |
| --- | --- |
| Workers | 100,000 requests/day、CPU 10ms / request |
| D1 read | 5,000,000 rows/day |
| D1 write | 100,000 rows/day |
| D1 account storage | 5GB total |
| D1 per database | 500MB、Free最大10 DB |
| D1 Time Travel | 7 days |

参照：
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
**Free上限を超えるとD1はエラーになり、保存済みデータは保持される**（Cloudflareが2026年9月1日に明示）。保存失敗時に成功扱いしない。無料枠でも可用性は保証されない。WorkersのCPU 10ms制限を考え、確率計算は原則**ブラウザ内**で行い、APIは認証・検証・保存のみに絞る。

## データと権限
- 1ワークスペース＝D1の1行。公開しない長いランダム `workspace_id` と編集秘密トークン（少なくとも256ビットの暗号学的乱数）を別々に発行。**推測できる数値や時刻から作らない。**
- 編集リンク例（形だけ）`https://memento.musoudc.com/pages/.../holy-angel.html#id=...&token=...`。秘密部分は`#`の後ろ。通常のHTTPリクエストには含まれない。ただし、画面内JSからは読めるため広告・解析・未審査の外部JSは置かない。
- ブラウザは編集API呼出し時だけ `Authorization: Bearer <token>` にセット。トークンをAPIのURL、クエリ、リファラ、console.log、例外レポートに出さない。
- D1には編集トークンの**平文を保存せずSHA-256ハッシュのみ**格納。サーバーは毎API操作で権限を検査。CORS（許可Originを固定）は補助であり、認証そのものではない。正規化/長さ/版/数値/重複イベント/実績整合を**サーバー側でも検査**。認証なし／不正トークンは同様の応答として存在を漏らしにくくする。
- 画面への `Content-Security-Policy`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` を検討し、正式な配信経路で適用と動作を検証。CSPで秘密編集トークンを読める第三者スクリプトを入れない。アクセスできる人は編集できることを明記し、URLの共有に注意を促す。
- 無料のCloudflare Turnstileは**ワークスペース新規作成フォームのみ**を候補。サーバーでSiteverifyを必須とする。編集画面にはTurnstileを含めサードパーティのJSを無断追加しない。Rate Limiting bindingは近似的な防御であり、厳密な上限/会計制御ではないため、作成件数・1件の容量・ルート別制限を重ねる。
  - https://developers.cloudflare.com/turnstile/plans/
  - https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
  - https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## 保存とAPIの最小構成（設計上の提案。未実装）
`POST /api/v1/workspaces`：新規作成。認証なし作成には作成回数制限とTurnstile（サーバー検証）を適用。作成時に一度だけ編集トークンを返す。

`GET /api/v1/workspaces/:id`：編集トークンを確認して `revision, document` を返す。

`PUT /api/v1/workspaces/:id`：`expectedRevision` とv3 documentを受ける。**原子的なDB条件付き更新**を行い、`meta.changes === 1` の時だけ `{ revision: old+1 }` で成功返答。更新なしなら409 Conflict、クライアントの未保存内容を消さない。**ローカルなv3 document.revisionと、サーバーのremoteRevisionは別物**として管理する。

`DELETE /api/v1/workspaces/:id`：本人の編集権限と最新revisionを確認して削除・編集リンク失効（詳細設計と認証試験必須）。

概念的なD1スキーマ（導入前にSQL移行を独立検収）：
```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  edit_token_hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  remote_revision INTEGER NOT NULL DEFAULT 0 CHECK(remote_revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

```sql
UPDATE workspaces
SET document_json = ?, remote_revision = remote_revision + 1, updated_at = ?
WHERE id = ? AND edit_token_hash = ? AND remote_revision = ? AND deleted_at IS NULL;
```
**SELECTして確認してから無条件UPDATEする2操作は、同時更新に弱いので採用しない。** `UPDATE ... WHERE remote_revision = ?` の結果を検査して認可された変更だけ成功扱いする。リトライで応答不明なときは再GETで内容を確認し、自動上書きしない。長いログを丸ごと何度も保存する仕様が容量上限に近づく場合は、保存を止めてバックアップと整理を案内する。

## データ上限・料金事故防止
- 初期設計案：1つの保存データ **64,000バイト以内（UTF-8バイト長）**、保存計画最大8件、実績最大300件。無効な数値やJSONも明示拒否。変更頻度は利用者の「保存」ボタン、読み込みはページ起動時・手動更新時のみ。自動で毎秒ポーリングしない。
- API要求のサイズ検査は本文全読込より**前**にContent-Length確認、本文の実バイト長も再確認。最大利用数に達したら無料枠のエラー表示。「保存できませんでした／この端末のみ／ファイルに保存」の案内を表示し、**「同期済み」と表示しない**。
- データ取得・保存のD1アクセスはインデックスや主キーで最少行にする。Cloudflareダッシュボードの利用状況を公開後に確認する。攻撃対策はRate Limiting binding単独に依存しない。

## 復元（最も危険な箇所）
- 利用者の**ファイルへの書出し→読み込み→新規ワークスペース/新リンク**を個別救済の優先手段にする。秘密編集リンクを紛失すると元ワークスペースの再認証は原則できない。利用者の自力復元案内を用意。
- D1のTime TravelはFreeで7日あるが、**データベース全体の状態を過去に上書きする破壊的な操作**。1人の失敗を救済する目的で無断実行すると、他の人の最近の保存まで失われ得る。**公開データベースへ勝手にTime Travel restoreしない。** 管理者事故時の復旧は別のバックアップ・隔離環境・影響調査と本人承認を必要とする。
- GitHubのコード差分の戻し方と、D1にある利用者実績を戻す方法は別途検証する。
- https://developers.cloudflare.com/d1/reference/time-travel/

## 公開前のテストと停止条件
- PCで新規リンク発行 → スマホで開き編集保存 → PCで更新確認。
- A端末がrevision 1を読んだ後、B端末がrevision 2を保存 → A端末のrevision 1からの上書きは**409**。双方の変更とローカル控えが残る。
- 期限切れ／不正／失効した編集トークンは読み込み・保存・削除不可。他ユーザーのデータは閲覧不可。
- ネット切断、D1の無料枠超過、409、保存応答が不明、入力データ64,000バイト超、予期しない形式への読み込みで**データ欠損なし**。
- ファイルを退避→元の編集リンク消失→新リンク発行→取り込み→保存→別端末で再確認。
- 削除・失効前後の編集可否と、元データに残る実績の扱いを検査。
- 既存育成計画/実績の保存キーには書き込まない。本番マージ・Cloudflare資源作成・課金を伴う操作は**ユーザーの明確な別承認後**。

**2026-10-12の判定：無料構成の設計は妥当。ただしAPIとD1実体の動作・安全性・復元は未検証。まだ公開不可。**
