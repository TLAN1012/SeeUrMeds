#!/bin/sh
# 用假資料檢查:讀表格(單表、表頭內容分兩表)與藥名對照。需要 node 與 Google Chrome。
cd "$(dirname "$0")/.." || exit 1
node test/core.test.js || exit 1
echo "看畫面:python3 -m http.server 8799 後開 http://127.0.0.1:8799/test/harness.html(?f=fixture_split_header.html、?f=fixture_labs.html&open=2)"
