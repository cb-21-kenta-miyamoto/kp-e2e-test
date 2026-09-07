/**
 * 【E2E】NG管理 ブックから、組織の NG 投稿フォームへ投稿する。
 *
 * 置き場所: 【E2E】NG管理 の「拡張機能 → Apps Script」
 *
 * ---- 使い方 ----
 * メニュー「NGフォーム」に 2 つだけ出る。
 *
 *   1. フォームの項目を取得する
 *        フォームの質問を「フォーム項目」タブへ並べ、選択肢を NG一覧 のドロップダウンにする。
 *        初回と、フォームの質問が変わったときに押す。
 *
 *   2. チェックした行を送信する
 *        NG一覧 の『送信』にチェックが入っていて未送信の行を、まとめて投稿する。
 *        ★1 行でも問題があれば 1 通も送らない。フォームの回答は取り消せないため。
 *
 * ---- 初回だけ ----
 *   1. このファイルの中身を貼って保存
 *   2. ブックを開き直す（メニューが出る）
 *   3. メニュー「フォームの項目を取得する」を押す
 *      → 承認画面（「詳細」→「安全ではないページに移動」→ 許可）
 *      → 「フォーム項目」タブの B4 が空なら、回答シートから編集用 ID を自動で引く
 *   4. 「フォーム項目」タブの『対応する列』『固定値（既定）』を確認する
 *
 * ---- 決めごと ----
 *   - AI はフォームへ投稿しない。NG一覧 に行を書くところまで。送信の判断は人が持つ
 *   - 送信済みの行は再送されない。直すときは 送信済み日時 と フォーム回答ID を消す
 */

// ---- シートとセルの定義（レイアウトを変えたらここだけ直す）----
const SHEET_NG = 'NG一覧';
const SHEET_MAP = 'フォーム項目';

const NG_HEADER_ROW = 4;   // 見出し行。システム列は名前で引くので位置が動いても壊れない
const NG_FIRST_ROW = 5;

// 見出しが見つからなかったときのフォールバックにしか使わない。
// 直接参照すると、列を組み替えたときに黙って別の列を読む
const FALLBACK = { send: 32, sentAt: 33, responseId: 34, error: 35 };

const MAP_FORM_ID_CELL = 'B4';   // 編集用のフォーム ID
const MAP_FIRST_ROW = 7;         // フォーム項目の 1 件目（6 行目が見出し）

// フォームの回答が流れ込むシート。B4 が空のとき、ここから編集用 URL を引く
const RESPONSE_BOOK_ID = '159r0cLcqNY9w3xrp4D_ELgu5a5OV5drkfrIVRrGy39U'; // 【kp】NG一覧
const RESPONSE_SHEET_NAME = '【編集厳禁】NGフォーム';


// ======== 表に出る 3 つ ========

/** メニューを登録する。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NGフォーム')
    .addItem('フォームの項目を取得する', 'loadForm')
    .addItem('チェックした行を送信する', 'sendChecked')
    .addToUi();
}

/**
 * フォームの質問を「フォーム項目」タブへ書き出し、選択肢を NG一覧 のドロップダウンにする。
 *
 * 『対応する列』『固定値（既定）』の入力は itemId で引き継ぐので、押し直しても消えない。
 * 選択肢は増減する（かつて「ITテスト」があったが今は無い）ので、
 * フォームを直したらこれを押して追随させる。
 */
function loadForm() {
  const ss = SpreadsheetApp.getActive();
  const map = ss.getSheetByName(SHEET_MAP);
  const ng = ss.getSheetByName(SHEET_NG);
  const form = form_();
  const items = form.getItems();

  // 既存の対応（itemId → 対応する列 / 固定値）を拾っておく
  const prev = {};
  const last = map.getLastRow();
  if (last >= MAP_FIRST_ROW) {
    map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 8).getValues().forEach(function (r) {
      if (r[4]) prev[String(r[4])] = [r[5], r[6]];
    });
  }

  const rows = [];
  const dropped = [];
  let section = '';
  items.forEach(function (it, i) {
    const id = String(it.getId());
    const meta = itemMeta_(it);
    const keep = prev[id] || ['', ''];
    if (meta.type === 'PAGE_BREAK') section = it.getTitle();
    // どのページ配下かを出す。分岐先ページの「必須」は、そのページに
    // 入らない回答では埋める必要が無いため、目で見て分かるようにしておく
    const hint = (section && meta.type !== 'PAGE_BREAK' ? '［' + section + 'ページ］ ' : '') + meta.hint;
    rows.push([i + 1, it.getTitle(), meta.type, meta.required ? '必須' : '', id, keep[0], keep[1], hint]);

    // 選択肢をそのままドロップダウンにする。選択肢違反は
    // 「送る前に弾く」より「そもそも打てない」ほうが確実
    const spec = String(keep[0] || '').trim();
    if (!meta.choices || !meta.choices.length || !spec) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(meta.choices, true)
      // 複数選択と「その他あり」は選択肢外の入力を許す必要がある
      .setAllowInvalid(meta.type === 'CHECKBOX' || meta.other)
      .setHelpText(it.getTitle() + '（フォームの選択肢と完全一致が必要）')
      .build();
    spec.replace(/\s/g, '').split(',').filter(String).forEach(function (letter) {
      if (!/^[A-Za-z]{1,2}$/.test(letter)) return;
      ng.getRange(NG_FIRST_ROW, colIndex_(letter), ng.getMaxRows() - NG_FIRST_ROW + 1, 1)
        .setDataValidation(rule);
      dropped.push(letter.toUpperCase() + '列 ← ' + it.getTitle() + '（' + meta.choices.length + ' 択）');
    });
  });

  if (last >= MAP_FIRST_ROW) map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 8).clearContent();
  if (rows.length) map.getRange(MAP_FIRST_ROW, 1, rows.length, 8).setValues(rows);

  // onEdit トリガーは使わない方式に変えた。昔のトリガーが残っていると
  // 存在しない関数を呼び続けるので消しておく
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() !== 'onOpen') { ScriptApp.deleteTrigger(t); removed++; }
  });

  notify_(
    form.getTitle() + '\n' +
    'フォームの項目を ' + rows.length + ' 件読み込みました。\n\n' +
    (dropped.length ? 'ドロップダウンを更新:\n  ' + dropped.join('\n  ') + '\n\n' : '') +
    (removed ? '古い送信トリガー ' + removed + ' 件を削除しました。\n\n' : '') +
    '「対応する列」と「固定値（既定）」を確認したら、NG一覧 の『送信』にチェックを入れて\n' +
    'メニュー「チェックした行を送信する」を押してください。'
  );
}

/**
 * 『送信』にチェックが入っていて未送信の行を、まとめて投稿する。
 *
 * ★まず全行を組み立てて検証し、1 行でも問題があれば 1 通も送らない。
 * フォームに投稿された回答は取り消せないので、途中まで送るのが最悪の結果になる。
 */
function sendChecked() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    notify_('ほかの送信が動いています。少し待ってから押し直してください。');
    return;
  }
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NG);
    const col = ngCols_(sh);
    const targets = [];
    const already = [];
    for (let r = NG_FIRST_ROW; r <= sh.getLastRow(); r++) {
      if (sh.getRange(r, col.send).getValue() !== true) continue;
      if (sh.getRange(r, col.sentAt).getValue()) { already.push(r); continue; }
      targets.push(r);
    }
    if (!targets.length) {
      notify_(already.length
        ? 'チェックが入った ' + already.length + ' 行はすべて送信済みです。\n'
          + '再送したい場合は「送信済み日時」と「フォーム回答ID」を消してください。'
        : '『送信』にチェックが入った行がありません。');
      return;
    }

    const form = form_();
    const mapping = mapRows_();
    const plans = [];
    const problems = [];
    targets.forEach(function (r) {
      const built = buildResponse_(form, mapping, sh, r);
      if (built.fatals.length) {
        sh.getRange(r, col.error).setValue(built.fatals.join('\n'));
        problems.push(r + ' 行目\n  ・' + built.fatals.join('\n  ・'));
      } else {
        sh.getRange(r, col.error).setValue('検証OK: ' + built.count + ' 項目');
        plans.push({ row: r, response: built.response, skipped: built.skipped });
      }
    });

    if (problems.length) {
      SpreadsheetApp.flush();
      notify_(
        '問題があるので 1 通も送りませんでした（' + problems.length + ' / ' + targets.length + ' 行）。\n' +
        'フォームの回答は取り消せないため、途中まで送りません。\n\n' +
        problems.join('\n\n') + '\n\n詳細は「送信エラー」列にも出ています。'
      );
      return;
    }

    const sent = [];
    plans.forEach(function (p) {
      try {
        const res = p.response.submit();
        sh.getRange(p.row, col.sentAt)
          .setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
        let id = '(取得できず)';
        try { id = res.getId(); } catch (e) { /* 環境により取れない。送信自体は成功 */ }
        sh.getRange(p.row, col.responseId).setValue(id);
        sh.getRange(p.row, col.error)
          .setValue(p.skipped.length ? '送信済み（スキップ: ' + p.skipped.join(' / ') + '）' : '');
        SpreadsheetApp.flush();   // 1 通ごとに確定させる。落ちても送った分は残る
        sent.push(p.row);
      } catch (err) {
        sh.getRange(p.row, col.error).setValue(String(err && err.message ? err.message : err));
        sh.getRange(p.row, col.send).setValue(false);
        SpreadsheetApp.flush();
      }
    });
    notify_(sent.length + ' 件を送信しました（' + sent.join(', ') + ' 行目）。');
  } finally {
    lock.releaseLock();
  }
}


// ======== 以下は内部処理 ========

/**
 * フォームを開く。B4 が空なら、回答シートから編集用 URL を引く。
 *
 * 回答用 ID（/forms/d/e/1FAIpQLS.../viewform）と編集用 ID（/forms/d/<id>/edit）は
 * 別物で、相互に変換できない。FormApp が要るのは編集用。
 * 回答シートはフォームに紐づいているので getFormUrl() が編集用 URL を返す。
 */
function form_() {
  const map = SpreadsheetApp.getActive().getSheetByName(SHEET_MAP);
  let raw = String(map.getRange(MAP_FORM_ID_CELL).getValue() || '').trim();

  if (!raw) {
    const rs = SpreadsheetApp.openById(RESPONSE_BOOK_ID).getSheetByName(RESPONSE_SHEET_NAME);
    const url = rs && rs.getFormUrl();
    if (!url) {
      throw new Error(
        '「フォーム項目」タブの ' + MAP_FORM_ID_CELL + ' が空で、回答シートからも引けませんでした。\n' +
        'フォームを編集モードで開いた URL https://docs.google.com/forms/d/<ここ>/edit の\n' +
        '<ここ> を ' + MAP_FORM_ID_CELL + ' に貼ってください。'
      );
    }
    raw = url;
    map.getRange(MAP_FORM_ID_CELL).setValue(idOf_(url));
  }

  if (raw.indexOf('/forms/d/e/') !== -1 || raw.indexOf('1FAIpQLS') === 0) {
    throw new Error(
      'これは回答用（公開用）の ID です。投稿には使えません。\n' +
      '編集モードの URL https://docs.google.com/forms/d/<ここ>/edit の <ここ> を貼ってください。\n' +
      '（' + MAP_FORM_ID_CELL + ' を空にすると、回答シートから自動で引きます）'
    );
  }

  const id = idOf_(raw);
  try {
    return FormApp.openById(id);
  } catch (e) {
    throw new Error(
      'フォームを開けませんでした（ID: ' + id + '）。\n' +
      '  1. ID が回答用のもの → 編集 URL の <ここ> を使う\n' +
      '  2. このフォームの編集権限が無い → 持ち主に編集者として追加してもらう\n' +
      '（Google のメッセージ: ' + (e && e.message ? e.message : e) + '）'
    );
  }
}

function idOf_(v) {
  const m = String(v).match(/\/forms\/d\/(?:e\/)?([a-zA-Z0-9_-]+)/);
  return m ? m[1] : String(v).trim();
}

/** NG一覧 のシステム列を見出し名で引く。位置が動いても壊れないようにするため。 */
function ngCols_(sh) {
  const width = Math.max(sh.getLastColumn(), FALLBACK.error);
  const hdr = sh.getRange(NG_HEADER_ROW, 1, 1, width).getValues()[0]
    .map(function (v) { return String(v).trim(); });
  function at(name, fb) {
    const i = hdr.indexOf(name);
    return i >= 0 ? i + 1 : fb;
  }
  return {
    send: at('送信', FALLBACK.send),
    sentAt: at('送信済み日時', FALLBACK.sentAt),
    responseId: at('フォーム回答ID', FALLBACK.responseId),
    error: at('送信エラー', FALLBACK.error),
  };
}

/** 「フォーム項目」タブの対応表を読む。 */
function mapRows_() {
  const map = SpreadsheetApp.getActive().getSheetByName(SHEET_MAP);
  const last = map.getLastRow();
  if (last < MAP_FIRST_ROW) {
    throw new Error('フォームの項目が読み込まれていません。メニュー「フォームの項目を取得する」を押してください。');
  }
  return map.getRange(MAP_FIRST_ROW, 1, last - MAP_FIRST_ROW + 1, 8).getValues();
}

/**
 * 1 行ぶんの回答を組み立てる。送信はしない。
 * 返す fatals が空でなければ、その行は送ってはいけない。
 */
function buildResponse_(form, mapping, sh, row) {
  const itemsById = {};
  form.getItems().forEach(function (it) { itemsById[String(it.getId())] = it; });
  const values = rowValues_(sh, row);

  // ---- 1 段目: 全項目の値を出し、セクションごとに使われているかを見る ----
  //
  // ★フォームはデバイスの回答でページが分岐する。分岐先のページの項目は
  // 「必須」でも、そのページに入らない回答では埋める必要が無い。
  // 実際、PC 起票 1433 件のうち 1431 件はモバイル系が 4 項目とも空だった。
  // 必須フラグだけを見ると、送れるはずの行を止めてしまう。
  //
  // そこで「そのセクションに 1 つも値が無ければ、セクションごと使わない」と判断する。
  // 逆に 1 つでも埋まっていれば、同じセクションの必須の空は本当の不備として止める。
  const plan = [];
  const used = { '': true };      // 最初のページは常に使う
  let section = '';
  mapping.forEach(function (m) {
    if (String(m[2]) === 'PAGE_BREAK') { section = String(m[1] || ''); return; }
    const itemId = String(m[4] || '').trim();
    const colSpec = String(m[5] == null ? '' : m[5]).trim();
    const fixed = String(m[6] == null ? '' : m[6]).trim();
    if (!itemId || (!colSpec && !fixed)) return;
    const value = valueFor_(colSpec, fixed, values);
    if (value !== '') used[section] = true;
    plan.push({
      m: m, section: section, value: value,
      where: colSpec ? colSpec.toUpperCase() + '列' : '固定値 ' + fixed,
    });
  });

  // ---- 2 段目: 回答を組み立てる ----
  let fr = form.createResponse();
  const fatals = [], skipped = [];
  let count = 0;

  plan.forEach(function (p) {
    const m = p.m;
    const item = itemsById[String(m[4]).trim()];
    if (!item) { skipped.push('項目が見つからない: ' + m[1]); return; }

    let value = p.value;
    if (value === '') {
      if (m[3] !== '必須') return;
      if (used[p.section]) {
        fatals.push('必須なのに空: 「' + m[1] + '」← ' + p.where);
      } else {
        skipped.push('セクション「' + p.section + '」は未使用: ' + m[1]);
      }
      return;
    }

    // 選択式は送る前に突き合わせる。createResponse に任せると
    // 「アイテムに無効な回答が送信されました: IT」しか出ず、
    // どの項目か・何なら通るのかが分からない
    const meta = itemMeta_(item);
    if (meta.choices && meta.choices.length && !meta.other) {
      const parts = meta.type === 'CHECKBOX'
        ? value.split(',').map(function (x) { return x.trim(); }).filter(String)
        : [value];
      const hits = [], bad = [];
      parts.forEach(function (q) {
        const hit = matchChoice_(meta.choices, q);
        if (hit === null) bad.push(q); else hits.push(hit);
      });
      if (bad.length) {
        fatals.push('選択肢に無い値です: 「' + m[1] + '」に "' + bad.join('", "') + '" を送ろうとしました（'
          + p.where + '）\n      選択できるのは: ' + meta.choices.join(' / '));
        return;
      }
      value = hits.join(', ');
    }

    let ir = null;
    try {
      ir = responseFor_(item, value);
    } catch (err) {
      fatals.push('値を回答に変換できません: 「' + m[1] + '」(' + meta.type + ') に "' + value + '" ← '
        + p.where + '\n      ' + (err && err.message ? err.message : err));
      return;
    }
    if (ir === null) {
      skipped.push(meta.type === 'FILE_UPLOAD'
        ? 'ファイル添付は送れないのでスキップ: ' + m[1]
        : '未対応のタイプ: ' + m[1] + '（' + meta.type + '）');
      return;
    }
    fr = fr.withItemResponse(ir);
    count++;
  });

  return { response: fr, fatals: fatals, skipped: skipped, count: count };
}

/**
 * 行の値を読む。
 *
 * ★=HYPERLINK("url","ラベル") のセルは getValues() だとラベルしか返らない。
 * リンク列（テストケースリンク・証跡）は URL を送りたいので、URL を取り出す。
 */
function rowValues_(sh, row) {
  const rng = sh.getRange(row, 1, 1, Math.max(sh.getLastColumn(), 1));
  const values = rng.getValues()[0];
  const formulas = rng.getFormulas()[0];
  let rich = null;
  try { rich = rng.getRichTextValues()[0]; } catch (e) { /* 取れなければ値だけで判断する */ }

  return values.map(function (v, i) {
    const m = /^=HYPERLINK\(\s*"([^"]+)"/i.exec(String(formulas[i] || ''));
    if (m) return m[1];
    if (rich && rich[i]) {
      const u = rich[i].getLinkUrl();
      if (u) return u;
    }
    return v;
  });
}

/**
 * 『対応する列』と『固定値（既定）』から送る値を決める。
 *
 * 列はカンマ区切りで複数指定できる（例 P,Q）。空でない値を改行で連結する。
 * フォームは 1 項目なのに、こちら側で分けて持ちたい列があるため
 * （テストケースリンク = ケースPR と 実施記録シート）。
 * 列が空なら固定値。固定値は「既定値」としてはたらく。
 */
function valueFor_(colSpec, fixed, rowValues) {
  if (colSpec) {
    const out = [];
    colSpec.replace(/\s/g, '').split(',').filter(String).forEach(function (letter) {
      if (!/^[A-Za-z]{1,2}$/.test(letter)) return;
      const i = colIndex_(letter.toUpperCase()) - 1;
      let v = i >= 0 && i < rowValues.length ? rowValues[i] : '';
      // Date をそのまま String() すると "Sat Sep 06 2026 00:00:00 GMT+0900..." になる
      if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd');
      v = String(v == null ? '' : v).trim();
      if (v) out.push(v);
    });
    if (out.length) return out.join('\n');
  }
  return unquote_(fixed);
}

function unquote_(s) {
  const v = String(s == null ? '' : s).trim();
  if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') {
    return v.substring(1, v.length - 1);
  }
  return v;
}

function colIndex_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  return n;
}

/**
 * 項目の型・必須・選択肢・「その他」の有無・ヒント文を 1 回で取る。
 * 型ごとに as*Item() を呼ぶ必要があり、あちこちで分岐すると同じ switch が増えるため。
 */
function itemMeta_(item) {
  const type = String(item.getType());
  const out = { type: type, required: false, choices: null, other: false, hint: '' };

  if (type === 'PAGE_BREAK') {
    out.hint = '※セクション区切り。回答を持てないので「対応する列」は空のままにする';
    return out;
  }
  if (type === 'FILE_UPLOAD') {
    out.hint = '★ファイル添付はスクリプトから送れません。URL を別のテキスト項目へ入れてください';
    return out;
  }

  const as = {
    TEXT: 'asTextItem', PARAGRAPH_TEXT: 'asParagraphTextItem',
    MULTIPLE_CHOICE: 'asMultipleChoiceItem', LIST: 'asListItem', CHECKBOX: 'asCheckboxItem',
    SCALE: 'asScaleItem', DATE: 'asDateItem', DATETIME: 'asDateTimeItem', TIME: 'asTimeItem',
  }[type];
  if (!as) return out;

  let typed = null;
  try { typed = item[as](); } catch (e) { return out; }
  try { out.required = typed.isRequired(); } catch (e) { /* isRequired が無い型は false */ }

  try {
    if (typed.getChoices) {
      out.choices = typed.getChoices().map(function (c) { return c.getValue(); });
      out.hint = (type === 'CHECKBOX' ? '選択肢（カンマ区切りで複数可）: ' : '選択肢: ') + out.choices.join(' / ');
    }
    if (typed.hasOtherOption) out.other = typed.hasOtherOption();
    if (type === 'SCALE') out.hint = '数値 ' + typed.getLowerBound() + '〜' + typed.getUpperBound();
  } catch (e) {
    // 握り潰すと「選択肢が空」の原因が分からなくなる
    out.hint = '選択肢を取得できませんでした: ' + (e && e.message ? e.message : e);
  }
  return out;
}

/**
 * 前後の空白・全角半角・大文字小文字の違いを無視して選択肢に寄せる。
 * 寄せられなければ null。返すのはフォーム側の正式な表記。
 *
 * フォームの選択肢は目で見ても差が分からないことがある（末尾の空白、全角の英字、NBSP）。
 * 完全一致だけで弾くと「選択肢にあるのに無効と言われる」になる。
 */
function matchChoice_(allowed, value) {
  function norm(v) {
    return String(v).normalize('NFKC').replace(/[\s 　]+/g, '').toLowerCase();
  }
  const v = norm(value);
  for (let i = 0; i < allowed.length; i++) {
    if (norm(allowed[i]) === v) return allowed[i];
  }
  return null;
}

/** 項目の型に合わせて ItemResponse を作る。作れない型は null。 */
function responseFor_(item, value) {
  const t = String(item.getType());
  const s = String(value);
  if (t === 'TEXT') return item.asTextItem().createResponse(s);
  if (t === 'PARAGRAPH_TEXT') return item.asParagraphTextItem().createResponse(s);
  if (t === 'MULTIPLE_CHOICE') return item.asMultipleChoiceItem().createResponse(s);
  if (t === 'LIST') return item.asListItem().createResponse(s);
  if (t === 'CHECKBOX') {
    return item.asCheckboxItem()
      .createResponse(s.split(',').map(function (x) { return x.trim(); }).filter(String));
  }
  if (t === 'SCALE') return item.asScaleItem().createResponse(Number(s));
  if (t === 'DATE' || t === 'DATETIME' || t === 'TIME') {
    const d = (Object.prototype.toString.call(value) === '[object Date]') ? value : new Date(s);
    if (isNaN(d.getTime())) throw new Error('日付として読めません: ' + s);
    if (t === 'DATE') return item.asDateItem().createResponse(d);
    if (t === 'DATETIME') return item.asDateTimeItem().createResponse(d);
    return item.asTimeItem().createResponse(d.getHours(), d.getMinutes());
  }
  return null;   // FILE_UPLOAD など
}

/** 画面に出せれば出し、出せなければ実行ログへ。エディタから実行しても落ちないようにする。 */
function notify_(message) {
  Logger.log(message);
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) { /* エディタ実行時は UI が無い */ }
}
