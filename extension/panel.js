(function () {
  'use strict';
  const { groupMeds, lookup, groupLabs } = self.SeeUrMeds;
  const IMG = 'https://mcp.fda.gov.tw/insert/shapeImg/';
  const $ = (id) => document.getElementById(id);
  let dataPromise = null, labDictPromise = null;

  const loadData = () => (dataPromise ||= fetch(chrome.runtime.getURL('data/drugs.json')).then((r) => r.json()));

  const loadLabDict = () => (labDictPromise ||= fetch(chrome.runtime.getURL('data/labs.json')).then((r) => r.json()));

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function medCard(m, info) {
    const card = el('div', 'med');
    const pic = el('div', 'pic');
    if (info && info.img) {
      const img = el('img');
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.alt = info.name_zh || m.drug;
      img.title = '點一下看原圖';
      img.src = IMG + info.img;
      img.addEventListener('click', () => window.open(IMG + info.img + '?c=o', '_blank', 'noopener'));
      img.addEventListener('error', () => { pic.textContent = '外觀照讀取失敗'; });
      pic.append(img);
    } else {
      pic.textContent = info ? '食藥署沒有這顆藥的外觀照' : '無外觀資料';
    }
    const body = el('div');
    body.append(el('div', 'name', m.drug));
    if (info && info.name_zh) body.append(el('div', 'zh', info.name_zh));
    const ing = m.ingredient || (info && info.ingredients);
    if (ing) body.append(el('div', 'sub', ing));
    if (info) {
      const parts = [['形狀', info.shape], ['顏色', info.colors], ['刻痕', info.score], ['標註', info.marks], ['尺寸', info.size_mm]]
        .filter(([, v]) => v);
      if (parts.length) {
        const look = el('div', 'look');
        parts.forEach(([k, v], i) => {
          if (i) look.append('　');
          look.append(el('b', '', k + ' '), v.replace(/;/g, '、'));
        });
        body.append(look);
      }
      if (info.form) body.append(el('span', 'tag', info.form));
    } else {
      body.append(el('div', 'sub nomatch', '對照表裡找不到這個藥名（中藥濃縮製劑沒有外觀資料）'));
    }
    const use = [m.usage, m.days && m.days + ' 天', m.qty && '總量 ' + m.qty].filter(Boolean).join('・');
    if (use) body.append(el('div', 'sub', use));
    card.append(pic, body);
    return card;
  }

  // ───────── 檢驗 ─────────
  const SVG = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, text) {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }
  const dayOf = (t) => Date.UTC(Math.floor(t / 10000), Math.floor(t / 100) % 100 - 1, t % 100) / 864e5;
  const fmt = (n) => String(Math.round(n * 100) / 100);

  // 趨勢圖:x 依日期、y 依數值;有參考範圍就畫底色帶。big=false 是列上的小圖
  function chart(points, big) {
    const pts = points.filter((p) => p.plot).slice().reverse();          // 舊到新
    const W = big ? 320 : 84, H = big ? 130 : 26, L = big ? 34 : 3, R = big ? 10 : 3, T = big ? 10 : 3, B = big ? 22 : 3;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: big ? 'chart' : 'spark', role: 'img' });
    const range = pts[pts.length - 1].range;
    let lo = Math.min(...pts.map((p) => p.num)), hi = Math.max(...pts.map((p) => p.num));
    if (big && range) { if (range.lo !== null) lo = Math.min(lo, range.lo); if (range.hi !== null) hi = Math.max(hi, range.hi); }
    if (hi === lo) { hi += 1; lo -= 1; }
    const lo0 = lo, hi0 = hi, pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const x0 = dayOf(pts[0].t), x1 = dayOf(pts[pts.length - 1].t);
    // 全部同一天(同日兩筆)就依序平均排開,不要疊成一條直線
    const X = (p) => L + (x1 === x0 ? (pts.length > 1 ? pts.indexOf(p) / (pts.length - 1) : 0.5) : (dayOf(p.t) - x0) / (x1 - x0)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    if (big && range) {
      const top = range.hi !== null ? Y(range.hi) : T, bottom = range.lo !== null ? Y(range.lo) : H - B;
      root.append(svg('rect', { x: L, y: top, width: W - L - R, height: Math.max(0, bottom - top), class: 'band' }));
    }
    if (big) {
      root.append(svg('text', { x: L - 4, y: Y(hi0) + 3, class: 'axis', 'text-anchor': 'end' }, fmt(hi0)));
      root.append(svg('text', { x: L - 4, y: Y(lo0) + 3, class: 'axis', 'text-anchor': 'end' }, fmt(lo0)));
      root.append(svg('text', { x: L, y: H - 6, class: 'axis' }, pts[0].date));
      if (pts.length > 1) root.append(svg('text', { x: W - R, y: H - 6, class: 'axis', 'text-anchor': 'end' }, pts[pts.length - 1].date));
    }
    root.append(svg('polyline', { points: pts.map((p) => X(p).toFixed(1) + ',' + Y(p.num).toFixed(1)).join(' '), class: 'line' }));
    pts.forEach((p, i) => {
      if (!big && i < pts.length - 1) return;
      const dot = svg('circle', { cx: X(p).toFixed(1), cy: Y(p.num).toFixed(1), r: big ? 3 : 2.2, class: 'dot ' + p.flag });
      dot.append(svg('title', {}, `${p.date}　${p.text} ${p.unit}　${p.source}`));
      root.append(dot);
    });
    return root;
  }

  // 參考值:讀得懂就寫成「70–100」「≤130」,讀不懂照原文
  const refText = (p) => (!p.range ? p.ref : p.range.lo !== null && p.range.hi !== null ? `${p.range.lo}–${p.range.hi}`
    : p.range.hi !== null ? '≤' + p.range.hi : '≥' + p.range.lo);
  const ARROW = { H: ' ↑', L: ' ↓' };
  const short = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

  function labRow(g) {
    const box = el('details', 'lab');
    const sum = el('summary');
    const p0 = g.points[0], n = g.points.filter((p) => p.plot).length;
    sum.append(el('span', 'lname' + (g.matched ? '' : ' raw'), g.name));
    const mid = el('span', 'lspark');
    if (n >= 2) mid.append(chart(g.points, false));
    sum.append(mid);
    const val = el('span', 'lval ' + p0.flag, short(p0.text, 14) + (ARROW[p0.flag] || ''));
    if (p0.unit) val.append(el('small', '', ' ' + p0.unit));
    sum.append(val, el('span', 'ldate', p0.date + (g.points.length > 1 ? `・共 ${g.points.length} 次` : '')));
    box.append(sum);
    box.addEventListener('toggle', () => {
      if (!box.open || box.dataset.done) return;
      box.dataset.done = '1';
      if (n >= 2) box.append(chart(g.points, true));
      const table = el('table', 'hist');
      for (const p of g.points) {
        const tr = el('tr', p.flag);
        tr.append(el('td', '', p.date), el('td', 'v', p.text + (ARROW[p.flag] || '') + (p.unit ? ' ' + p.unit : '')),
          el('td', 'sub', [p.ref && '參考 ' + refText(p), p.source, p.item !== g.name && '原名：' + p.item,
            p.num !== null && !p.plot && '單位不同，未畫進圖'].filter(Boolean).join('・')));
        table.append(tr);
      }
      box.append(table);
    });
    return box;
  }

  async function renderLabs(labs) {
    const list = $('list'), status = $('status');
    if (!labs.length) { list.replaceChildren(); status.textContent = '檢驗表格是空的。'; return; }
    const dict = await loadLabDict();
    $('built').textContent = '檢驗名稱字典 ' + dict.built + '。';
    const frag = document.createDocumentFragment();
    let kinds = 0, trend = 0;
    for (const c of groupLabs(labs, dict)) {
      const fold = c.cat === '影像與篩檢';
      const wrap = fold ? el('details', 'cat') : frag;
      if (fold) { wrap.append(el('summary', '', `${c.cat}（${c.items.length} 項，不是檢驗數值，點開看）`)); frag.append(wrap); }
      else frag.append(el('h2', '', c.cat));
      for (const g of c.items) {
        kinds++; if (g.points.filter((p) => p.plot).length >= 2) trend++;
        wrap.append(labRow(g));
      }
    }
    list.replaceChildren(frag);
    status.textContent = `畫面上 ${labs.length} 筆，整理成 ${kinds} 種，${trend} 種有兩次以上可看趨勢。異常值變色：↑ 紅、↓ 藍，依各院所自己的參考值；健保雲端標紅的列也算。單位不同不換算。只讀目前這一頁顯示的列。`;
  }

  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? tab.id : null;
  }

  async function refresh() {
    const list = $('list'), status = $('status');
    let meds = null, labs = null;
    try {
      const id = await activeTabId();
      const res = id !== null ? await chrome.tabs.sendMessage(id, { type: 'seeurmeds:read' }) : null;
      meds = res && res.meds; labs = res && res.labs;
    } catch (e) { meds = null; }
    document.body.classList.toggle('labs', !meds && !!labs);
    if (!meds && labs) return renderLabs(labs);
    if (!meds) {
      list.replaceChildren();
      status.textContent = '這個分頁找不到用藥或檢驗表格。請開啟健保雲端查詢系統的「雲端藥歷」或「檢查與檢驗 → 檢查檢驗結果」，查到病人後再按「重新讀取」。剛安裝或更新後要先重新整理健保雲端那一頁。';
      return;
    }
    if (!meds.length) { list.replaceChildren(); status.textContent = '用藥表格是空的。'; return; }
    const data = await loadData();
    $('built').textContent = '對照表 ' + data.built + '。';
    const frag = document.createDocumentFragment();
    let hit = 0, total = 0;
    for (const g of groupMeds(meds)) {
      const h = el('h2', '', g.date || '（沒有日期）');
      if (g.icd) h.append(el('span', 'icd', g.icd));
      h.append(el('small', '', g.source));
      frag.append(h);
      for (const m of g.items) {
        const info = lookup(data, m.drug);
        total++; if (info && info.img) hit++;
        frag.append(medCard(m, info));
      }
    }
    list.replaceChildren(frag);
    status.textContent = `畫面上 ${meds.length} 筆，合併後 ${total} 項，${hit} 項有外觀照。只讀目前這一頁顯示的列。`;
  }

  $('reload').addEventListener('click', refresh);
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg || msg.type !== 'seeurmeds:changed' || !sender.tab) return;
    activeTabId().then((id) => { if (id === sender.tab.id) refresh(); });
  });
  chrome.tabs.onActivated.addListener(refresh);
  refresh();
})();
