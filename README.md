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

## references

| 文書 | 中身 |
| --- | --- |
| [`case-format.md`](./references/case-format.md) | テスト観点・ケースの書式（レイヤー / ブロック / ケース / 被覆表）|
| [`drive-and-sheets.md`](./references/drive-and-sheets.md) | Drive のフォルダ構成、Sheets の読み書き手順と壊し方 |
| [`evidence.md`](./references/evidence.md) | 証跡の命名規則と「代表証跡だけ置く」の考え方 |
| [`playwright-kpiee.md`](./references/playwright-kpiee.md) | kpiee で spec を書くときの落とし穴 |

## 実績

| 改修 | ケース | 状態 |
| --- | --- | --- |
| `IMP_KP001350` レポートセルコメント | 450 件 / 17 ブロック | SPEC-1 A 群まで実施（OK 4 / NG 2）。[ケース PR](https://github.com/f-scratch/kpiee-designs/pull/669) / [Spec PR](https://github.com/f-scratch/dx-kpiee/pull/18559) / [実施記録](https://docs.google.com/spreadsheets/d/1ComMteyOhzlEbdAqcThOretkb3UafPkylm103UfWk6w/edit) |
