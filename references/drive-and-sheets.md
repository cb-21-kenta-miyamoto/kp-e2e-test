# Drive と Sheets の扱い

## 認証

`gcloud` のユーザー認証を使う。Drive / Sheets の両方でこのトークン 1 本。

```bash
export PATH="/opt/homebrew/share/google-cloud-sdk/bin:$PATH"
gcloud auth print-access-token
```

切れていたら**本人がブラウザで**実行する。`--enable-gdrive-access` が要る
（既定スコープだけでは Sheets API が 403 になる）。

```bash
gcloud auth login --enable-gdrive-access
```

## Drive のフォルダ構成

ルートは **[AIテスト](https://drive.google.com/drive/folders/1dcSjLjztl1V4_ioQTsaj4I1g5OyqbZm2)**
（`1dcSjLjztl1V4_ioQTsaj4I1g5OyqbZm2`）。**改修IDごとにフォルダを切る。**

```
AIテスト/
├── 【FMT】ケース一覧・実施記録        ← スプレッドシートのテンプレート
├── README_フォルダ構成と命名規則.md
│
├── <改修ID> <機能名>/
│   ├── 【ケース一覧・実施記録】<改修ID> <機能名>   ← FMT のコピー
│   └── 証跡/                                     ← 画面収録
```

### 改修を始めるときの手順

1. `AIテスト/` 直下に `<改修ID> <機能名>/` を作る
2. その中に `証跡/` を作る
3. `【FMT】ケース一覧・実施記録` をコピーして `<改修ID> <機能名>/` に置き、改名する
4. サマリタブのリンク（設計 PR / 実装 PR / ケース PR / 実施方針 issue / 証跡フォルダ / spec PR）を埋める
5. テスト観点表からケースを「ケース一覧・実施記録」タブへ展開する

### ファイルのアップロード

`dx-kpiee/e2e-test/scripts/upload-evidence.sh`。共有リンクが標準出力に返る。

```bash
./e2e-test/scripts/upload-evidence.sh <file> <Drive 上のファイル名>
EVIDENCE_FOLDER_ID=<証跡フォルダのID> ./e2e-test/scripts/upload-evidence.sh <file> <name>
```

### フォルダの移動

**ファイル ID は変わらないので、移動してもリンクは生きる。**

```bash
curl -X PATCH -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{}' \
  "https://www.googleapis.com/drive/v3/files/<id>?addParents=<新>&removeParents=<旧>&supportsAllDrives=true"
```

## スプレッドシート

### タブ構成

| タブ | 1 行 = | 何を書くか |
| --- | --- | --- |
| **サマリ** | — | インプットのリンク / 成果物の置き場所 / 実施状況の集計 |
| **ケース一覧・実施記録** | 1 ケース | 全ケースを展開。**ケースに紐づく NG もここ** |
| **ケース外のNG** | 1 件 | **ケースに紐づかない NG。** 探索中や別作業で見つけたもの |

### ケース一覧・実施記録タブの列

```
5 行目  │ ケース定義 (A–I) │ 1回目実施 (J–P) │ 2回目実施 (Q–W) │ 最終実施 (X–AD) │
6 行目  │ レイヤー ブロック ケースID ケース名 確認観点 担保 優先度 IT実施 Playwright spec
        │ 実施開始日時 実施完了日時 確認者 合否 証跡 NG Issue 備考   × 3 回ぶん
7 行目  │ 記入例
8 行目〜│ ケース
```

| 列 | 決めごと |
| --- | --- |
| ケース定義（A–I）| **AI は書き換えない。** テスト観点表が正本 |
| `Playwright spec` | **「PR 番号 + ファイルパス」で書く。** 例 `#18559 e2e-test/tests/IMP_KP001350/SPEC-1.spec.ts` |
| `実施開始日時` | **そのケースにかかった実時間を測るためのもの。** spec を書き始めた時刻 |
| `実施完了日時` | OK / NG を判定した時刻。書式は `YYYY-MM-DD HH:MM` |
| `証跡` | Drive の共有リンク、または「`A-1` と同じ」 |
| `NG Issue` | NG のとき GitHub issue へのリンク |

### 読み書き — 壊さないための 3 つ

> [!IMPORTANT]
> **1. 読むときは `valueRenderOption=FORMULA` を付ける。**
> 既定の `FORMATTED_VALUE` で読んで書き戻すと、**集計数式と `HYPERLINK` が計算結果に
> 置き換わって壊れる。** 実際に 1 度壊した。

```bash
curl -H "Authorization: Bearer $T" \
  "https://sheets.googleapis.com/v4/spreadsheets/$BOOK/values/$RANGE?valueRenderOption=FORMULA"
```

> [!IMPORTANT]
> **2. 並列で書くときは「その行のセルだけ」を更新する。**
> 範囲まとめ書き（広い range への `values.batchUpdate`）は、
> 他のサブエージェントの書き込みを消す。

> [!IMPORTANT]
> **3. 行の特定はケースIDで行う。行番号をハードコードしない。**
> 行は増減する。書いたら同じ範囲を読み戻して確認する。

### よくつまずくところ

| 症状 | 原因 |
| --- | --- |
| `固定されている列と固定されていない列は結合できません` | `frozenColumnCount` が結合範囲の途中にある。先に固定を 0 にしてから結合する |
| 件数のセルが `0.00%` になる | 上の行のパーセント書式が伝播している。`numberFormat` を明示的に戻す |
| セル内の `**強調**` が生で出る | Sheets は markdown を解釈しない。装飾は `textFormat` で付ける |
| シート名を変えたら数式が壊れた…と思ったら壊れていない | `updateSheetProperties` での改名は**数式の参照を自動で追随させる** |

### 書き込みの承認

**スプレッドシートへの書き込みは AI が承認なしで直接行う**（dx-kpiee#18521 で決定）。
人間の承認を挟むのは **GitHub issue の起票**と**改修**だけ。
代わりに書き込んでよい列を上の表で固定している。
