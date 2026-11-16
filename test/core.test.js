// node test/core.test.js — 不需要瀏覽器的檢查:藥名正規化與對照表
const assert = require('assert');
const c = require('../extension/core.js');
const d = require('../extension/data/drugs.json');

assert.strictEqual(c.normName('Levofloxacin F.C. Tablets 100mg "CYH"'), 'LEVOFLOXACINFCTABLETS100MGCYH');
assert.strictEqual(c.normName('ABC TAB (鋁箔/膠箔)'), 'ABCTAB');
assert.strictEqual(c.normName('"井田" 喘嗽安錠３公絲'), '井田喘嗽安錠公絲');

const hit = c.lookup(d, 'RIVOTRIL 0.5MG TABLET');
assert.ok(hit && hit.img && hit.shape === '圓形', 'RIVOTRIL 應對得到外觀');
const noPic = c.lookup(d, 'SINDELIN S.C. TABLETS');
assert.ok(noPic && !noPic.img, 'SINDELIN 有許可證但沒有外觀照');
assert.strictEqual(c.lookup(d, '加味逍遙散濃縮顆粒'), null, '對不到就回 null,不猜');

assert.strictEqual(c.icdCode('急性上呼吸道感染 J069'), 'J069');
assert.strictEqual(c.icdCode('癲癇 G40.909'), 'G40.909');
assert.strictEqual(c.icdCode('失眠'), '');

const g = c.groupMeds([
  { drug: 'A TAB', date: '115/11/03', source: '甲' }, { drug: 'A TAB', date: '115/11/03', source: '甲' },
  { drug: 'B TAB', date: '115/11/14', source: '乙' },
]);
assert.deepStrictEqual(g.map((x) => [x.date, x.items.length]), [['115/11/14', 1], ['115/11/03', 1]]);
console.log('core ok;對照表', d.built, Object.keys(d.names).length, '個藥名');

// ── 檢驗 ──
const L = require('../extension/data/labs.json');
const key = (item, extra) => { const m = c.matchLab(L, { item, unit: '', result: '', specimen: '', ...extra }); return m ? m.key : null; };
const same = (k, names) => names.forEach((n) => assert.strictEqual(key(n), k, n + ' 應歸到 ' + k));
same('HBA1C', ['HbA1c', '09006C醣化血紅素', 'Hb-A1c', '醣化血色素']);
same('HB', ['Hgb', 'Hemoglobin 血色素', 'Hb']);
same('MCHC', ['MCHC', 'MCHC 平均血球色素濃度', 'MCHC(平均血球血紅素濃度)']);
same('MCH', ['MCH', 'MCH平均紅血球血紅素量']);
same('ALT', ['ALT(GPT)', 'SGPT(ALT或GPT)', '血清麩胺酸丙酮酸轉氨基?']);
same('GLU_AC', ['Glucose(AC)', '飯前血糖 Glucose', 'Glucose A.C.']);
same('GLU_POC', ['One Touch血糖檢驗', 'Finger stick AC']);
same('LDL', ['LDL-C', '低密度脂蛋白膽固醇(LDL)', 'L.D.L.']);
same('TC', ['總膽固醇', 'Cholestero1, total']);
same('CRE', ['Creatinine', 'CRE(肌酸酐)']);
same('BUN', ['血中尿素氮', 'BUN']);                       // 「尿」素氮不是尿液
assert.strictEqual(key('Creatinine(U)'), 'U_CRE');
assert.strictEqual(key('WBC', { specimen: '尿液' }), 'U_WBC', '尿液的 WBC 不可和血液的混在一起');
assert.strictEqual(key('WBC', { unit: '/HPF' }), 'U_WBC');
assert.strictEqual(key('WBC', { specimen: '血液' }), 'WBC');
assert.strictEqual(key('Glucose', { specimen: '尿液' }), 'U_GLU');
assert.strictEqual(key('Protein', { specimen: '血液' }), null);
[['CA-125', 'CA125'], ['Ca', 'CA'], ['K他命(定性)', null], ['卵白蛋白', null], ['P.T. Control', null],
  ['PCT,前降鈣素原(Procalcitonin)', null], ['f1 Egg white 蛋白', null], ['(外)HCV PCR', null], ['Hct,血球容積比', 'HCT'],
  ['全套血液檢查Ｉ（八項） ;(CBC-I(WBC,RBC,HB,HCT,PLATELET COUNT,MCV,MCH,MCHC))', null],
  ['紅血球分佈變異係數', 'RDW'], ['Valproic acid', null]].forEach(([n, k]) => assert.strictEqual(key(n), k, n));

assert.deepStrictEqual(c.parseResult('32.1 g/dL', 'g/dL'), { text: '32.1', num: 32.1, approx: null, op: '', unit: 'g/dL' });
assert.strictEqual(c.parseResult('Negative -', '').text, 'Negative');
assert.strictEqual(c.parseResult('3-5 /HPF', '/HPF').num, null, '範圍不是單一數值');
assert.strictEqual(c.parseResult('<0.5', '').num, null);
assert.strictEqual(c.parseResult('1+ -', '').num, null);
assert.deepStrictEqual(c.parseRef('[31-36][]'), { lo: 31, hi: 36 });
assert.deepStrictEqual(c.parseRef('[33.2][25.5]'), { lo: 25.5, hi: 33.2 });
assert.deepStrictEqual(c.parseRef('[<130][]'), { lo: null, hi: 130 });
assert.strictEqual(c.parseRef('[0][0]'), null);
assert.strictEqual(c.parseRef('[男:4.5-6.0 女:4.0-5.5][]'), null, '分男女的不判斷');
assert.strictEqual(c.labFlag(37, { lo: 31, hi: 36 }), 'H');
assert.strictEqual(c.dateNum('115/11/03'), 20261103);

const gl = c.groupLabs([
  { item: 'HbA1c', result: '6.8 %', unit: '%', ref: '[4.0-6.0][]', specimen: '血液', date: '115/10/20', source: '甲' },
  { item: '09006C醣化血紅素', result: '7.1 %', unit: '%', ref: '[4-6][]', specimen: '', date: '115/09/02', source: '乙' },
  { item: 'WBC', result: '6.2 10^3/uL', unit: '10^3/uL', ref: '', specimen: '血液', date: '115/10/20', source: '甲' },
  { item: 'WBC 白血球', result: '7100 /uL', unit: '/uL', ref: '', specimen: '', date: '115/01/15', source: '乙' },
  { item: '沒看過的檢驗', result: '5', unit: '', ref: '', specimen: '', date: '115/01/15', source: '乙' },
], L);
const a1c = gl.find((x) => x.cat === '血糖').items[0];
assert.deepStrictEqual(a1c.points.map((p) => [p.date, p.num, p.flag, p.plot]), [['115/10/20', 6.8, 'H', true], ['115/09/02', 7.1, 'H', true]]);
const wbc = gl.find((x) => x.cat === '血液常規').items[0];
assert.deepStrictEqual(wbc.points.map((p) => p.plot), [true, false], '單位不同不畫進同一張圖');
assert.strictEqual(gl.find((x) => x.cat === '未歸類').items[0].name, '沒看過的檢驗', '對不到的照原名列出,不丟掉');
console.log('labs ok;字典', L.built, L.items.length, '條規則');
assert.deepStrictEqual(c.parseRef('[][＜150]'), { lo: null, hi: 150 }, '上限寫在第二個括號');
assert.deepStrictEqual(c.parseRef('[][ < 200]'), { lo: null, hi: 200 });
assert.strictEqual(c.parseRef('[M:＞40 ; F:＞50][]'), null);
{
  const g = c.groupLabs([{ item: 'Creatinine', result: '1.42 mg/dL', unit: 'mg/dL', ref: '[男:0.7-1.3 女:0.6-1.1][]', specimen: '血液', date: '115/10/20', source: 'x', marked: true }], L);
  assert.strictEqual(g.find((x) => x.items.length).items[0].points[0].flag, 'A', '參考值分男女時用健保雲端的紅字');
}
assert.strictEqual(c.parseResult('１２.３ g/dL', 'g/dL').num, 12.3, '全形數字');
{
  const hi = c.parseResult('>1000 U/L', 'U/L'), lo = c.parseResult('<0.5 mg/dL', 'mg/dL');
  assert.strictEqual(c.labFlag(hi.num, { lo: 0, hi: 40 }, hi.approx, hi.op), 'H', '>1000 超過上限');
  assert.strictEqual(c.labFlag(lo.num, { lo: 0.7, hi: 1.3 }, lo.approx, lo.op), 'L', '<0.5 低於下限');
  assert.strictEqual(c.labFlag(lo.num, { lo: null, hi: 5 }, lo.approx, lo.op), '', '<0.5 不判高');
  assert.strictEqual(c.labFlag(hi.num, { lo: 2000, hi: null }, hi.approx, hi.op), '', '>1000 不判低');
}
{
  const mk = (drug, date, days, source) => ({ drug, date, days: String(days), source: source || 'A', usage: 'QD', ingredient: '' });
  const meds = [mk('NORVASC TABLETS 5MG', '115/10/20', 28), mk('NORVASC TABLETS 5MG', '115/08/25', 84, 'B'), mk('GLUCOPHAGE 500MG', '115/09/01', 30),
    mk('LIPITOR 10MG', '115/02/10', 28), mk('KEPPRA 500MG', '115/09/01', 27), mk('X', '', 28), mk('Y', '115/11/01', '')];
  const out = c.longTermMeds(meds, new Date(2026, 10, 16));
  assert.deepStrictEqual(out.map((m) => m.drug + '@' + m.date), ['NORVASC TABLETS 5MG@115/10/20', 'GLUCOPHAGE 500MG@115/09/01'], '長期用藥:半年內、≥28 天、去重留最近');
  assert.strictEqual(c.longTermMeds([mk('A', '115/05/16', 28)], new Date(2026, 10, 16)).length, 1, '剛好半年算在內');
  assert.strictEqual(c.longTermMeds([mk('A', '115/05/15', 28)], new Date(2026, 10, 16)).length, 0, '超過半年不算');
}
