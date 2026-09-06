---
name: e2e-execute
description: E2E のテストケースをブロック単位で実施するスキル。「SPEC-1 のテスト実施して」「このブロック回して」「E2E 流して」で起動する。担当ブロックの spec を書き、実行し、証跡を Drive へ上げ、実施記録をスプレッドシートへ書き、spec を PR へ push するまでを 1 サイクルとして回す。サブエージェントが 1 体 = 1 ブロックで並列に走る前提。触ってよいのは自分のブロックのファイルだけ。
---

# e2e-execute

## 概要

**1 サブエージェント = 1 ブロック**で回す実施のループ。

**触ってよいのは `tests/<改修ID>/<ブロックID>.spec.ts` だけ。**
共有ファイル（config / page-object / api-client / fixtures）は `e2e-prepare` で確定済み。
足りなければ**親へ依頼**し、自分で直さない。

## いつ使うか

- `e2e-prepare` が終わって、ブロックを実施するとき

## 前提の確認（最初にやる）

| 確認 | やり方 |
| --- | --- |
| 対象環境に実装がデプロイされているか | ローカルなら feature ブランチが checkout され、サーバーがそれを配っているか |
| ケースの前提データがあるか | 準5 で用意した専用データ |
| `.env` の向き先 | ローカル / IT。IT なら「IT実施」列に `●` のケースだけ |

## ループ

```
① spec を書く              担当ブロックの <ブロックID>.spec.ts だけ
        ↓
② 実行                     pnpm exec playwright test --project=<改修ID> --grep "<ブロックID>"
        ↓
③ results.json を読む       ケースID・合否・添付パス
        ↓
④ 証跡を Drive へ           OK は群ごとに代表 1 本 / NG は 1 件ずつ
        ↓
⑤ 実施記録を書く            ケースIDで行を引き当て、その行のセルだけ更新
        ↓
⑥⑦ NG があれば              e2e-ng-report へ
        ↓
⑧ spec を PR へ push       1 ブロック 1 コミット。push 前に git pull --rebase
```

### ① spec を書く

**1 test() = 1 ケース。title 先頭にケースIDを置く。**

```ts
test("[A-1] 本文セルにテキストのみのコメントを投稿する", async ({ page }) => {
  test.info().annotations.push({ type: "block", description: "SPEC-1" });
});
```

- ケース群（`A.` 〜）ごとに `test.describe` でまとめる
- 前提データは `beforeAll` で API から seed する
- **状態が残る機能なら `beforeAll` で消す前処理を入れる**
- **ケースごとに対象を分ける**（同じセル・同じレコードを使い回さない）

kpiee 固有の落とし穴は [`references/playwright-kpiee.md`](../../references/playwright-kpiee.md)。
**先に読む。** Handsontable のペイン、アクセシブル名の実測、前処理あたりで必ず一度は詰まる。

> [!IMPORTANT]
> **アクセシブル名は i18n から推測せず、実測する。**
> `aria-label` が効いておらず可視テキストが名前になっていることがある。
> 探索用の spec で `innerText` を吐かせてから書く。

### ③ results.json を読む

**目で読まない。** JSON reporter の出力からケースID・合否・添付パスを取る。

### ④ 証跡

命名と代表証跡の考え方は [`references/evidence.md`](../../references/evidence.md)。

```bash
./e2e-test/scripts/upload-evidence.sh <video.webm> OK_<改修ID>_<ケースID>_<ケース名>_<YYYYMMDD>.webm
```

### ⑤ 実施記録

手順と壊さないための注意は [`references/drive-and-sheets.md`](../../references/drive-and-sheets.md)。

| 書く列（該当する実施回の中で）| 内容 |
| --- | --- |
| 実施開始日時 | **spec を書き始めた時刻**（`YYYY-MM-DD HH:MM`）|
| 実施完了日時 | OK / NG を判定した時刻 |
| 確認者 | `AI (Playwright)` |
| 合否 | `OK` / `NG` / `ブロックのため未実施` / `対象外` |
| 証跡 | Drive のリンク、または「`A-1` と同じ」 |
| NG Issue | NG のとき issue のリンク |
| Playwright spec | **`#<PR番号> <ファイルパス>`** |

> [!IMPORTANT]
> - **ケース定義列（A–I）は書き換えない。** テスト観点表が正本
> - **その行のセルだけを更新する。** 範囲まとめ書きは他エージェントの書き込みを消す
> - **読むときは `valueRenderOption=FORMULA`。** 既定で読んで書き戻すと数式が壊れる
> - **承認は不要。** 直接書き込む

### ⑧ push

- 1 ブロック 1 コミット
- push 前に `git pull --rebase`
- **ファイルが分かれているので衝突しない。** 衝突したら共有ファイルを触っている

## 実施できないケースの扱い

| 状況 | 合否 | 備考に書くこと |
| --- | --- | --- |
| 別ユーザー / 権限設定が要る | `ブロックのため未実施` | 何が足りないか |
| 環境（IT / 本番相当データ）が要る | `ブロックのため未実施` | どの環境が要るか |
| 設計で対象外と決まっている | `対象外` | 設計書の該当節 |

**落ちたら止めずに続ける。** 記録して次へ。まとめて起票する。

## やらないこと

- **共有ファイルを勝手に直さない。** 親へ依頼する
- **URL を貼る前に開かずに済ませない。** `gh api repos/.../contents/<path>?ref=<branch>` で 200 を確認する
- **落ちた原因をプロダクトの不具合と決めつけない。** → `e2e-ng-report`

## 次にやること

NG があれば [`e2e-ng-report`](../e2e-ng-report/SKILL.md)。
無ければ親へ「ブロック完了」と件数を返す。
