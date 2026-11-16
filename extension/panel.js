(function () {
  'use strict';
  const { groupMeds, lookup } = self.SeeUrMeds;
  const IMG = 'https://mcp.fda.gov.tw/insert/shapeImg/';
  const $ = (id) => document.getElementById(id);
  let dataPromise = null;

  const loadData = () => (dataPromise ||= fetch(chrome.runtime.getURL('data/drugs.json')).then((r) => r.json()));

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

  async function activeTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? tab.id : null;
  }

  async function refresh() {
    const list = $('list'), status = $('status');
    let meds = null;
    try {
      const id = await activeTabId();
      const res = id !== null ? await chrome.tabs.sendMessage(id, { type: 'seeurmeds:read' }) : null;
      meds = res && res.meds;
    } catch (e) { meds = null; }
    if (!meds) {
      list.replaceChildren();
      status.textContent = '這個分頁找不到用藥表格。請開啟健保雲端查詢系統的「雲端藥歷」，查到病人後再按「重新讀取」。剛安裝完要先重新整理雲端藥歷那一頁。';
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
