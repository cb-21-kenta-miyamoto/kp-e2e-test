/**
 * 【NG管理】ブックから NG フォームへ投稿する。
 *
 * 置き場所: 【NG管理】kpiee 動作確認・E2E の「拡張機能 → Apps Script」
 *
 * 初回のセットアップ:
 *   1. スプレッドシートで「拡張機能 → Apps Script」を開き、このファイルの中身を貼って保存（Ctrl/Cmd+S）
 *   2. スプレッドシートを開き直す → 上部に「NGフォーム」メニューが出る
 *   3. 「フォーム項目」タブの B4 に NG フォームの ID を貼る
 *      （編集URL https://docs.google.com/forms/d/<ここ>/edit の <ここ>）
 *   4. メニュー「NGフォーム → フォームの項目を読み込む」を実行
 *      初回は Google の承認画面が出る（「詳細」→「安全ではないページに移動」→ 許可）
 *   5. 「フォーム項目」タブの各行の「対応する列」に、NG一覧 の列記号（例 F）か
 *      固定値（例 "E2E"）を書く
 *   6. メニュー「NGフォーム → 送信トリガーを入れる（初回のみ）」を実行
 *
 * トリガーを入れたくない場合は 6 を飛ばし、
 * 「NGフォーム → チェック済みの行を送信する」を都度実行すればよい。
 *
 * 決めごと:
 *   - AI はフォームへ投稿しない。NG一覧 に行を書くところまで。送信の判断は人が持つ
 *   - 送信済みの行は再送されない。直したいときは 送信済み日時 と フォーム回答ID を消す
 */

// ---- シートと列の定義（レイアウトを変えたらここだけ直す）----
const SHEET_NG = 'NG一覧';
const SHEET_MAP = 'フォーム項目';

const NG_HEADER_ROW = 4;   // 見出し行
const NG_FIRST_ROW = 5;    // データの開始行（5 行目は記入例）
const COL_SEND = 17;       // Q 送信（チェックボックス）
const COL_SENT_AT = 18;    // R 送信済み日時
const COL_RESPONSE_ID = 19;// S フォーム回答ID
const COL_ERROR = 20;      // T 送信エラー

const MAP_FORM_ID_CELL = 'B4';
const MAP_HEADER_ROW = 6;  // フォーム項目の見出し行
const MAP_FIRST_ROW = 7;

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
    .addItem('フォームの項目を読み込む', 'listFormItems')
    .addItem('チェック済みの行を送信する', 'sendCheckedRows')
    .addSeparator()
    .addItem('送信トリガーを入れる（初回のみ）', 'setup')
    .addToUi();
}

/** 送信チェックで発火するトリガーを入れる。二重登録はしない。 */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const already = ScriptApp.getProjectTriggers()
    .some((t) => t.getHandlerFunction() === 'onEditHandler');
  if (already) {
    notify_('送信トリガーは既に入っています。追加しませんでした。');
    return;
  }
  ScriptApp.newTrigger('onEditHandler').forSpreadsheet(ss).onEdit().create();
  notify_('送信トリガーを入れました。NG一覧 の「送信」にチェックすると投稿します。');
}

/** フォームの質問を「フォーム項目」タブへ書き出す。対応する列は既存の入力を保つ。 */
function listFormItems() {
  const ss = SpreadsheetApp.getActive();
  const map = ss.getSheetByName(SHEET_MAP);
  const formId = String(map.getRange(MAP_FORM_ID_CELL).getValue()).trim();
  if (!formId) throw new Error(SHEET_MAP + ' の ' + MAP_FORM_ID_CELL + ' にフォームの ID を入れてください。');

  const form = FormApp.openById(formId);
  const items = form.getItems();

  // 既存のマッピング（itemId -> 対応する列）を拾っておく
  const prev = {};
  const last = map.getLastRow();
  if (last >= MAP_FIRST_ROW) {
    map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 7).getValues().forEach((r) => {
      if (r[4]) prev[String(r[4])] = r[5];
    });
  }

  const rows = items.map((it, i) => {
    const id = String(it.getId());
    return [i + 1, it.getTitle(), String(it.getType()), isRequired_(it) ? '必須' : '', id, prev[id] || '', ''];
  });

  if (last >= MAP_FIRST_ROW) map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 7).clearContent();
  if (rows.length) map.getRange(MAP_FIRST_ROW, 1, rows.length, 7).setValues(rows);

  notify_(
    'フォーム「' + form.getTitle() + '」の項目を ' + rows.length + ' 件読み込みました。\n' +
    '各行の「対応する列」に NG一覧 の列記号（例 F）か固定値（例 "E2E"）を入れてください。'
  );
}

/** 「送信」列にチェックが入ったら投稿する。 */
function onEditHandler(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NG) return;
  if (e.range.getColumn() !== COL_SEND) return;
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
  for (let row = NG_FIRST_ROW; row <= last; row++) {
    if (sh.getRange(row, COL_SEND).getValue() !== true) continue;
    if (sh.getRange(row, COL_SENT_AT).getValue()) continue;
    if (submitRow_(sh, row)) n++;
  }
  notify_(n + ' 件を送信しました。');
}

// ---- 以下は内部処理 ----

function submitRow_(sh, row) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return false;
  try {
    // 二重送信を防ぐ。ここを外すとトリガーの再実行で同じ NG が二重に登録される
    if (sh.getRange(row, COL_SENT_AT).getValue()) {
      sh.getRange(row, COL_ERROR).setValue('送信済みのためスキップしました');
      return false;
    }
    const ss = SpreadsheetApp.getActive();
    const map = ss.getSheetByName(SHEET_MAP);
    const formId = String(map.getRange(MAP_FORM_ID_CELL).getValue()).trim();
    if (!formId) throw new Error(SHEET_MAP + ' の ' + MAP_FORM_ID_CELL + ' にフォームの ID がありません');

    const form = FormApp.openById(formId);
    const itemsById = {};
    form.getItems().forEach((it) => { itemsById[String(it.getId())] = it; });

    const mapLast = map.getLastRow();
    if (mapLast < MAP_FIRST_ROW) throw new Error('フォーム項目が読み込まれていません。listFormItems を実行してください');
    const mapping = map.getRange(MAP_FIRST_ROW, 1, mapLast - MAP_FIRST_ROW + 1, 7).getValues();

    const rowValues = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];

    let fr = form.createResponse();
    const skipped = [];
    mapping.forEach((m) => {
      const itemId = String(m[4] || '').trim();
      const spec = String(m[5] == null ? '' : m[5]).trim();
      if (!itemId || !spec) return;
      const item = itemsById[itemId];
      if (!item) { skipped.push('項目が見つからない: ' + m[1]); return; }

      const value = resolveValue_(spec, rowValues);
      if (value === '' || value === null || value === undefined) {
        if (m[3] === '必須') skipped.push('必須なのに空: ' + m[1]);
        return;
      }
      const ir = buildItemResponse_(item, value);
      if (ir === null) { skipped.push('未対応のタイプ: ' + m[1] + ' (' + m[2] + ')'); return; }
      fr = fr.withItemResponse(ir);
    });

    if (skipped.length) {
      // 必須が埋まっていないときは送らない。中途半端な回答を残さないため
      const fatal = skipped.filter((s) => s.indexOf('必須なのに空') === 0);
      if (fatal.length) throw new Error(fatal.join(' / '));
    }

    const submitted = fr.submit();
    sh.getRange(row, COL_SENT_AT).setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
    sh.getRange(row, COL_RESPONSE_ID).setValue(safeResponseId_(submitted));
    sh.getRange(row, COL_ERROR).setValue(skipped.length ? '送信済み（スキップ: ' + skipped.join(' / ') + '）' : '');
    return true;
  } catch (err) {
    sh.getRange(row, COL_ERROR).setValue(String(err && err.message ? err.message : err));
    sh.getRange(row, COL_SEND).setValue(false);
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
    return idx >= 0 && idx < rowValues.length ? rowValues[idx] : '';
  }
  return spec; // それ以外はそのまま固定値として扱う
}

function columnLetterToIndex_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
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
