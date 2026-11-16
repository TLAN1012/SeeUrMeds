// 只讀用藥表格(藥名、成分、就醫日期、院所、用法、天數、主診斷 ICD-10 碼)與檢驗表格(項目、結果、單位、參考值、檢體、日期、院所);不讀身分欄位、不存檔、不連網
(function () {
  'use strict';
  const { readMeds, readLabs } = self.SeeUrMeds;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'seeurmeds:read') return;
    const meds = readMeds(document), labs = meds ? null : readLabs(document);
    if (meds || labs) sendResponse({ meds, labs });   // 沒有表格的 frame 不回話,讓有表格的 frame 回
  });

  // 表格內容變了(換病人、換頁、排序)就通知側欄重讀
  let timer = null, last = '';
  const notify = () => {
    const meds = readMeds(document), labs = meds ? null : readLabs(document);
    if (!meds && !labs && !last) return;
    // 表格不見了(換病人、離開用藥頁)也要通知,側欄才會清掉上一位的結果
    const sig = meds ? meds.length + '|' + meds.map((m) => m.date + m.icd + m.drug).join('|')
      : labs ? 'L' + labs.length + '|' + labs.map((l) => l.date + l.item + l.result).join('|') : '';
    if (sig === last) return;
    last = sig;
    try { chrome.runtime.sendMessage({ type: 'seeurmeds:changed' }).catch(() => {}); } catch (e) { /* 側欄沒開 */ }
  };
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(notify, 600); })
    .observe(document.documentElement, { childList: true, subtree: true });
})();
