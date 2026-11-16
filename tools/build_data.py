"""產生 extension/data/drugs.json(維護者用)。

資料來自聖星診所 iManager 每晚同步的兩份公開資料:
  健保署「健保用藥品項」(藥名、健保碼) × 食藥署開放資料(許可證 36、外觀 42、成分 43)。
只含藥品資料,沒有任何病人或處方資料。

用法(在 iManager 目錄):
  venv/bin/python manage.py shell -c "exec(open('/path/to/SeeUrMeds/tools/build_data.py').read())"
"""
import datetime
import json
import pathlib
import re
from collections import defaultdict

from clinic_helpers.models import NhiDrugRef, TfdaDrug

OUT = pathlib.Path.home() / 'D-star/SeeUrMeds/extension/data/drugs.json'

tf = {t.license_no: t for t in TfdaDrug.objects.all()}
by_norm = defaultdict(set)
for r in NhiDrugRef.objects.exclude(license_no='').exclude(name_norm=''):
    if r.license_no in tf:
        by_norm[r.name_norm].add(r.license_no)

# 同名多證:取有外觀照的第一張(與 iManager resolve_cloud_names 同規則)
pick = {}
for k, lics in by_norm.items():
    cands = [tf[x] for x in sorted(lics)]
    pick[k] = next((t for t in cands if t.pill_url), cands[0]).license_no

used = sorted(set(pick.values()))
idx = {lic: i for i, lic in enumerate(used)}


def img_id(url):
    m = re.search(r'/shapeImg/([0-9a-f-]{36})', url or '')
    return m.group(1) if m else ''


lic_rows = [[t.license_no, t.name_zh, t.name_en, t.form, t.ingredients, t.shape, t.colors, t.score,
             t.size_mm, t.marks, img_id(t.pill_url)] for t in (tf[x] for x in used)]
data = {
    'built': datetime.date.today().isoformat(),
    'fields': ['license', 'name_zh', 'name_en', 'form', 'ingredients', 'shape', 'colors', 'score',
               'size_mm', 'marks', 'img'],
    'lic': lic_rows,
    'names': {k: idx[v] for k, v in sorted(pick.items())},
}
OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
print(f'{OUT}  藥名 {len(pick)}  許可證 {len(used)}  有外觀照 {sum(1 for r in lic_rows if r[-1])}  '
      f'{OUT.stat().st_size / 1e6:.1f} MB')
