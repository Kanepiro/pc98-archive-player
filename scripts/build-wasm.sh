#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f tools/emsdk/emsdk_env.sh ]; then . tools/emsdk/emsdk_env.sh >/dev/null 2>&1; fi
em++ src/mms/bridge.cpp -std=c++17 -O3 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 -sINITIAL_MEMORY=33554432 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sDISABLE_EXCEPTION_CATCHING=0 -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=UTF8ToString -o public/mms-core.mjs
node -e "const fs=require('fs'),h=require('crypto').createHash('sha256'); for(const f of ['core.hpp','engine.hpp','bridge.cpp'])h.update(fs.readFileSync('src/mms/'+f)); fs.writeFileSync('src/mms/wasm-source.sha256',h.digest('hex')+'\\n');"
