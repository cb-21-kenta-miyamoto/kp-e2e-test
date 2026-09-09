# kpiee で spec を書くときの落とし穴

**この文書は「1 ブロック目を実際に流して初めて分かったこと」を溜める場所。**
ケースを書いた段階では分からない。新しく踏んだら追記する。

## 環境

`dx-kpiee/e2e-test` に Playwright + Page Object の土台がある。

```bash
cd dx-kpiee/e2e-test
cp .env.sample .env      # E2E_TEST_EMAIL / E2E_TEST_PASSWORD を埋める
pnpm install && pnpm exec playwright install
pnpm exec playwright test --project=<改修ID>
```

- `tests/auth.setup.ts` が `globalSetup` で `POST /ajax/auth/sign_in` を叩き、
  `playwright/.auth/user.json` に storageState を保存する。**パスワードを画面に打つ必要はない**
- `.env` の `E2E_TEST_BASE_URL` / `E2E_TEST_ACCOUNT_ID` を切り替えるだけで
  ローカル / IT / STG へ向き先が変わる（`.env.sample` にコメントで用意されている）
- **CI も同じことをしている**（`.github/workflows/check-e2e-integration.yml`）。
  IT へはローカルから到達できる（VPN も IP 制限も無い）
- **実施したい実装が対象環境にデプロイされているかを先に確認する。**
  IT は `test/it-YYYYMMDD` を手動でデプロイする運用で、feature ブランチは載っていないことがある

## 対象環境にデプロイされているかを、ログインせずに確かめる

**IT は `test/it-YYYYMMDD` を手動でデプロイする運用で、feature ブランチは載っていないことがある。**
実施前に確認する。ログインも認証も要らない。

```bash
# ① SPA のエントリバンドルを取って、i18n の文言があるか見る
curl -s https://it.kpiee.xyz/dx/workspaces/<ws>/reports | grep -o 'src="/dx/assets/[^"]*"'
curl -s https://it.kpiee.xyz/dx/assets/index-XXXX.js | grep -c "セルにコメント"

# ② API のルートがあるかを 401 / 404 で切り分ける
curl -s -o /dev/null -w "%{http_code}" https://it.kpiee.xyz/g/dxkp/api/v1/workspaces/<ws>/reports/1/comment_threads
```

| 結果 | 意味 |
| --- | --- |
| バンドルに文言がある | **フロントは載っている** |
| `401` | **バックエンドのルートは載っている**（認可で弾かれただけ）|
| `404` | ルートが無い = **まだデプロイされていない** |

> [!NOTE]
> **class 名や API パスはエントリバンドルに出ない。** コンポーネントは遅延チャンク側なので、
> エントリを grep しても 0 件になる。**i18n の文言で判定する**（文言はエントリに入る）。

## Handsontable（レポートの表）

> [!IMPORTANT]
> **固定行・固定列は別ペインへ複製されて重なる。**
> `td` を素で拾うとクローンに覆われてクリックが奪われ、
> `subtree intercepts pointer events` で落ちる。

```ts
const PANE = {
  master: ".ht_master",                            // 本文セル
  left: ".ht_clone_inline_start",                  // 固定列（軸ラベル / 表側）
  top: ".ht_clone_top",                            // 固定行（表頭 / ヘッダー）
  corner: ".ht_clone_top_inline_start_corner",     // 表の左上隅（コメントできない）
} as const;

const cells = table.locator(`${PANE.left} td`);
```

- レポート表本体は `data-testid="report-table"`
- 仮想スクロールで画面外の行は DOM に無い。`scrollIntoViewIfNeeded()` を挟む

## ロケータ

**`data-testid` はレポート側にはあるが、`shared/components/Comment/` には 1 つも無い。**
ただし**代わりに使える class 定数がコード側にある**ので、文言依存で書く必要はない。
`shared/domains/comment.ts` と `features/reports/domains/reportCellComment.ts` が
`kp-comment-*` / `kp-cell-comment-*` を定数として持っている。**testid が無い = 文言依存、ではない。**

> [!IMPORTANT]
> **ロケータは実装から採る。i18n から推測しない。**
> 文言は `locales/features/reports.ts` の `reports.comment.*`、
> class は上の 2 ファイル。**探索用 spec を書く前に、まずこの 3 ファイルを読むほうが速い。**

| 対象 | 取り方 | 根拠 |
| --- | --- | --- |
| レポート表 | `getByTestId("report-table")` | — |
| **セルの右クリックメニュー** | `.context-menu-popover` | `KpMenuPopover` の `custom-class` |
| 印にホバーしたときのメニュー | `.kp-cell-comment-context-menu` | `CellCommentContainer.vue` |
| コメント入力欄 | `getByLabel("コメント本文")` / `.kp-comment-editor` | `role="textbox"` + `aria-label` |
| 送信ボタン | `getByRole("button", { name: "コメント", exact: true })` | 可視テキスト |
| スレッドの吹き出し | `.kp-comment-thread-popover` | `COMMENT_THREAD_POPOVER_CLASS` |
| コメント一覧サイドバー | `.kp-comment-list-sidebar` | `COMMENT_LIST_SIDEBAR_CLASS` |
| 一覧の検索欄 | `input[name="kp-comment-search"]` | `CommentListSidebar.vue` |
| 発言単位のケバブ | `.kp-comment-kebab-trigger` | `CommentThreadItemMenuButton.vue` |
| スレッドヘッダーのケバブ | `.kp-comment-header-kebab-trigger` | `CommentThreadHeaderActions.vue` |
| ケバブのメニュー本体 | `[class*="kp-comment-header-menu-"]` | インスタンスIDが付くので前方一致 |
| 削除の確認 | `getByRole("dialog", { name: "本当にこのコメントを削除しますか？" })` | `role="dialog"` + `aria-label` |
| コメントの印 | セルの class `kp-cell-comment-unresolved` / `-resolved` | `REPORT_COMMENT_MARKER_CLASS` |

> [!NOTE]
> **送信ボタンのアクセシブル名は可視テキストの「コメント」。**
> i18n の `composer.submit_button_label`（「コメントを送信」）は
> `KpButton` の prop に渡されており、内側の `button` へ `aria-label` として降りていない。
> **`KpButton` に aria-label を渡している箇所は全部これを疑う。**

### 実装から採った定数

| もの | 値 | 出どころ |
| --- | --- | --- |
| 本文の最大文字数 | **1,000 文字** | `COMMENT_BODY_MAX_LENGTH` |
| 1 スレッドの発言数上限 | **100 件**（起点を含む）| `COMMENT_THREAD_MAX_COMMENT_COUNT` |
| 一覧の 1 ページ | **20 スレッド固定** | API の `page` パラメーターの説明 |
| API 側の本文上限 | 65,535 **バイト** | `CreateReportCommentThreadBody` |

**フロント 1,000 文字と API 65,535 バイトはわざとずれている。** 画面のケース（SPEC-1 G 群 /
NFR-2 A 群）は 1,000、API のケース（MB-2 A 群）は 65,535 で書く。**片方の値で両方を書かない。**

> [!IMPORTANT]
> **権限が無いとき「セルにコメント」は消えず、非活性で出る。**
> `useReportCellCommentMenu` は `isDisabled` を付けて項目を残し、
> ツールチップに「コメントの操作権限がないため、\nコメントできません。」を出す。
> **「メニューに出ないこと」を期待値にすると落ちる。**

## API を叩くときのエンドポイント

```
GET    /g/dxkp/api/v1/workspaces/{ws}/reports/{id}/comment_threads       ① 一覧
POST   /g/dxkp/api/v1/workspaces/{ws}/reports/{id}/comment_threads       ② 作成
GET    .../comment_threads/{tid}                                          ③ 単体
PATCH  .../comment_threads/{tid}                                          ④ 解決 / 再開
POST   .../comment_threads/{tid}/comments                                 ⑤ 返信
PATCH  .../comment_threads/{tid}/comments/{cid}                           ⑥ 編集
DELETE .../comment_threads/{tid}/comments/{cid}                           ⑦ 削除
GET    /g/dxkp/api/v1/workspaces/{ws}/reports/{id}/table_data            行ID・列IDを引く
```

> [!WARNING]
> **タイムラインの発言判定は `event_type`。`action_type` は v1 モデルの名前。**
> `action_type` だけを見る前処理は 1 件も消せず、**エラーも出さずに「何もしない」。**
> 前処理が空振りしていると、次の実行が「新規投稿」ではなく「返信」になって
> ケースの前提が壊れる。**両方を見るか、消えた件数をログに出して確かめる。**

**`table_data` で行ID・列IDが引ける。** これがあると seed を画面操作なしで作れるので、
大量スレッド（NFR-1）やページ境界（NFR-2 D 群）は API だけで用意できる。

## 状態が残るテストは前処理で消す

> [!IMPORTANT]
> セルコメントには「1 セルにつき未解決スレッドは 1 つ」の制約がある。
> **前のテストのスレッドが残っていると、2 回目の実行が「新規投稿」ではなく「返信」になり、
> ケースの前提が壊れる。**

```ts
import { ReportCommentApiClient } from "../../api-clients/report-comment.api";

test.beforeAll(async ({ request }) => {
  const api = new ReportCommentApiClient(request, { workspaceId: WS, reportId: REPORT });
  const deleted = await api.clearAllThreads();
  console.info(`[前処理] ${deleted} 件消した`);   // ★消えた件数を出す。0 なら空振りを疑う
});
```

**API を叩ける `request` fixture は storageState を引き継ぐ**ので、前処理・seed に使える。

## 並列で走らせるとき

| 論点 | 決めごと |
| --- | --- |
| **テストデータの分離** | **ブロックごとに専用のレポートを用意する。** 同じセルを別のエージェントが触ると互いのテストを落とす |
| ブロック内 | 同じレポートを共有するので `test.describe.configure({ mode: "serial" })` にするか、ケースごとに対象セルを分ける |
| ファイル | 触ってよいのは `<ブロックID>.spec.ts` だけ。共有ファイルは前準備で確定させる |

> [!WARNING]
> **同じセルを別のエージェントが触って落ちた失敗は「プロダクトの不具合」に見える。**
> ファイルや push の衝突は git で気づけるが、これは気づけない。存在しない不具合を追うことになる。

## スクリーンショット比較

既存の `reports.spec.ts` は `toHaveScreenshot` を使っていて、スナップショットが
`-linux`（CI）と `-darwin`（ローカル Mac）で分かれている。
**新しいケースではスクリーンショット比較を使わない**ほうが無難。
