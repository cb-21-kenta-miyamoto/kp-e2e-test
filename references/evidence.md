# 証跡

## 何を残すか

| 担保 | 証跡 |
| --- | --- |
| 自動E2E | Playwright の `video: "on"` が出す `video.webm` + `trace.zip` |
| API | **動画は撮らない**（意味のない黒画面になる）。応答の記録のみ |
| 手動E2E | 通し 1 本の画面収録 |
| 単体 | 不要（CI で担保）|

## 命名

Drive の既存ファイルから読み取った規則に揃える。**新しい規則を作る前にフォルダの中身を見る。**

| 種別 | 形 | 例 |
| --- | --- | --- |
| NG（不具合の再現） | `NG_PR<PR番号>_<機能>_<症状>_<YYYYMMDD>.<ext>` | `NG_PR18483_レポートセルコメント_値のないセルで投稿失敗_20260904.mp4` |
| OK（ケースの実施証跡） | `OK_<改修ID>_<ケースID>_<ケース名>_<YYYYMMDD>.<ext>` | `OK_IMP_KP001350_A-1_本文セルに投稿_20260906.webm` |

`<ケースID>` はテスト観点表のケースIDと一致させる。

## 代表証跡だけ置く

**OK 証跡は全ケース分を置かない。**

- ケース群（`A.` 〜）ごとに**代表 1 件**だけ Drive へ置く
- 残りは実施記録の証跡列に「`A-1` と同じ」と書く

**1 ケース通っていれば同じ群の他ケースも基本は正しい**ので、
数百本の動画を保管する意味がない。

**NG 証跡は 1 件ずつ置く。** GitHub issue から参照するため。

## ケースIDと証跡を自動で紐づける

test の title 先頭にケースIDを置く。出力ディレクトリ名にケースIDが入るので、
`test-results/<slug>/video.webm` から機械的に対応が取れる。

```ts
test("[A-1] 本文セルにテキストのみのコメントを投稿する", async ({ page }) => {
  test.info().annotations.push({ type: "block", description: "SPEC-1" });
});
```

## 結果を機械可読で受ける

**JSON reporter が無いと、AI が結果を目で読むことになって数百件でスケールしない。**

```ts
// playwright.config.ts
reporter: [["html"], ["json", { outputFile: "results.json" }]],
use: { video: "on", trace: "on", screenshot: "only-on-failure" },
```
