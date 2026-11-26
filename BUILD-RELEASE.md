# v0.3.48-rc.1 公開候補のビルド

Webは web-v0.3.47、Windowsは windows-v0.3.47 を基準とする各作業ブランチを使います。Node.js 22 と package-lock.json の依存関係でビルドします。

    npm ci
    npm test
    npm run build

Web/PWA の配布物は dist です。ローカルでは npm run dev で起動し、/mobile/ を開きます。

Windows ZIPはWindows作業ブランチの BUILD-RELEASE.md に従って作成してください。

ローカルで候補版を起動し、PLAYER_URL と CHROME_PATH を設定して node tests/public-stability.browser.mjs を実行してください。FFmpeg と ffprobe を使用します。試験専用のブラウザープロファイルと入力動画を作成します。
