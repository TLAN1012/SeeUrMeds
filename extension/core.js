// 藥看仔細 SeeUrMeds — 不碰 chrome API 的純函式,content script、側欄、測試共用
(function (root) {
  'use strict';

  const PACK = /[(（](鋁箔|塑膠瓶|玻璃瓶|盒裝|瓶裝|PTP|塑瓶|鋁袋)[^)）]*[)）]/g;

  // 藥名正規化:去包裝註記,只留英文大寫、數字、中文(與 tools/build_data.py 的資料同一套規則)
  function normName(name) {
    return (name || '').toUpperCase().replace(PACK, '').replace(/[^A-Z0-9一-鿿]/g, '').slice(0, 300);
  }

  // 從主診斷欄取 ICD-10 碼(例「急性上呼吸道感染 J069」→ J069);取不到回空字串
  function icdCode(text) {
    const m = /\b[A-Z]\d[0-9A-Z](?:\.?[0-9A-Z]{1,4})?\b/.exec((text || '').toUpperCase());
    return m ? m[0] : '';
  }

  const squash = (s) => (s || '').replace(/\s+/g, '');
  const clean = (s) => (s || '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const cellText = (el) => clean(el.innerText !== undefined ? el.innerText : el.textContent);

  // 表頭關鍵字 → 欄位。用「包含」比對,健保署改欄名的空白或換行不會壞
  const COLS = [
    ['drug', '藥品名稱'], ['ingredient', '成分名稱'], ['date', '就醫日期'], ['source', '來源'],
    ['usage', '用法用量'], ['days', '給藥日數'], ['qty', '藥品用量'], ['diag', '主診斷'],
  ];

  function headerMap(cells) {
    const map = {};
    cells.forEach((c, i) => {
      const t = squash(String(c.textContent).split('\n')[0]);
      for (const [key, label] of COLS) if (!(key in map) && t.includes(label)) map[key] = i;
    });
    return ('drug' in map && 'date' in map) ? map : null;
  }

  // 把表格展開成矩形格子:rowspan 向下重複(同一次就醫的院所、日期合併儲存格),colspan 只填第一格
  function expandTable(table) {
    const trs = Array.from(table.rows || table.querySelectorAll('tr'));
    const grid = trs.map(() => []);
    trs.forEach((tr, r) => {
      let c = 0;
      for (const cell of Array.from(tr.children).filter((x) => /^(TH|TD)$/.test(x.tagName))) {
        while (grid[r][c] !== undefined) c++;
        const rs = Math.min(cell.rowSpan || 1, trs.length - r), cs = cell.colSpan || 1;
        const text = cellText(cell);
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = dc === 0 ? text : '';
        c += cs;
      }
    });
    return grid.map((row) => Array.from(row, (v) => (v === undefined ? '' : v)));
  }

  // 在文件裡找用藥表格。表頭與內容可能被拆成兩張 table(凍結表頭的表格元件),所以內容列另外找
  function findMedTable(doc) {
    for (const table of doc.querySelectorAll('table')) {
      const grid = expandTable(table);
      for (let r = 0; r < grid.length; r++) {
        const map = headerMap(grid[r].map((t) => ({ textContent: t })));
        if (!map) continue;
        const n = grid[r].length;
        let rows = grid.slice(r + 1).filter((row) => row.length === n);
        if (!rows.length) {
          let box = table.parentElement;
          for (let i = 0; i < 4 && box && !rows.length; i++, box = box.parentElement) {
            for (const other of box.querySelectorAll('table')) {
              if (other === table || table.contains(other) || other.contains(table)) continue;
              rows = rows.concat(expandTable(other).filter((row) => row.length === n));
            }
          }
        }
        return { table, map, rows };
      }
    }
    return null;
  }

  function readMeds(doc) {
    const found = findMedTable(doc);
    if (!found) return null;
    const { map, rows } = found;
    const get = (row, key) => (key in map && row[map[key]] ? row[map[key]] : '');
    const meds = [];
    for (const row of rows) {
      const drug = get(row, 'drug').replace(/\n/g, ' ');
      if (!drug || squash(drug) === '藥品名稱') continue;
      meds.push({
        drug,
        ingredient: get(row, 'ingredient').replace(/\n/g, ' '),
        date: squash(get(row, 'date')),
        source: get(row, 'source').split('\n')[0],     // 只留院所名,不留機構代碼
        usage: get(row, 'usage').replace(/\n/g, ' '),
        days: squash(get(row, 'days')),
        qty: squash(get(row, 'qty')),
        icd: icdCode(get(row, 'diag')),
      });
    }
    return meds;
  }

  // 依就醫日期(新到舊)+ 院所分組;同組同藥合併
  function groupMeds(meds) {
    const groups = new Map();
    for (const m of meds) {
      const key = m.date + '\u0001' + m.source + '\u0001' + (m.icd || '');
      if (!groups.has(key)) groups.set(key, { date: m.date, source: m.source, icd: m.icd || '', items: new Map() });
      const items = groups.get(key).items;
      const k = normName(m.drug) || m.drug;
      if (!items.has(k)) items.set(k, m);
    }
    return Array.from(groups.values())
      .map((g) => ({ date: g.date, source: g.source, icd: g.icd, items: Array.from(g.items.values()) }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function lookup(data, drugName) {
    const i = data.names[normName(drugName)];
    if (i === undefined) return null;
    const row = data.lic[i], o = {};
    data.fields.forEach((f, j) => { o[f] = row[j]; });
    return o;
  }

  const api = { icdCode, normName, readMeds, groupMeds, lookup, findMedTable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeeUrMeds = api;
})(typeof self !== 'undefined' ? self : this);
