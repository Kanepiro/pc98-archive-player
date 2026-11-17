# v0.3.46 ビルド・配布
Webソースはmain（タグ web-v0.3.46）、Windowsソースはタグ windows-v0.3.46。Node.js 22と固定package-lock.jsonを使用。

    npm ci
    npm test
    npm run build

Web/PWAはdistをHTTPSで配布します。既存vercel.jsonとService Workerの内容ハッシュ方式を維持。
Windowsは上記後、llvm-mingw-20241015-ucrt-x86_64とPythonで実行：

    python scripts/build-public-release.py --toolchain <LLVMディレクトリ> --out <新しいnative-build>
    python scripts/package-public-release.py --baseline-zip <公式v0.3.45 ZIP> --native-build <native-build> --out <新しいpackage> --zip <新しいZIP>

公式v0.3.45 ZIPのSHA-256をパッケージスクリプトで検証。汎用x64/SSE2向けの既存フラグ・MP4互換性設定を維持。
起動はTASL-PC-Boost.exe。既定ポート39083、保存先 %LOCALAPPDATA%\TASL-Faithful-Boost。検証時はTASL_BOOST_PORT、TASL_BOOST_DATA_DIR、TASL_NO_BROWSER=1で隔離する。
Windows ZIPにRELEASE-BUILD.jsonとSHA256SUMS.json、ReleaseにSHA256SUMS.txtを添付。旧版のRelease・タグ・ZIPは保持する。
候補版での全性能・品質測定はverification/public-performance-v0.3.45を参照。正式化で追加の高速化や変換仕様変更は行っていない。

今回の比較元：Windows 4a323dc0dc2885edce4c72bdbca5292404df0745、Web 3dda1405d9cabf648e73b7899061e4ea8fb5a79f。4:3試験はverification/public-4x3-v0.3.46を参照。
