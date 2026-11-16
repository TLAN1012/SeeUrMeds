#!/usr/bin/env python3
"""檢驗名稱字典的原始檔。改這裡,再跑 `python3 tools/build_labs.py` 產生 extension/data/labs.json。

每一列:(代號, 顯示名稱, 分類, 比對式, 檢體條件)
- 比對式是不分大小寫的正規表示式,對象是「正規化後的項目名稱」
  (全形轉半形、小寫、去掉開頭的健保醫令碼、空白壓成一格)。
- 由上往下比,第一個符合的算數,所以範圍小的要排在前面(HbA1c 在 Hb 前、MCHC 在 MCH 前)。
- 檢體條件:'u' 一定要是尿液、'u?' 尿液或不明、'b' 一定要是血液、'b?' 血液或不明、'' 不限。
"""
import json, os, datetime

CATS = ['血糖', '血脂', '腎功能', '肝功能', '電解質', '血液常規', '甲狀腺', '肝炎標記', '發炎與感染',
        '心臟', '腫瘤標記', '凝血', '貧血與營養', '尿液', '糞便', '生理量測', '其他', '未歸類', '影像與篩檢']

R = [
    # ── 血糖 ──
    ('HBA1C', 'HbA1c 醣化血色素', '血糖', r'hb\s*-?\s*a1c|\ba1c\b|[醣糖]化血[色紅]素', ''),
    ('GLU_POC', '指尖血糖', '血糖', r'one\s*touch|finger\s*-?su[gr]|finger\s*stick|指尖|扎針|血糖機', ''),
    ('GLU_AC', '飯前血糖', '血糖', r'(飯前|空腹).*(血糖|葡萄糖|glucose|sugar)|(血糖|葡萄糖).*(飯前|空腹)|(glucose|\bglu|sugar|血糖).*\ba\.?c\b|ante\s*cibum|\bac\s*(sugar|glucose)|fasting', ''),
    ('GLU_PC', '飯後血糖', '血糖', r'(飯後|餐後).*(血糖|葡萄糖|glucose|sugar)|(血糖|葡萄糖).*(飯後|餐後)|(glucose|\bglu|sugar|血糖).*(\bp\.?c\b|2\s*hr)|post\s*cibum|\bpc\s*(sugar|glucose)|postprandial', ''),
    # ── 血脂 ──
    ('CHOL_HDL', '總膽固醇/HDL 比值', '血脂', r'/\s*hdl|血管硬化|動脈硬化指數|risk\s*factor', ''),
    ('LDL', 'LDL 低密度膽固醇', '血脂', r'ldl|l\.d\.l|低密度', ''),
    ('HDL', 'HDL 高密度膽固醇', '血脂', r'hdl|h\.d\.l|高密度', ''),
    ('TG', 'TG 三酸甘油酯', '血脂', r'\btg\b|triglycerid|三酸甘油', ''),
    ('TC', '總膽固醇', '血脂', r'膽固醇|cholester[o0][l1]|\bt\.?-?chol?\b|\bchol?\b|\btc\b', ''),
    # ── 腎功能 ──
    ('EGFR', 'eGFR 腎絲球過濾率', '腎功能', r'e-?gfr|腎絲球過濾|\bgfr\b|ckd-?epi|mdrd', ''),
    ('UACR', '尿白蛋白/肌酸酐比 UACR', '腎功能', r'\bu?-?acr\b|ma/u-?cre|albumin\s*/\s*(u-?)?cre|白蛋白.*肌酸?酐.*比', ''),
    ('UPCR', '尿蛋白/肌酸酐比 UPCR', '腎功能', r'\bupcr\b|\bu-pcr\b|protein\s*/\s*(u-?)?cre|\btp\s*/\s*cre|蛋白.*肌酸?酐.*比', ''),
    ('U_MALB', '尿微白蛋白', '腎功能', r'micro\s*-?albumin|微量?白蛋白|\bmalb\b', ''),
    ('U_MALB', '尿微白蛋白', '腎功能', r'albumin|白蛋白', 'u'),
    ('U_CRE', '尿肌酸酐', '腎功能', r'creatinine|\bcrea?\b|肌酸酐|肌酐', 'u'),
    ('CRE', 'Creatinine 肌酸酐', '腎功能', r'creatinine|\bcrea?\b|^crtn$|肌酸酐|肌酐', 'b?'),
    ('BUN', 'BUN 尿素氮', '腎功能', r'\bbun\b|^un$|尿素氮|urea\s*nitrogen', ''),
    ('UA', '尿酸', '腎功能', r'尿酸|uric\s*acid|^ua\b', ''),
    # ── 肝功能 ──
    ('ALT', 'ALT (GPT)', '肝功能', r'\balt\b|gpt|g\.p\.t|丙酮', ''),
    ('AST', 'AST (GOT)', '肝功能', r'\bast\b|got\b|g\.o\.t|苯醋酸|草醋酸', ''),
    ('GGT', 'γ-GT', '肝功能', r'\br-?gt\b|γ-?gt|\bggt\b|gamma.?g|麩胺轉酸|麩胺醯', ''),
    ('ALP', 'ALP 鹼性磷酸酶', '肝功能', r'alk\.?-?\s*p|\balp\b|鹼性磷[酸酯]', ''),
    ('DBIL', '直接膽紅素', '肝功能', r'直接膽紅素|direct\s*bil|bil\w*\s*[-(]?\s*d\b|\bd\.?-?bil', ''),
    ('TBIL', '總膽紅素', '肝功能', r'總膽紅素|膽紅素總量|total\s*bil|bil\w*\s*total|bil\w*\s*[-(]?\s*t\b|\bt\.?-?bil', ''),
    ('TBIL', '總膽紅素', '肝功能', r'^bilirubin$|^膽紅素$', 'b'),
    ('ALB', 'Albumin 白蛋白', '肝功能', r'albumin|^alb\b|(?<!卵)白蛋白', 'b?'),
    ('TP', '總蛋白', '肝功能', r'總蛋白|全蛋白|total\s*protein|protein,?\s*total|^t-protein|^tp\b', 'b?'),
    # ── 腫瘤標記(要排在電解質 CA 之前)──
    ('CA125', 'CA-125', '腫瘤標記', r'ca\s*-?\s*125', ''),
    ('CA199', 'CA 19-9', '腫瘤標記', r'ca\s*-?\s*19-?9', ''),
    ('CA153', 'CA 15-3', '腫瘤標記', r'ca\s*-?\s*15-?3', ''),
    ('AFP', 'AFP 甲型胎兒蛋白', '腫瘤標記', r'\bafp\b|胎兒蛋白|fetoprotein', ''),
    ('CEA', 'CEA', '腫瘤標記', r'\bcea\b|癌胚', ''),
    ('FPSA', 'Free PSA', '腫瘤標記', r'free\s*-?psa|游離.*攝護腺', ''),
    ('PSA', 'PSA', '腫瘤標記', r'\bpsa\b|攝護腺特異', ''),
    # ── 心臟(CK 要在電解質、鹼性磷酸酶之後不會撞,但要在「磷」之前)──
    ('TROP', 'Troponin', '心臟', r'troponin|旋轉蛋白|肌鈣蛋白', ''),
    ('CKMB', 'CK-MB', '心臟', r'ck-?mb|mb同功|同功', ''),
    ('CK', 'CK (CPK)', '心臟', r'\bcp?k\b|肌酸磷[化酸]|creatine\s*kinase', ''),
    ('BNP', 'BNP / NT-proBNP', '心臟', r'bnp|利[鈉納]', ''),
    # ── 電解質 ──
    ('NA', 'Na 鈉', '電解質', r'^na\b|鈉|sodium', ''),
    ('K', 'K 鉀', '電解質', r'^k\b(?!他)|鉀|potassium', ''),
    ('CA', 'Ca 鈣', '電解質', r'^ca\b|(?<!降)鈣|calcium', ''),
    ('P', 'P 磷', '電解質', r'^p\b(?![.-])|inorganic p|^磷|phosphorus|無機磷', ''),
    ('MG', 'Mg 鎂', '電解質', r'^mg\b|鎂|magnesium', ''),
    ('CL', 'Cl 氯', '電解質', r'^cl\b|^氯|chloride', ''),
    # ── 尿液常規裡與血液同名的項目:確定是尿液才算 ──
    ('U_LEU', '尿白血球酯酶', '尿液', r'leu[ck]ocytes?\s*[er]sterase|leu\.?\s*esterase|wbc\s*esterase|白血球[酯脂]|^leu\b', ''),
    ('U_WBC', '尿沉渣 白血球', '尿液', r'pus\s*cell', ''),
    ('U_WBC', '尿沉渣 白血球', '尿液', r'wbc|w\.b\.c|白血球(?!酯)|pus\s*cell', 'u'),
    ('U_RBC', '尿沉渣 紅血球', '尿液', r'rbc|r\.b\.c|紅血球', 'u'),
    # ── 血液常規 ──
    ('MCHC', 'MCHC', '血液常規', r'mchc|色素濃度|血紅素濃度', ''),
    ('MCH', 'MCH', '血液常規', r'\bmch\b|平均.*血球.*(色素|血紅素)', ''),
    ('MCV', 'MCV', '血液常規', r'\bmcv\b|血球容積(?!比)', ''),
    ('RDWSD', 'RDW-SD', '血液常規', r'rdw\s*-?\s*sd|分[佈布].*標準差', ''),
    ('RDW', 'RDW-CV', '血液常規', r'rdw|紅血球分[佈布]', ''),
    ('MPV', 'MPV', '血液常規', r'\bmpv\b', ''),
    ('HCT', 'Hct 血球比容', '血液常規', r'\bhct\b|hematocrit|血球?比容|容積比', ''),
    ('HB', 'Hb 血色素', '血液常規', r'h[ae]moglobin(?!\s*-?\s*[a-z]\b)|\bhgb\b|\bhb\b|血色素|血紅素', ''),
    ('PLT', 'Platelet 血小板', '血液常規', r'platelet|\bplt\b|血小板', ''),
    ('BAND', 'Band 帶狀嗜中性球', '血液常規', r'\bband', ''),
    ('ATYLYM', 'Atypical lymphocyte 非典型淋巴球', '血液常規', r'atypical\s*lym|aty-?lym|非典型淋巴', ''),
    ('NEUT', 'Neutrophil 嗜中性球', '血液常規', r'neut|\bseg|\bneu%|嗜中性', ''),
    ('LYM', 'Lymphocyte 淋巴球', '血液常規', r'\blym|淋巴', ''),
    ('MONO', 'Monocyte 單核球', '血液常規', r'\bmono|單核', ''),
    ('EOS', 'Eosinophil 嗜酸性球', '血液常規', r'\beos|嗜酸|嗜伊紅', ''),
    ('BASO', 'Basophil 嗜鹼性球', '血液常規', r'\bbaso|嗜鹼', ''),
    ('WBC', 'WBC 白血球', '血液常規', r'\bwbc\b|^w\.b\.c|^白血球|leu[ck]ocyte\s*count', 'b?'),
    ('RBC', 'RBC 紅血球', '血液常規', r'\brbc\b|^r\.b\.c|^紅血球', 'b?'),
    # ── 甲狀腺 ──
    ('TSH', 'TSH', '甲狀腺', r'\btsh\b|甲狀腺刺激素|促甲狀腺', ''),
    ('FT4', 'Free T4', '甲狀腺', r'free\s*-?\s*t4|\bft4\b|游離甲狀腺素|游離四碘', ''),
    ('FT3', 'Free T3', '甲狀腺', r'free\s*-?\s*t3|\bft3\b|游離三碘', ''),
    ('T4', 'T4', '甲狀腺', r'^t4\b|^四碘甲狀腺素|^甲狀腺素', ''),
    ('T3', 'T3', '甲狀腺', r'^t3\b|^三碘甲狀腺', ''),
    # ── 肝炎標記 ──
    ('HBSAG', 'HBsAg B 肝表面抗原', '肝炎標記', r'hbs\s*-?ag|b型?肝炎?表面抗原', ''),
    ('ANTIHBS', 'Anti-HBs B 肝表面抗體', '肝炎標記', r'anti-?\s*hbs|hbs\s*-?ab|b型?肝炎?表面抗體', ''),
    ('HBEAG', 'HBeAg B 肝 e 抗原', '肝炎標記', r'hbe\s*-?ag|b型?肝炎?e抗原', ''),
    ('HCVRNA', 'HCV RNA', '肝炎標記', r'hcv\s*-?rna', ''),
    ('ANTIHCV', 'Anti-HCV C 肝抗體', '肝炎標記', r'anti-?\s*hcv|hcv\s*-?ab|c型?肝炎?(病毒)?抗體', ''),
    ('HBVDNA', 'HBV DNA', '肝炎標記', r'hbv\s*-?dna', ''),
    # ── 發炎與感染 ──
    ('CRP', 'CRP', '發炎與感染', r'\b(hs-?)?crp\b|c反應', ''),
    ('ESR', 'ESR', '發炎與感染', r'\besr\b|沉降速?率', ''),
    ('FLUA', '流感 A 型抗原', '發炎與感染', r'流行?性?感冒?a型|influenza\s*a|flu\s*a\b', ''),
    ('FLUB', '流感 B 型抗原', '發炎與感染', r'流行?性?感冒?b型|influenza\s*b|flu\s*b\b', ''),
    ('COVIDAG', '新冠病毒抗原', '發炎與感染', r'新型?冠狀|covid|sars-cov', ''),
    # ── 凝血 ──
    ('DDIMER', 'D-dimer', '凝血', r'd-?\s*d?\s*dimer|雙合體', ''),
    ('INR', 'INR', '凝血', r'\binr', ''),
    ('APTT', 'APTT', '凝血', r'aptt|部分凝血活', ''),
    ('PT', 'PT 凝血酶原時間', '凝血', r'^p\.?t\b|pro\. time|prothrombin|凝血.原時間', ''),
    # ── 貧血與營養、其他生化 ──
    ('FERRITIN', 'Ferritin 鐵蛋白', '貧血與營養', r'ferritin|(?<!運)鐵蛋白', ''),
    ('TIBC', 'TIBC', '貧血與營養', r'tibc|總鐵結合', ''),
    ('FE', 'Fe 血清鐵', '貧血與營養', r'^fe\b|^iron|血清鐵|^鐵$', ''),
    ('B12', 'Vitamin B12', '貧血與營養', r'b12', ''),
    ('FOLATE', 'Folate 葉酸', '貧血與營養', r'folate|folic|葉酸', ''),
    ('VITD', 'Vitamin D', '貧血與營養', r'vit\w*\.?\s*d|維生素d|25-?oh', ''),
    ('NH3', 'Ammonia 血氨', '其他', r'ammonia|血氨', ''),
    ('LIPASE', 'Lipase 解脂酶', '其他', r'lipase|解脂', ''),
    ('AMYLASE', 'Amylase 澱粉酶', '其他', r'amylase|澱粉', ''),
    ('LDH', 'LDH', '其他', r'\bldh\b|乳酸脫氫', ''),
    # ── 糞便 ──
    ('FOBT', '糞便潛血', '糞便', r'糞便潛血|i?fobt?\b|stool\s*o', ''),
    # ── 尿液常規 ──
    ('U_SG', '尿比重', '尿液', r'比重|sp\.?\s*g|specific\s*gravity|^s\.?g\b', ''),
    ('U_PH', '尿 pH', '尿液', r'^ph\b|酸鹼', 'u?'),
    ('U_NIT', '尿亞硝酸鹽', '尿液', r'nitrite|亞硝酸|^nit\b', ''),
    ('U_URO', '尿膽素原', '尿液', r'尿膽[元原素]|urobilinogen|^uro\b', ''),
    ('U_BIL', '尿膽紅素', '尿液', r'bilirubin|膽紅素|^bil\b', 'u?'),
    ('U_KET', '尿酮體', '尿液', r'酮體|ketone|^ket\b', ''),
    ('U_OB', '尿潛血', '尿液', r'潛血|occult\s*blood|^ob\b|^blood$', ''),
    ('U_TP', '尿總蛋白', '尿液', r'總蛋白|total\s*protein|\btp\b', 'u'),
    ('U_PRO', '尿蛋白', '尿液', r'^(t-)?protein\b|^pro\b|^蛋白$|^蛋白質|^尿.{0,2}蛋白|urine\s*-?protein|^u-protein|protine', 'u?'),
    ('U_GLU', '尿糖', '尿液', r'glucose|sugar|^glu\b|糖', 'u'),
    ('U_GLU', '尿糖', '尿液', r'^糖$|^sugar$|urine\s*sugar|(glucose|sugar).*定性', 'u?'),
    ('U_COLOR', '尿液顏色', '尿液', r'顏色|(?<!doppler )colou?r', ''),
    ('U_TURB', '尿液混濁度', '尿液', r'混濁|appear|turbid|clarity|外觀', ''),
    ('U_EPI', '尿沉渣 上皮細胞', '尿液', r'epith|上皮|\bepi?\.?\s*cell|^sqep', ''),
    ('U_CAST', '尿沉渣 圓柱體', '尿液', r'^casts?\b|圓柱', ''),
    ('U_CRYS', '尿沉渣 結晶', '尿液', r'^crystals?\b|結晶', ''),
    ('U_BACT', '尿沉渣 細菌', '尿液', r'^bacteria\b|^細菌$', ''),
    # ── 檢體不明的血糖放最後(尿糖已先比過)──
    ('GLU', '血糖(未註明飯前飯後)', '血糖', r'^glucose|^glu\b|^血糖|葡萄', 'b?'),
    # ── 生理量測 ──
    ('SBP', '收縮壓', '生理量測', r'收縮壓|\bsbp\b', ''),
    ('DBP', '舒張壓', '生理量測', r'舒張壓|\bdbp\b', ''),
    ('BMI', 'BMI', '生理量測', r'\bbmi\b|身體質量', ''),
    ('HEIGHT', '身高', '生理量測', r'^身高', ''),
    ('WEIGHT', '體重', '生理量測', r'^體重', ''),
    ('WAIST', '腰圍', '生理量測', r'^腰圍', ''),
]

# 這些不是單一檢驗值(套組名稱、品管對照值、基因型、體液檢體、比值),一律不歸類,照原名列出
SKIP = r'對照|^ptt? c$|consistency|^[a-z]\d{1,3} |wbc[- ]?d\s?c\b|分類計數|other cell|pleural|effusion|\(fluid\)|全套|cbc-?i\b|套組|control|mnaptt|mean normal|data/mean|genotyp|基因|minimal inhibition|\((csf|pl|pleural|ascites)\)|\(\s*other\s*\)|/psa'

# 影像、篩檢、問卷這類不是檢驗值的列:不丟掉,另外收在最後一類(預設收合)
NONLAB = r'檢查[（(]包括|\bview\b|k\.u\.b|造影|超音波|心電圖|mapping|篩檢|抹片|^抽菸|^戒菸|^家族病史|^伴隨疾病|^結果$|^尿液檢查$|^尿沉渣$'

out = {
    'skip': SKIP,
    'nonlab': NONLAB,
    'built': datetime.date.today().isoformat(),
    'cats': CATS,
    'items': [dict(key=k, name=n, cat=c, re=r, **({'ctx': x} if x else {})) for k, n, c, r, x in R],
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'extension', 'data', 'labs.json')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=0)
print(len(R), 'rules →', os.path.normpath(path))
