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
