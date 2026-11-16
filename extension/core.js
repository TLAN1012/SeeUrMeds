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
      const t = squash(String(c.textContent));     // 表頭常一字一行(給/藥/日/數),整格去空白再比
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
    return grid.map((row, r) => Object.assign(Array.from(row, (v) => (v === undefined ? '' : v)), { tr: trs[r] }));
  }

  // 健保雲端自己把異常的列標成紅字;讀得到就拿來用(參考值分男女、或寫法認不得時靠它)
  function markedRed(tr) {
    const view = tr && tr.ownerDocument && tr.ownerDocument.defaultView;
    if (!view || !view.getComputedStyle) return false;
    for (const td of Array.from(tr.children)) {
      for (const node of [td, td.firstElementChild]) {
        const m = node && /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(view.getComputedStyle(node).color || '');
        if (m && +m[1] > 150 && +m[1] - Math.max(+m[2], +m[3]) > 70) return true;
      }
    }
    return false;
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

  // ───────── 檢驗 ─────────
  const LAB_COLS = [
    ['item', '檢驗項目'], ['result', '檢驗結果'], ['date', '檢驗日期'], ['unit', '單位'],
    ['ref', '參考值'], ['specimen', '檢體'], ['source', '來源'],
  ];

  function labHeaderMap(cells) {
    const map = {};
    cells.forEach((c, i) => {
      const t = squash(String(c).split('\n')[0]);
      for (const [key, label] of LAB_COLS) if (!(key in map) && t.includes(label)) map[key] = i;
    });
    return ('item' in map && 'result' in map) ? map : null;
  }

  // 找「檢查檢驗結果」表格(表頭要同時有 檢驗項目、檢驗結果);表頭與內容分兩張 table 的情形同用藥表
  function findLabTable(doc) {
    for (const table of doc.querySelectorAll('table')) {
      const grid = expandTable(table);
      for (let r = 0; r < grid.length; r++) {
        const map = labHeaderMap(grid[r]);
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

  const oneLine = (s) => (s || '').replace(/\s*\n\s*/g, ' ').trim();

  function readLabs(doc) {
    const found = findLabTable(doc);
    if (!found) return null;
    const { map, rows } = found;
    const get = (row, key) => (key in map && row[map[key]] ? row[map[key]] : '');
    const labs = [];
    for (const row of rows) {
      const item = oneLine(get(row, 'item'));
      if (!item || squash(item) === '檢驗項目') continue;
      labs.push({
        item,
        result: oneLine(get(row, 'result')),
        unit: oneLine(get(row, 'unit')),
        ref: oneLine(get(row, 'ref')),
        specimen: oneLine(get(row, 'specimen')),
        date: squash(get(row, 'date')),
        source: get(row, 'source').split('\n')[0],     // 只留院所名
        marked: markedRed(row.tr),
      });
    }
    return labs;
  }

  // 項目名稱正規化:全形轉半形、小寫、去開頭的健保醫令碼、空白壓成一格
  function normLabName(name) {
    return (name || '').normalize('NFKC').toLowerCase().replace(/^\s*\d{5}[a-z]\d?\s*[-:]?\s*/, '')
      .replace(/\s+/g, ' ').trim();
  }

  // 檢體:'u' 尿液、'b' 血液、'' 看不出來。尿素氮、尿酸的「尿」不算
  function labCtx(lab) {
    const name = normLabName(lab.item).replace(/尿素氮|尿酸|尿素/g, '');
    const sp = (lab.specimen || '').toLowerCase();
    if (/尿|urine/.test(sp) || /尿|urine|urinary|\(u\)|\bu-|sediment/.test(name) || /\/\s*[hl]pf/i.test(lab.unit + ' ' + lab.result)) return 'u';
    if (/血|serum|plasma/.test(sp) || /血清|serum|gas|vein|\(v\)|arter|靜脈|動脈/.test(name)) return 'b';
    return '';
  }

  function compileLabDict(dict) {
    if (!dict._rules) {
      Object.defineProperty(dict, '_rules', { value: dict.items.map((it) => ({ ...it, rx: new RegExp(it.re, 'i') })) });
    }
    return dict._rules;
  }

  // 回傳字典項目;對不到回 null(不猜)
  function matchLab(dict, lab) {
    const name = normLabName(lab.item), ctx = labCtx(lab);
    if (dict.skip && (dict._skip || Object.defineProperty(dict, '_skip', { value: new RegExp(dict.skip, 'i') })._skip).test(name)) return null;
    for (const r of compileLabDict(dict)) {
      if (r.ctx === 'u' && ctx !== 'u') continue;
      if (r.ctx === 'b' && ctx !== 'b') continue;
      if (r.ctx === 'u?' && ctx === 'b') continue;
      if (r.ctx === 'b?' && ctx === 'u') continue;
      if (r.rx.test(name)) return r;
    }
    return null;
  }

  const normUnit = (u) => (u || '').normalize('NFKC').toLowerCase().replace(/[\s^]/g, '').replace(/[μµ]/g, 'u')
    .replace(/^(-|無|none|na|n\/a)$/, '');
  const unitCompat = (a, b) => !a || !b || a === b || a.startsWith(b) || b.startsWith(a);

  // 檢驗結果 → 數值與顯示文字。「32.1 g/dL」→ 32.1;「Negative -」→ 文字 Negative;「<0.5」保留比較符號
  function parseResult(result, unit) {
    let text = (result || '').normalize('NFKC').trim();      // 全形數字、全形 < > 轉半形
    unit = (unit || '').normalize('NFKC');
    if (unit && text.toLowerCase().endsWith(unit.toLowerCase())) text = text.slice(0, text.length - unit.length).trim();
    text = text.replace(/\s+-$/, '').trim();
    const m = /^([<>≦≧≤≥]=?)?\s*(-?\d+(?:,\d{3})*(?:\.\d+)?)(?![\d\/:+-])/.exec(text);
    let num = null, rest = '';
    if (m) {
      num = parseFloat(m[2].replace(/,/g, ''));
      rest = text.slice(m[0].length).trim();
      if (!unit && rest) { unit = rest; }
      text = (m[1] || '') + m[2];
    }
    return { text, num: m && !m[1] ? num : null, approx: m && m[1] ? num : null, op: m && m[1] ? m[1][0] : '', unit: unit || '' };
  }

  // 參考值 →{lo, hi}。看得懂的格式:[31-36][]、[上限][下限]、<130、>60、3.5~5.0;[0][0]、分男女的不判斷
  function parseRef(ref) {
    const t = (ref || '').normalize('NFKC').replace(/\s+/g, '');
    if (!t || /男|女|[mf]:/i.test(t)) return null;
    const parts = Array.from(t.matchAll(/\[([^\]]*)\]/g), (m) => m[1]);
    const num = (s) => (/^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null);
    const range = (s) => {
      let m = /^(-?\d+(?:\.\d+)?)[-~~至](-?\d+(?:\.\d+)?)$/.exec(s);
      if (m) return { lo: parseFloat(m[1]), hi: parseFloat(m[2]) };
      m = /^[<≦≤]=?(\d+(?:\.\d+)?)$/.exec(s);
      if (m) return { lo: null, hi: parseFloat(m[1]) };
      m = /^[>≧≥]=?(\d+(?:\.\d+)?)$/.exec(s);
      if (m) return { lo: parseFloat(m[1]), hi: null };
      return null;
    };
    let out = null;
    if (parts.length) {
      const a = parts[0], b = parts[1] || '';
      out = range(a) || (a === '' ? range(b) : null);       // 有的院所寫成 [][<150]
      if (!out && num(a) !== null && num(b) !== null) out = { lo: num(b), hi: num(a) };
      if (!out && num(a) !== null && b === '') out = null;
    } else out = range(t);
    if (!out) return null;
    if ((out.lo || 0) === 0 && (out.hi || 0) === 0) return null;
    if (out.lo !== null && out.hi !== null && out.lo > out.hi) return null;
    return out;
  }

  // op:結果寫成「>1000」「<0.5」時的符號。只有方向確定才判(>1000 超過上限算高;<0.5 不知道實際多少,不拿來判高)
  function labFlag(num, ref, approx, op) {
    if (num === null && ref && approx != null) {
      if (/[>≧≥]/.test(op) && ref.hi !== null && approx >= ref.hi) return 'H';
      if (/[<≦≤]/.test(op) && ref.lo !== null && approx <= ref.lo) return 'L';
      return '';
    }
    if (num === null || !ref) return '';
    if (ref.hi !== null && num > ref.hi) return 'H';
    if (ref.lo !== null && num < ref.lo) return 'L';
    return '';
  }

  // 民國或西元日期 → 可比較的數字(yyyymmdd);看不懂回 0
  function dateNum(d) {
    const m = /^(\d{2,4})[\/.-](\d{1,2})[\/.-](\d{1,2})/.exec(d || '');
    if (!m) return 0;
    const y = +m[1] < 1911 ? +m[1] + 1911 : +m[1];
    return y * 10000 + +m[2] * 100 + +m[3];
  }

  // 長期用藥:最近半年內、給藥日數 ≥ 28 天;同一個藥(不分院所、不分次)只留最近一次,新到舊
  // today:Date,預設現在
  function longTermMeds(meds, today) {
    const t = today || new Date();
    const c = new Date(t.getFullYear(), t.getMonth() - 6, t.getDate());
    const cutoff = c.getFullYear() * 10000 + (c.getMonth() + 1) * 100 + c.getDate();
    const seen = new Map();
    for (const m of meds) {
      const d = dateNum(m.date);
      if (!d || d < cutoff || !(parseInt(m.days, 10) >= 28)) continue;
      const k = normName(m.drug) || m.drug;
      const old = seen.get(k);
      if (!old || d > old.d) seen.set(k, { d, m });
    }
    return Array.from(seen.values()).sort((a, b) => b.d - a.d).map((x) => x.m);
  }

  // 同一種檢驗(不分院所、不分寫法)收在一起,新到舊;對不到字典的照原名各自成組放「其他」
  function groupLabs(labs, dict) {
    const groups = new Map();
    for (const lab of labs) {
      const hit = matchLab(dict, lab);
      const key = hit ? hit.key : 'raw:' + normLabName(lab.item) + (labCtx(lab) === 'u' ? '|u' : '');
      if (!groups.has(key)) {
        const nonlab = !hit && dict.nonlab && new RegExp(dict.nonlab, 'i').test(normLabName(lab.item));
        groups.set(key, { key, name: hit ? hit.name : lab.item, cat: hit ? hit.cat : nonlab ? '影像與篩檢' : '未歸類', matched: !!hit, points: [], seen: new Set() });
      }
      const g = groups.get(key);
      const r = parseResult(lab.result, lab.unit), ref = parseRef(lab.ref);
      const sig = [lab.date, lab.source, lab.item, lab.result].join('\u0001');
      if (g.seen.has(sig)) continue;
      g.seen.add(sig);
      g.points.push({
        date: lab.date, t: dateNum(lab.date), text: r.text, num: r.num, unit: r.unit, ref: lab.ref, range: ref,
        flag: labFlag(r.num, ref, r.approx, r.op) || (lab.marked ? 'A' : ''), source: lab.source, item: lab.item,   // A=健保雲端標紅,方向不明
      });
    }
    const out = dict.cats.map((cat) => ({ cat, items: [] }));
    for (const g of groups.values()) {
      g.points.sort((a, b) => b.t - a.t);
      // 圖只畫單位相同(或沒寫單位)的數值;以最新一筆有單位的為準,不換算
      const base = normUnit((g.points.find((p) => p.num !== null && normUnit(p.unit)) || {}).unit);
      for (const p of g.points) p.plot = p.num !== null && p.t > 0 && unitCompat(normUnit(p.unit), base);
      delete g.seen;
      out.find((c) => c.cat === g.cat).items.push(g);
    }
    for (const c of out) c.items.sort((a, b) => (b.points[0].t - a.points[0].t) || a.name.localeCompare(b.name));
    return out.filter((c) => c.items.length);
  }

  const api = { icdCode, normName, readMeds, groupMeds, lookup, findMedTable,
    readLabs, findLabTable, normLabName, labCtx, matchLab, parseResult, parseRef, labFlag, dateNum, groupLabs, longTermMeds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeeUrMeds = api;
})(typeof self !== 'undefined' ? self : this);
