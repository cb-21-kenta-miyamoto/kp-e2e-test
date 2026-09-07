/**
 * 【NG管理】ブックから NG フォームへ投稿する。
 *
 * 置き場所: 【NG管理】kpiee 動作確認・E2E の「拡張機能 → Apps Script」
 *
 * 初回のセットアップ（4 手順）:
 *   1. スプレッドシートで「拡張機能 → Apps Script」を開き、このファイルの中身を貼って保存（Ctrl/Cmd+S）
 *   2. スプレッドシートを開き直す → 上部に「NGフォーム」メニューが出る
 *   3. 「フォーム項目」タブの B4 に NG フォームの ID を貼る
 *      フォームを「編集モード」で開いたときの URL の <ここ>:
 *        https://docs.google.com/forms/d/<ここ>/edit
 *      ※ 回答用の /forms/d/e/1FAIpQLS.../viewform は別物で、使えない
 *   4. メニュー「NGフォーム → 準備する（初回だけ）」を押す
 *      → 承認画面が出る（「詳細」→「安全ではないページに移動」→ 許可）
 *      → フォームの質問が「フォーム項目」タブに並び、送信トリガーも同時に入る
 *   5. 「フォーム項目」タブの「対応する列」に、NG一覧 の列記号（例 F）か
 *      固定値（例 "E2E"）を書く
 *
 * 以降は NG一覧 の「送信」にチェックを入れるだけで投稿される。
 *
 * なぜ 4 の一手間が要るか:
 *   チェックだけで動く「簡易トリガー」は Google の仕様で外部サービス（フォーム）を
 *   触れない。フォームへ投稿するには一度ユーザーの承認が要るため、
 *   その承認と、承認が要るトリガーの設置を 4 に畳んでいる。
 *
 * 決めごと:
 *   - AI はフォームへ投稿しない。NG一覧 に行を書くところまで。送信の判断は人が持つ
 *   - 送信済みの行は再送されない。直したいときは 送信済み日時 と フォーム回答ID を消す
 */

// ---- シートと列の定義（レイアウトを変えたらここだけ直す）----
const SHEET_NG = 'NG一覧';
const SHEET_MAP = 'フォーム項目';

// 貼り替え忘れを検出するための版。diagnose() で表示する
const SCRIPT_VERSION = '2026-09-07.1';

const NG_HEADER_ROW = 4;   // 見出し行。列は名前で引くので、位置が動いても壊れない
const NG_FIRST_ROW = 5;    // データの開始行（5 行目は記入例）
// 列番号は「見出しが見つからなかったとき」のフォールバックにしか使わない。
// 直接参照すると、列を組み替えたときに onEdit が黙って何もしなくなる（実際に踏んだ）
const COL_SEND = 22;       // V 送信（チェックボックス）
const COL_SENT_AT = 23;    // W 送信済み日時
const COL_RESPONSE_ID = 24;// X フォーム回答ID
const COL_ERROR = 25;      // Y 送信エラー

/**
 * NG一覧 のシステム列を「見出し名」で引く。
 *
 * 列番号をコードに焼くと、列を組み替えたときに onEditHandler の
 * 「対象列か？」判定が外れ、エラーも出ないまま何も起きなくなる。
 * 見出し名で引けば、列を動かしてもスクリプトを貼り直す必要がない。
 */
function ngCols_(sh) {
  const width = Math.max(sh.getLastColumn(), COL_ERROR);
  const hdr = sh.getRange(NG_HEADER_ROW, 1, 1, width).getValues()[0]
    .map(function (v) { return String(v).trim(); });
  function at(name, fallback) {
    const i = hdr.indexOf(name);
    return i >= 0 ? i + 1 : fallback;
  }
  return {
    send: at('送信', COL_SEND),
    sentAt: at('送信済み日時', COL_SENT_AT),
    responseId: at('フォーム回答ID', COL_RESPONSE_ID),
    error: at('送信エラー', COL_ERROR),
    header: hdr,
  };
}

const MAP_FORM_ID_CELL = 'B4';       // 編集用のフォーム ID を入れる
const MAP_TARGET_URL_CELL = 'B5';    // 投稿したいフォームの回答URL（照合用・任意）
const MAP_ACTUAL_URL_CELL = 'B5';    // 実際の回答URLを書き戻す先（B5 の隣 C5 に出す）
const MAP_ACTUAL_URL_OUT = 'C5';

// 回答が流れ込むシート。ここからフォームの編集URLを引く
const RESPONSE_BOOK_ID = '159r0cLcqNY9w3xrp4D_ELgu5a5OV5drkfrIVRrGy39U'; // 【kp】NG一覧
const RESPONSE_SHEET_NAME = '【編集厳禁】NGフォーム';
const MAP_HEADER_ROW = 6;  // フォーム項目の見出し行
const MAP_FIRST_ROW = 7;

/**
 * B4 の入力から、FormApp が使えるフォーム ID を取り出す。
 * URL を丸ごと貼っても ID だけ貼っても通す。
 *
 * よくある間違いは「公開用（回答用）の ID」を貼ること。
 *   使えない: https://docs.google.com/forms/d/e/1FAIpQLSd.../viewform  ← /d/e/ の方
 *   使える  : https://docs.google.com/forms/d/1AbC.../edit              ← /d/ の方
 * 公開用 ID は FormApp.openById では開けないので、その場で分かるように弾く。
 */
function resolveFormId_(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) {
    throw new Error(
      '「フォーム項目」タブの ' + MAP_FORM_ID_CELL + ' が空です。\n' +
      'フォームを編集モードで開いたときの URL\n' +
      '  https://docs.google.com/forms/d/<ここ>/edit\n' +
      'の <ここ> を貼ってください（URL を丸ごと貼っても構いません）。'
    );
  }
  // 公開用（回答用）の URL / ID を弾く
  if (v.indexOf('/forms/d/e/') !== -1 || v.indexOf('1FAIpQLS') === 0) {
    throw new Error(
      'これは「公開用（回答用）の ID」です。フォームへの投稿には使えません。\n\n' +
      '正しい取り方:\n' +
      '  1. フォームを編集モードで開く（Google フォームの一覧、または Drive から開く）\n' +
      '  2. アドレスバーの https://docs.google.com/forms/d/<ここ>/edit の <ここ> をコピー\n' +
      '  3. ' + MAP_FORM_ID_CELL + ' に貼り直す\n\n' +
      '※ /forms/d/e/1FAIpQLS.../viewform は回答用の URL で、別物です。'
    );
  }
  const m = v.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : v;
}

/** 開けなかったときに、原因が分かるメッセージへ言い換える。 */
function openForm_(formId) {
  try {
    return FormApp.openById(formId);
  } catch (e) {
    throw new Error(
      'フォームを開けませんでした（ID: ' + formId + '）。\n\n' +
      '考えられる原因は 2 つです。\n' +
      '  1. ID が「公開用（回答用）」のもの → 編集 URL /forms/d/<ここ>/edit の <ここ> を使う\n' +
      '  2. このフォームの編集権限が無い → フォームの持ち主に編集者として追加してもらう\n\n' +
      '（Google からの元のメッセージ: ' + (e && e.message ? e.message : e) + '）'
    );
  }
}

/** 画面に出せれば出し、出せなければ実行ログへ。エディタから実行しても落ちないようにする。 */
function notify_(message) {
  Logger.log(message);
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // エディタから実行したときは UI が無い。ログだけ残す
  }
}

// ---- メニュー ----
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NGフォーム')
    .addItem('準備する（初回だけ）', 'prepare')
    .addSeparator()
    .addItem('回答シートからフォームIDを取り出す', 'findFormIdFromResponseSheet')
    .addItem('フォームの項目を読み込み直す', 'listFormItems')
    .addItem('選択肢をドロップダウンに反映する', 'syncChoiceValidation')
    .addItem('チェック済みの行を検証する（送信しない）', 'dryRunCheckedRows')
    .addItem('チェック済みの行をまとめて送信する', 'sendCheckedRows')
    .addSeparator()
    .addItem('送信できないとき — 状態を調べる', 'diagnose')
    .addToUi();
}

/**
 * 初回にこれだけ押せばよい。
 * フォームの質問を読み込み、送信トリガーを入れるところまでを 1 回でやる。
 */
function prepare() {
  const n = loadFormItems_();
  const warn = verifyTarget_();
  const added = ensureTrigger_();
  let dd = '';
  try {
    syncChoiceValidation();
    dd = '選択肢をドロップダウンに反映しました。\n';
  } catch (e) {
    dd = '⚠ ドロップダウンの反映に失敗: ' + (e && e.message ? e.message : e) + '\n';
  }
  notify_(
    (warn ? '⚠ ' + warn + '\n\n' : '') +
    'フォームの項目を ' + n + ' 件読み込みました。\n' +
    (added ? '送信トリガーも入れました。' : '送信トリガーは既に入っていました。') + '\n' + dd + '\n' +
    '「フォーム項目」タブの「対応する列」を埋めれば準備完了です。\n' +
    'あとは NG一覧 の「送信」にチェックを入れるだけで投稿されます。'
  );
}

/** 送信チェックで発火するトリガーを入れる。二重登録はしない。入れたら true。 */
function ensureTrigger_() {
  const already = ScriptApp.getProjectTriggers()
    .some(function (t) { return t.getHandlerFunction() === 'onEditHandler'; });
  if (already) return false;
  ScriptApp.newTrigger('onEditHandler').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  return true;
}

/**
 * 送信できないときに、どこで止まっているかを一括で出す。
 *
 * 「チェックしたのに何も起きない」の原因はほぼ次の 3 つで、
 * いずれも NG一覧 にエラーが出ないため、これを見ないと分からない。
 *   1. スクリプトが古い（列番号が古いままで onEdit が対象列を見失う）
 *   2. onEdit のインストール型トリガーが無い
 *   3. 「対応する列」が空 or フォームIDが別物
 */
function diagnose() {
  const ss = SpreadsheetApp.getActive();
  const out = ['■ スクリプト版: ' + SCRIPT_VERSION];

  const sh = ss.getSheetByName(SHEET_NG);
  if (!sh) {
    notify_('シート「' + SHEET_NG + '」が見つかりません');
    return;
  }
  const col = ngCols_(sh);
  out.push('');
  out.push('■ 列の解決（見出し名から引いた結果）');
  out.push('  送信: ' + colLetter_(col.send) + '列'
    + (col.send === COL_SEND ? '' : '  ※定数 ' + colLetter_(COL_SEND) + ' とズレているが見出しを優先'));
  out.push('  送信済み日時: ' + colLetter_(col.sentAt) + '列 / 回答ID: ' + colLetter_(col.responseId)
    + '列 / エラー: ' + colLetter_(col.error) + '列');
  if (col.header.indexOf('送信') < 0) {
    out.push('  ⚠ 見出し行(' + NG_HEADER_ROW + '行目)に「送信」が無い。フォールバックで '
      + colLetter_(COL_SEND) + '列を見ている');
  }

  const trigs = ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'onEditHandler'; });
  out.push('');
  out.push('■ トリガー');
  out.push(trigs.length
    ? '  onEditHandler が ' + trigs.length + ' 件入っています'
    : '  ⚠ 無し。「準備する（初回だけ）」を押してください（メニューから手動送信は可能）');

  out.push('');
  out.push('■ フォーム');
  let form = null;
  try {
    const map = ss.getSheetByName(SHEET_MAP);
    const id = resolveFormId_(map.getRange(MAP_FORM_ID_CELL).getValue());
    form = openForm_(id);
    out.push('  ' + form.getTitle());
    out.push('  項目 ' + form.getItems().length + ' 件 / ' + form.getPublishedUrl());
    const want = String(map.getRange(MAP_TARGET_URL_CELL).getValue()).trim();
    if (want && form.getPublishedUrl().indexOf(resolveFormId_(want)) < 0) {
      out.push('  ⚠ ' + MAP_TARGET_URL_CELL + ' の投稿先と一致していません');
    }
  } catch (err) {
    out.push('  ⚠ 開けません: ' + (err && err.message ? err.message : err));
  }

  out.push('');
  out.push('■ マッピング');
  const map = ss.getSheetByName(SHEET_MAP);
  const last = map.getLastRow();
  if (last < MAP_FIRST_ROW) {
    out.push('  ⚠ フォーム項目が読み込まれていません');
  } else {
    const rows = map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 7).getValues();
    const filled = rows.filter(function (r) { return String(r[5] || '').trim(); });
    const missing = rows.filter(function (r) {
      return r[3] === '必須' && !String(r[5] || '').trim() && String(r[2]) !== 'PAGE_BREAK';
    }).map(function (r) { return r[1]; });
    out.push('  ' + filled.length + ' / ' + rows.length + ' 項目に対応する列あり');
    if (missing.length) out.push('  必須なのに未対応: ' + missing.join(' / '));
  }

  out.push('');
  out.push('■ 選択式項目の選択肢（フォームの実物）');
  if (form) {
    form.getItems().forEach(function (it) {
      const cs = choiceList_(it);
      if (!cs || !cs.length) return;
      out.push('  ' + it.getTitle() + (hasOther_(it) ? '［その他あり］' : '') + ':');
      out.push('    ' + cs.map(quote_).join(' / '));
    });
  } else {
    out.push('  ⚠ フォームが開けないため取得できません');
  }

  out.push('');
  out.push('■ チェック済みで未送信の行');
  const hits = [];
  for (let r = NG_FIRST_ROW; r <= sh.getLastRow(); r++) {
    if (sh.getRange(r, col.send).getValue() === true && !sh.getRange(r, col.sentAt).getValue()) {
      hits.push(r + '行目 (' + sh.getRange(r, 1).getValue() + ')');
    }
  }
  out.push(hits.length ? '  ' + hits.join(', ') : '  なし');
  if (hits.length) out.push('  → 「チェック済みの行をまとめて送信する」で送れます');

  notify_(out.join('\n'));
}

function quote_(v) { return '"' + String(v) + '"'; }

/**
 * 「対応する列」の指定を、人が読める形にする。
 * どのセルを見に行った結果その値になったのかが分からないと直せない
 */
function describeSpec_(spec) {
  if (spec.length >= 2 && spec.charAt(0) === '"' && spec.charAt(spec.length - 1) === '"') {
    return '固定値 ' + spec;
  }
  if (/^[A-Za-z]{1,2}$/.test(spec)) return spec.toUpperCase() + '列';
  return '固定値 ' + quote_(spec);
}

function colLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - 1 - m) / 26;
  }
  return s;
}

/**
 * 回答が流れ込むシートから、フォームの編集URLを引いて B4 に入れる。
 *
 * 編集用の ID（/forms/d/<id>/edit）は、回答用の URL（/forms/d/e/<id>/viewform）からは
 * 導けない。一方、回答シートはフォームに紐づいているので getFormUrl() で編集URLが取れる。
 * Drive を名前で探すより確実。
 */
function findFormIdFromResponseSheet() {
  const book = SpreadsheetApp.openById(RESPONSE_BOOK_ID);
  const sh = book.getSheetByName(RESPONSE_SHEET_NAME);
  if (!sh) throw new Error('回答シート「' + RESPONSE_SHEET_NAME + '」が見つかりません（' + book.getName() + '）');
  const url = sh.getFormUrl();
  if (!url) {
    throw new Error(
      '回答シート「' + RESPONSE_SHEET_NAME + '」にフォームが紐づいていません。\n' +
      'そのシートがフォームの回答先でないか、リンクが外れています。'
    );
  }
  const id = resolveFormId_(url);
  SpreadsheetApp.getActive().getSheetByName(SHEET_MAP).getRange(MAP_FORM_ID_CELL).setValue(id);
  notify_(
    'フォームの編集URLを取り出して ' + MAP_FORM_ID_CELL + ' に入れました。\n\n' +
    url + '\n\n' +
    '続けて「NGフォーム → 準備する（初回だけ）」を押してください。'
  );
}

/**
 * B4 のフォームが、本当に投稿したいフォームかを照合する。
 *
 * B5 に「投稿先の回答URL」（/forms/d/e/.../viewform）を貼っておくと、
 * B4 のフォームの実際の回答URLと突き合わせて、違っていたら警告を返す。
 * 編集用の ID と回答用の URL は見た目が全く違うので、目視では照合できない。
 */
function verifyTarget_() {
  const map = SpreadsheetApp.getActive().getSheetByName(SHEET_MAP);
  const form = openForm_(resolveFormId_(map.getRange(MAP_FORM_ID_CELL).getValue()));
  let actual = '';
  try { actual = form.getPublishedUrl(); } catch (e) { actual = '(取得できず)'; }
  map.getRange(MAP_ACTUAL_URL_OUT).setValue(actual);

  const target = String(map.getRange(MAP_TARGET_URL_CELL).getValue() || '').trim();
  if (!target) return '';
  const idOf = function (u) {
    const m = String(u).match(/\/forms\/d\/e\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : '';
  };
  const a = idOf(actual), b = idOf(target);
  if (!a || !b) return '';
  if (a === b) return '';
  return 'B4 のフォームは、B5 に書いた投稿先とは別のフォームです。\n' +
         '  B4 の回答URL: ' + actual + '\n' +
         '  B5 の投稿先  : ' + target + '\n' +
         'B4 の ID を差し替えてください。';
}

/** 項目だけ読み込み直す（フォームの質問が増えたとき）。 */
function listFormItems() {
  const n = loadFormItems_();
  notify_('フォームの項目を ' + n + ' 件読み込み直しました。「対応する列」は残してあります。');
}

/** フォームの質問を「フォーム項目」タブへ書き出す。対応する列は既存の入力を保つ。件数を返す。 */
function loadFormItems_() {
  const ss = SpreadsheetApp.getActive();
  const map = ss.getSheetByName(SHEET_MAP);
  const formId = resolveFormId_(map.getRange(MAP_FORM_ID_CELL).getValue());
  const form = openForm_(formId);
  const items = form.getItems();

  // 既存のマッピング（itemId -> 対応する列）を拾っておく
  const prev = {};
  const last = map.getLastRow();
  if (last >= MAP_FIRST_ROW) {
    map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 7).getValues().forEach((r) => {
      if (r[4]) prev[String(r[4])] = r[5];
    });
  }

  const rows = items.map(function (it, i) {
    const id = String(it.getId());
    return [i + 1, it.getTitle(), String(it.getType()), isRequired_(it) ? '必須' : '', id, prev[id] || '', hintFor_(it)];
  });

  if (last >= MAP_FIRST_ROW) map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 7).clearContent();
  if (rows.length) map.getRange(MAP_FIRST_ROW, 1, rows.length, 7).setValues(rows);
  return rows.length;
}

/** 「送信」列にチェックが入ったら投稿する。 */
function onEditHandler(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NG) return;
  const col = ngCols_(sh);
  if (e.range.getColumn() !== col.send) return;
  const row = e.range.getRow();
  if (row < NG_FIRST_ROW) return;
  if (e.range.getValue() !== true) return;
  submitRow_(sh, row);
}


/** チェックが入っていて未送信の行をまとめて送る（トリガーを使わない場合の手動用）。 */
function sendCheckedRows() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NG);
  const last = sh.getLastRow();
  let n = 0;
  const col = ngCols_(sh);
  for (let row = NG_FIRST_ROW; row <= last; row++) {
    if (sh.getRange(row, col.send).getValue() !== true) continue;
    if (sh.getRange(row, col.sentAt).getValue()) continue;
    if (submitRow_(sh, row)) n++;
  }
  notify_(n + ' 件を送信しました。');
}

// ---- 以下は内部処理 ----

/**
 * フォームの選択肢を、NG一覧 のドロップダウンに反映する。
 *
 * 選択肢違反は「送る前に弾く」より「そもそも打てない」ほうが確実。
 * フォーム側の選択肢は増減する（かつて ITテスト があったが今は無い）ので、
 * 「フォームの項目を読み込み直す」のあとにこれを走らせて追随させる。
 */
function syncChoiceValidation() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_NG);
  const map = ss.getSheetByName(SHEET_MAP);
  const last = map.getLastRow();
  if (last < MAP_FIRST_ROW) throw new Error('フォーム項目が読み込まれていません');

  const formId = resolveFormId_(map.getRange(MAP_FORM_ID_CELL).getValue());
  const form = openForm_(formId);
  const itemsById = {};
  form.getItems().forEach(function (it) { itemsById[String(it.getId())] = it; });

  const rows = map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 7).getValues();
  const done = [];
  const skipped = [];
  rows.forEach(function (m) {
    const item = itemsById[String(m[4] || '').trim()];
    const spec = String(m[5] == null ? '' : m[5]).trim();
    if (!item) return;
    const allowed = choiceList_(item);
    if (!allowed || !allowed.length) return;
    // 列参照のときだけ。固定値の項目に入力規則は要らない
    if (!/^[A-Za-z]{1,2}$/.test(spec)) {
      if (spec) skipped.push(m[1] + '（固定値）');
      return;
    }
    const ci = columnLetterToIndex_(spec.toUpperCase());
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(allowed, true)
      // 複数選択とその他ありは、選択肢外の入力を許す必要がある
      .setAllowInvalid(String(m[2]) === 'CHECKBOX' || hasOther_(item))
      .setHelpText(m[1] + '（フォームの選択肢と完全一致が必要）')
      .build();
    sh.getRange(NG_FIRST_ROW, ci, sh.getMaxRows() - NG_FIRST_ROW + 1, 1).setDataValidation(rule);
    done.push(spec.toUpperCase() + '列 ← ' + m[1] + '（' + allowed.length + ' 択）');
  });

  notify_(
    'ドロップダウンを更新しました。\n\n' + done.join('\n') +
    (skipped.length ? '\n\n固定値のため対象外: ' + skipped.join(' / ') : '')
  );
}

/**
 * チェック済みの行を、送信せずに検証だけする。
 *
 * 選択肢違反や必須の空は送信を止めるだけで、原因は「送信エラー」列に出る。
 * 実際に投稿するとフォーム側に取り消せない回答が残るので、まずこれで確かめる。
 */
function dryRunCheckedRows() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NG);
  const col = ngCols_(sh);
  let ok = 0, ng = 0, n = 0;
  for (let row = NG_FIRST_ROW; row <= sh.getLastRow(); row++) {
    if (sh.getRange(row, col.send).getValue() !== true) continue;
    n++;
    if (submitRow_(sh, row, true)) ok++; else ng++;
  }
  notify_(n === 0
    ? '『送信』にチェックが入った行がありません。'
    : n + ' 行を検証しました。送信できる ' + ok + ' / 問題あり ' + ng +
      '\n\n結果は「送信エラー」列に出ています。問題がなければ「チェック済みの行をまとめて送信する」で投稿してください。');
}

function submitRow_(sh, row, dryRun) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return false;
  try {
    // 二重送信を防ぐ。ここを外すとトリガーの再実行で同じ NG が二重に登録される
    const col = ngCols_(sh);
    if (!dryRun && sh.getRange(row, col.sentAt).getValue()) {
      sh.getRange(row, col.error).setValue('送信済みのためスキップしました');
      return false;
    }
    const ss = SpreadsheetApp.getActive();
    const map = ss.getSheetByName(SHEET_MAP);
    const formId = resolveFormId_(map.getRange(MAP_FORM_ID_CELL).getValue());
    const form = openForm_(formId);
    const itemsById = {};
    form.getItems().forEach((it) => { itemsById[String(it.getId())] = it; });

    const mapLast = map.getLastRow();
    if (mapLast < MAP_FIRST_ROW) throw new Error('フォーム項目が読み込まれていません。メニュー「NGフォーム → 準備する（初回だけ）」を押してください');
    const mapping = map.getRange(MAP_FIRST_ROW, 1, mapLast - MAP_FIRST_ROW + 1, 7).getValues();

    const rowValues = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];

    let fr = form.createResponse();
    const skipped = [];  // 送れないが致命的でないもの
    const fatals = [];   // これがあると送信しない
    let built = 0;
    mapping.forEach((m) => {
      const itemId = String(m[4] || '').trim();
      const spec = String(m[5] == null ? '' : m[5]).trim();
      if (!itemId || !spec) return;
      const item = itemsById[itemId];
      if (!item) { skipped.push('項目が見つからない: ' + m[1]); return; }

      let value = resolveValue_(spec, rowValues);
      if (value === '' || value === null || value === undefined) {
        if (m[3] === '必須') fatals.push('必須なのに空: 「' + m[1] + '」← ' + describeSpec_(spec));
        return;
      }

      // 選択式は、送る前に選択肢と突き合わせる。
      // createResponse に任せると「アイテムに無効な回答が送信されました: IT」しか出ず、
      // どの項目か・何なら通るのかが分からない
      const allowed = choiceList_(item);
      if (allowed && allowed.length && !hasOther_(item)) {
        const parts = String(m[2]) === 'CHECKBOX'
          ? String(value).split(',').map(function (x) { return x.trim(); }).filter(String)
          : [value];
        const fixed = [];
        const bad = [];
        parts.forEach(function (pv) {
          const hit = matchChoice_(allowed, pv);
          if (hit === null) bad.push(pv); else fixed.push(hit);
        });
        if (bad.length) {
          fatals.push(
            '選択肢に無い値です: 「' + m[1] + '」に ' + bad.map(quote_).join(', ') +
            ' を送ろうとしました（' + describeSpec_(spec) + '）\n' +
            '    選択できるのは: ' + allowed.map(quote_).join(' / ')
          );
          return;
        }
        value = fixed.join(', ');
      }

      let ir = null;
      try {
        ir = buildItemResponse_(item, value);
      } catch (err) {
        // ここに来るのは型変換の失敗（日付が読めない等）。項目名と値を添えて返す
        fatals.push('値を回答に変換できません: 「' + m[1] + '」(' + m[2] + ') に ' +
          quote_(value) + ' ← ' + describeSpec_(spec) + '\n' +
          '    ' + (err && err.message ? err.message : err));
        return;
      }
      if (ir === null) {
        skipped.push(m[2] === 'FILE_UPLOAD'
          ? 'ファイル添付は送れないのでスキップ: ' + m[1]
          : '未対応のタイプ: ' + m[1] + ' (' + m[2] + ')');
        return;
      }
      fr = fr.withItemResponse(ir);
      built++;
    });

    // 必須の空・選択肢違反は送らない。中途半端な回答をフォームに残さないため
    if (fatals.length) {
      throw new Error(fatals.length + ' 件の問題で送信を中止しました:\n  ・' + fatals.join('\n  ・'));
    }

    if (dryRun) {
      // フォームにゴミを残さずに、送れるかどうかだけ確かめる
      sh.getRange(row, col.error).setValue(
        '検証OK: ' + built + ' 項目を送信できます' +
        (skipped.length ? '（スキップ: ' + skipped.join(' / ') + '）' : ''));
      return true;
    }

    const submitted = fr.submit();
    sh.getRange(row, col.sentAt).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
    sh.getRange(row, col.responseId).setValue(safeResponseId_(submitted));
    sh.getRange(row, col.error).setValue(skipped.length ? '送信済み（スキップ: ' + skipped.join(' / ') + '）' : '');
    return true;
  } catch (err) {
    // ここに来られない失敗（onEdit が発火しない等）は Y列も空のままになる。
    // その切り分けは diagnose() でやる
    const c = ngCols_(sh);
    sh.getRange(row, c.error).setValue(String(err && err.message ? err.message : err));
    // 検証のときはチェックを外さない。直して再検証できるようにする
    if (!dryRun) sh.getRange(row, c.send).setValue(false);
    return false;
  } finally {
    lock.releaseLock();
  }
}

/** 「対応する列」の指定を実際の値へ変える。列記号（F）か、"..." で囲んだ固定値。 */
function resolveValue_(spec, rowValues) {
  if (spec.length >= 2 && spec.charAt(0) === '"' && spec.charAt(spec.length - 1) === '"') {
    return spec.substring(1, spec.length - 1);
  }
  if (/^[A-Za-z]{1,2}$/.test(spec)) {
    const idx = columnLetterToIndex_(spec.toUpperCase()) - 1;
    const v = idx >= 0 && idx < rowValues.length ? rowValues[idx] : '';
    // Date をそのまま String() すると "Sat Sep 06 2026 00:00:00 GMT+0900..." になる
    if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd');
    return v;
  }
  return spec; // それ以外はそのまま固定値として扱う
}

function columnLetterToIndex_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

/**
 * 「選択肢・注意」列に出す文言。
 * 選択式は選べる値をそのまま並べる。ここに無い値を送るとフォームに弾かれるため。
 */
function hintFor_(item) {
  const t = String(item.getType());
  if (t === 'PAGE_BREAK') return '※セクション区切り。回答を持てないので「対応する列」は空のままにする';
  if (t === 'FILE_UPLOAD') return '★ファイル添付はスクリプトから送れません。証跡の URL は別のテキスト項目へ入れてください';
  try {
    if (t === 'MULTIPLE_CHOICE') return '選択肢: ' + choices_(item.asMultipleChoiceItem());
    if (t === 'LIST') return '選択肢: ' + choices_(item.asListItem());
    if (t === 'CHECKBOX') return '選択肢（カンマ区切りで複数可）: ' + choices_(item.asCheckboxItem());
    if (t === 'SCALE') {
      const sc = item.asScaleItem();
      return '数値 ' + sc.getLowerBound() + '〜' + sc.getUpperBound();
    }
  } catch (e) {
    // 握り潰すと「選択肢が空」の原因が分からなくなる。理由をセルに出す
    return '選択肢を取得できませんでした: ' + (e && e.message ? e.message : e);
  }
  return '';
}


/**
 * 選択式の項目なら選択肢の配列を返す。それ以外は null。
 */
function choiceList_(item) {
  const t = String(item.getType());
  try {
    if (t === 'MULTIPLE_CHOICE') return choiceValues_(item.asMultipleChoiceItem());
    if (t === 'LIST') return choiceValues_(item.asListItem());
    if (t === 'CHECKBOX') return choiceValues_(item.asCheckboxItem());
  } catch (e) { /* 取れないものは照合しない */ }
  return null;
}

function choiceValues_(typed) {
  return typed.getChoices().map(function (c) { return c.getValue(); });
}

/**
 * 「その他」が有効な項目は、選択肢に無い値も通る。
 */
function hasOther_(item) {
  const t = String(item.getType());
  try {
    if (t === 'MULTIPLE_CHOICE') return item.asMultipleChoiceItem().hasOtherOption();
    if (t === 'CHECKBOX') return item.asCheckboxItem().hasOtherOption();
  } catch (e) { /* 取れないものは無しとみなす */ }
  return false;
}

/**
 * 前後の空白・全角半角・大文字小文字の違いを無視して照合する。
 *
 * フォームの選択肢は目で見ても差が分からないことがある（末尾の空白、全角の英字、
 * NBSP など）。完全一致だけで弾くと「選択肢にあるのに無効と言われる」になる。
 */
function normalizeChoice_(v) {
  return String(v)
    .normalize('NFKC')
    .replace(/[\s\u00a0\u3000]+/g, '')
    .toLowerCase();
}

/**
 * value を選択肢のどれかに寄せる。寄せられなければ null。
 * 返すのは「フォーム側の正式な表記」（正規化前の文字列）。
 */
function matchChoice_(allowed, value) {
  const v = normalizeChoice_(value);
  for (let i = 0; i < allowed.length; i++) {
    if (normalizeChoice_(allowed[i]) === v) return allowed[i];
  }
  return null;
}

function choices_(typed) {
  return typed.getChoices().map(function (c) { return c.getValue(); }).join(' / ');
}

/** 項目の型に合わせて ItemResponse を作る。未対応なら null。 */
function buildItemResponse_(item, value) {
  const t = String(item.getType());
  const s = String(value);
  switch (t) {
    case 'TEXT': return item.asTextItem().createResponse(s);
    case 'PARAGRAPH_TEXT': return item.asParagraphTextItem().createResponse(s);
    case 'MULTIPLE_CHOICE': return item.asMultipleChoiceItem().createResponse(s);
    case 'LIST': return item.asListItem().createResponse(s);
    case 'CHECKBOX': return item.asCheckboxItem().createResponse(s.split(',').map(function (x) { return x.trim(); }).filter(String));
    case 'SCALE': return item.asScaleItem().createResponse(Number(s));
    case 'FILE_UPLOAD':
      // Apps Script からファイル添付の回答は作れない（Google の制約）
      return null;
    case 'DATE': return item.asDateItem().createResponse(toDate_(value));
    case 'DATETIME': return item.asDateTimeItem().createResponse(toDate_(value));
    case 'TIME': {
      const d = toDate_(value);
      return item.asTimeItem().createResponse(d.getHours(), d.getMinutes());
    }
    default: return null;
  }
}

function toDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  const d = new Date(String(value));
  if (isNaN(d.getTime())) throw new Error('日付として読めません: ' + value);
  return d;
}

function isRequired_(item) {
  try {
    const t = String(item.getType());
    if (t === 'TEXT') return item.asTextItem().isRequired();
    if (t === 'PARAGRAPH_TEXT') return item.asParagraphTextItem().isRequired();
    if (t === 'MULTIPLE_CHOICE') return item.asMultipleChoiceItem().isRequired();
    if (t === 'LIST') return item.asListItem().isRequired();
    if (t === 'CHECKBOX') return item.asCheckboxItem().isRequired();
    if (t === 'SCALE') return item.asScaleItem().isRequired();
    if (t === 'DATE') return item.asDateItem().isRequired();
    if (t === 'DATETIME') return item.asDateTimeItem().isRequired();
    if (t === 'TIME') return item.asTimeItem().isRequired();
  } catch (e) { /* 型に isRequired が無いものは無視する */ }
  return false;
}

/** 回答IDは環境によって取れないことがあるので、失敗しても送信自体は成功扱いにする。 */
function safeResponseId_(formResponse) {
  try { return formResponse.getId(); } catch (e) { return '(取得できず)'; }
}
