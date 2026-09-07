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
├── 【FMT】ケース一覧・実施記録        ← テンプレート（1ec120eoL-1MYHhmS2r-utYdm7l2GUIqMM6dsiB_dYPE）
├── 【E2E】NG管理                      ← 改修横断で 1 本（1XN-cwiwbl22axv0vmzEhrXDAAr8bi9DDgy85SkVjDsg）
├── README_フォルダ構成と命名規則.md
│
├── <改修ID> <機能名>/
│   ├── 【E2E】ケース一覧・実施記録_<改修ID> <機能名>   ← FMT のコピー
│   └── 証跡/                                          ← 画面収録
```

> [!WARNING]
> **Drive は同名のファイル・フォルダを許す。** 作る前に既にあるかを必ず確認する。
> 実際に README と証跡フォルダを二重に作った。移動は
> `addParents` / `removeParents` でファイル ID を保ったまま行う（作り直さない）。

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

**4 タブ。** FMT をコピーすればこの構成になる。

| タブ | 1 行 = | 何を書くか |
| --- | --- | --- |
| **実施方法** | — | **★最初に読む。** 読む順序 / 記入ルール / 合否の 5 種類 / NG のときの動き / やってはいけないこと |
| **サマリ** | — | インプットのリンク / 成果物の置き場所 / **事前準備チェックリスト** / 実施状況の集計 |
| **ケース一覧・実施記録** | 1 ケース | 全ケースを展開。**ケースに紐づく NG もここ** |
| **ケース外のNG** | 1 件 | **ケースに紐づかない NG。** 探索中や別作業で見つけたもの |

### サマリタブの「■ 事前準備」

**人が手で作ったものを、実施する側が特定できる形で残す欄。**
用意したかどうかだけでは足りず、**どの環境のどのワークスペースに、どんな名前で**作ったかが要る。

| 列 | 内容 |
| --- | --- |
| 用意するもの / リンク / 手順 | FMT に既に入っている（改修ごとに足し引きする）|
| **区分** | `A 手動`（画面の外に出る）/ `B 自動`（セットアップ spec）/ `前提整備` |
| **環境・ワークスペース（URL）** | ワークスペースの URL を貼る。**URL 1 本で環境とワークスペースID が一意に決まる**。既定を節の先頭で 1 回宣言し、違う行だけ書く |
| **作った名称 / ID** | 実際に作ったユーザーのメールアドレス、レポートの表示名など |
| **完了** | チェックボックス。人が作り終えたら入れる |

**区分A が終わらないと、権限が絡むケースが全ブロックで止まる。**
実際に SPEC-1 の `A-4` / `A-5` が「他人の発言に対する活性制御」で止まった。

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

> [!IMPORTANT]
> **4. タブを作り直すときは、まず消してから一括で書く。**
> `A1` → `A38` → `A46` と**継ぎ足しで書くと、前の版の行が残って新しい節見出しと衝突する。**
> 実際に「使い方」タブを崩した。`values:clear` + 書式リセット（`userEnteredFormat: {}` と
> `unmergeCells`）をしてから 1 回で書く。

> [!IMPORTANT]
> **5. 書いたら `#ERROR!` を機械で走査する。**
> 目視では取りこぼす（5 か所のうち 2 か所を見落とした）。
>
> ```python
> bad = [(i+1, x) for i, r in enumerate(values) for x in r
>        if any(e in str(x) for e in ("#ERROR", "#REF", "#NAME", "#VALUE"))]
> ```

### よくつまずくところ

| 症状 | 原因 |
| --- | --- |
| セルが `#ERROR!` になる | **`=HYPERLINK(...)` の後ろに素のテキストを続けた。** 関数の外に文字を置けない。文章はリンクのラベル側に畳む |
| 入力規則で 400 が返る | 列挙値の名前が違う。URL 検査は `TEXT_IS_URL`（`TEXT_IS_VALID_URL` は存在しない）。**API のレスポンス本文を必ず出して確認する** |
| `固定されている列と固定されていない列は結合できません` | `frozenColumnCount` が結合範囲の途中にある。先に固定を 0 にしてから結合する |
| 件数のセルが `0.00%` になる | 上の行のパーセント書式が伝播している。`numberFormat` を明示的に戻す |
| セル内の `**強調**` が生で出る | Sheets は markdown を解釈しない。装飾は `textFormat` で付ける |
| シート名を変えたら数式が壊れた…と思ったら壊れていない | `updateSheetProperties` での改名は**数式の参照を自動で追随させる** |

### 書き込みの承認

**スプレッドシートへの書き込みは AI が承認なしで直接行う**（dx-kpiee#18521 で決定）。
人間の承認を挟むのは **GitHub issue の起票**と**改修**だけ。
代わりに書き込んでよい列を上の表で固定している。
