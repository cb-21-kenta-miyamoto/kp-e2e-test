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

## Handsontable（レポートの表）

> [!IMPORTANT]
> **固定行・固定列は別ペインへ複製されて重なる。**
> `td` を素で拾うとクローンに覆われてクリックが奪われ、
> `subtree intercepts pointer events` で落ちる。

```ts
const PANE = {
  master: ".ht_master",            // 本文セル
  left: ".ht_clone_inline_start",  // 固定列（軸ラベル / 表側）
  top: ".ht_clone_top",            // 固定行（表頭 / ヘッダー）
} as const;

const cells = table.locator(`${PANE.left} td`);
```

- レポート表本体は `data-testid="report-table"`
- 仮想スクロールで画面外の行は DOM に無い。`scrollIntoViewIfNeeded()` を挟む

## ロケータ

**`data-testid` はレポート側にはあるが、`shared/components/Comment/` には 1 つも無い。**
文言依存になるので、変わりやすい箇所は testid 追加 PR を切る判断をする。

| 対象 | 取り方 |
| --- | --- |
| レポート表 | `getByTestId("report-table")` |
| 右クリックメニュー | `page.locator("[class*=context]")` の可視なもの |
| コメント入力欄 | `getByLabel("コメント本文")`（contenteditable）|
| 送信ボタン | `getByRole("button", { name: "コメント", exact: true })` |
| コメントの印 | セルの class `kp-cell-comment-unresolved` / `kp-cell-comment-resolved` |

> [!NOTE]
> **送信ボタンのアクセシブル名は可視テキストの「コメント」。**
> i18n の `composer.submit_button_label`（「コメントを送信」）は aria-label として効いていない。
> **アクセシブル名は i18n から推測せず、実測する。**

## 状態が残るテストは前処理で消す

> [!IMPORTANT]
> セルコメントには「1 セルにつき未解決スレッドは 1 つ」の制約がある。
> **前のテストのスレッドが残っていると、2 回目の実行が「新規投稿」ではなく「返信」になり、
> ケースの前提が壊れる。**

```ts
async function clearAllThreads(request: APIRequestContext) {
  const base = `/g/dxkp/api/v1/workspaces/${WS}/reports/${REPORT}/comment_threads`;
  for (let p = 1; p <= 30; p++) {
    const res = await request.get(`${base}?page=${p}`);
    if (!res.ok()) return;
    const d = await res.json();
    for (const t of d.threads ?? []) {
      const root = (t.entries ?? []).find((e: any) => e.action_type === "comment");
      if (root) await request.delete(`${base}/${t.id}/comments/${root.id}`);
    }
    if (p >= (d.pagination?.max_page ?? 1)) break;
  }
}
test.beforeAll(async ({ request }) => { await clearAllThreads(request); });
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
