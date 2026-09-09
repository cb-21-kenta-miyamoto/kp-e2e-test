# kp-e2e-test

kpiee の改修に対して **E2E テストのケースを作り、実施し、記録する**ための skill 群。

改修ごとに散らばるもの（設計書 / 実装 PR / テストケース / spec / 証跡 / 実施記録 / NG）を、
**ケースID を軸に一本の線でつなぐ**のがねらい。

大元の方針は [dx-kpiee#18521](https://github.com/f-scratch/dx-kpiee/issues/18521)。
この repo はそれを skill として手順化したもの。**方針が変わったら #18521 が正で、ここを追随させる。**

## 全体の流れ

```
設計書 PR / 実装 PR
      │
      ▼
① e2e-case-create   テスト観点・ケースを作る            → kpiee-designs に PR
      │
      ▼
② e2e-case-review   ケースをレビューして承認する        → 承認管理シートに記録
      │
      ▼
③ e2e-prepare       前準備                            → Drive フォルダ / スプレッドシート / Spec PR の箱
      │
      ▼
④ e2e-execute       ブロック単位で実施する（並列）      → 証跡を Drive へ / 実施記録をシートへ / spec を PR へ push
      │
      ▼
⑤ e2e-ng-report     NG を切り分けて issue にする       → dx-kpiee に issue
```

**③ までは 1 回だけ・並列にしない。④ だけがブロック単位で並列に走る。**
共有ファイルを ③ で確定させ、④ ではブロック固有のファイルしか触らせないため。

## skill

| skill | いつ使うか |
| --- | --- |
| [`e2e-case-create`](./skills/e2e-case-create/SKILL.md) | 設計書 PR からテスト観点・ケースを起こす |
| [`e2e-case-review`](./skills/e2e-case-review/SKILL.md) | 作ったケースをレビューして承認まで持っていく |
| [`e2e-prepare`](./skills/e2e-prepare/SKILL.md) | 実施の前準備（Drive / スプレッドシート / Spec PR の箱 / テストデータ）|
| [`e2e-execute`](./skills/e2e-execute/SKILL.md) | ブロック 1 つを spec 化して実施し、証跡と記録まで残す |
| [`e2e-ng-report`](./skills/e2e-ng-report/SKILL.md) | 落ちたケースを切り分けて GitHub issue にする |

## 場所（改修をまたいで固定のもの）

| もの | ID / リンク |
| --- | --- |
| Drive ルート | [AIテスト](https://drive.google.com/drive/folders/1dcSjLjztl1V4_ioQTsaj4I1g5OyqbZm2) |
| 実施記録のテンプレート | [【E2E】ケース一覧・実施記録](https://docs.google.com/spreadsheets/d/1ec120eoL-1MYHhmS2r-utYdm7l2GUIqMM6dsiB_dYPE/edit) — **4 タブ。改修ごとにコピーする**（本文では FMT と呼ぶ。Drive 上の名前は `【E2E】`）|
| NG 投稿の中間ブック | [【E2E】NG管理](https://docs.google.com/spreadsheets/d/1XN-cwiwbl22axv0vmzEhrXDAAr8bi9DDgy85SkVjDsg/edit) — **改修横断で 1 本** |
| 証跡アップロード | `dx-kpiee/e2e-test/scripts/upload-evidence.sh` |

**改修ごとのブックは FMT をコピーして作る。** コピーすると
`実施方法` / `サマリ`（事前準備チェックリスト込み）/ `ケース一覧・実施記録` / `ケース外のNG` が付いてくる。
**ブックを開いた人は、まず `実施方法` タブを読む。**

## references

| 文書 | 中身 |
| --- | --- |
| [`case-format.md`](./references/case-format.md) | テスト観点・ケースの書式（レイヤー / ブロック / ケース / 被覆表）|
| [`drive-and-sheets.md`](./references/drive-and-sheets.md) | Drive のフォルダ構成、Sheets の読み書き手順と壊し方 |
| [`evidence.md`](./references/evidence.md) | 証跡の命名規則と「代表証跡だけ置く」の考え方 |
| [`ng-form.md`](./references/ng-form.md) | NG フォームへの投稿 — 中間ブックと Apps Script、フォーム 25 項目と選択肢 |
| [`playwright-kpiee.md`](./references/playwright-kpiee.md) | kpiee で spec を書くときの落とし穴 |

## apps-script

| ファイル | 中身 |
| --- | --- |
| [`NGForm.gs`](./apps-script/NGForm.gs) | 【NG管理】ブックから NG フォームへ投稿する Apps Script。AI がシートに行を書き、人がチェックすると投稿される |

## 実績

| 改修 | ケース | 状態 |
| --- | --- | --- |
| `IMP_KP001350` レポートセルコメント | 524 件 / 25 ブロック | 準備中（IT 実施へ切り替え）。ケースはシートへ展開済み・共有ファイル確定済み。[ケース PR](https://github.com/f-scratch/kpiee-designs/pull/669) / [Spec PR](https://github.com/f-scratch/dx-kpiee/pull/18559) / [実施記録](https://docs.google.com/spreadsheets/d/1_DA3tEDA6txMiPX0jthQU9sUMjvluFDerTaN5-PDdQs/edit) |

**実施環境は `https://it.kpiee.xyz/dx/workspaces/149/reports`。**
ローカルで回した 450 件版の記録は [【旧・450件版】](https://docs.google.com/spreadsheets/d/1ComMteyOhzlEbdAqcThOretkb3UafPkylm103UfWk6w/edit) に残してある。
