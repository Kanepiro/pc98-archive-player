# v0.3.48 正式版のビルド

Webは web-v0.3.47、Windowsは windows-v0.3.47 を基準とする各作業ブランチを使います。Node.js 22 と package-lock.json の依存関係でビルドします。

    npm ci
    npm test
    npm run build

Web/PWA の配布物は dist です。ローカルでは npm run dev で起動し、/mobile/ を開きます。

Windows用ソースで上記を実行した後、Python 3.11以上と llvm-mingw-20241015-ucrt-x86_64 を使います。

    python scripts/build-public-release.py --toolchain <LLVMディレクトリ> --out <新しいnative-build>
    python scripts/package-public-release.py --baseline-zip <公式v0.3.46 Windows ZIP> --native-build <native-build> --out <新しいpackage> --zip <新しいZIP>

パッケージ作成時に公式ランタイムZIPのSHA-256を検証します。起動ファイルは TASL-PC-Boost.exe です。実機試験では TASL_BOOST_PORT、TASL_BOOST_DATA_DIR、TASL_NO_BROWSER=1 を設定して通常の保存先から隔離できます。

ローカルで正式版を起動し、PLAYER_URL と CHROME_PATH を設定して node tests/public-stability.browser.mjs を実行してください。FFmpeg と ffprobe を使用します。試験専用のブラウザープロファイルと入力動画を作成します。
