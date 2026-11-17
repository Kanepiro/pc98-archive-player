# OS・バックエンドと検証範囲

| 項目 | 候補版の方針 |
|---|---|
| Windows x64 | 公開パッケージを基礎に更新したネイティブ実行ファイル・JS・Pythonを同梱 |
| Android | 既存Web/PWA。Windows DLL/DirectComputeは不要 |
| iPhone / iPad | 既存Web/PWA。ブラウザーの機能判定と既存経路を保持 |
| DirectCompute / WebGPU不可 | 既存CPU変換へ復帰 |
| WindowsハードウェアMP4不可 | libx264へ復帰 |
| Web MP4 | 公開版のエンコーダー選択・フォールバックを保持 |
| 古いTSL | 既存パーサーと描画形式を保持 |
| データ | 公開環境へ配置せず独立作業領域とブラウザープロファイルで検証 |

Windowsネイティブ版の実機検証対象はAMD Phenom II X6 / NVIDIA GTX 1050 Ti。Web/PWAのCPU経路はIntel Core M-5Y10c（2コア4スレッド）のLinux実機で検証した。Windowsネイティブ版のIntel CPU、AMD GPU、Intel内蔵GPUは未実施。汎用ビルド、機能検出、CPUフォールバックの検証を、全機器の実機確認と混同しない。

Android/iOS実機・署名環境は利用できない。公開モバイル配布物はWeb/PWAであり、新規APK/IPAの署名は行わない。Linux ChromiumのモバイルviewportとCPU経路を代替検証に用いる。WebKitの起動・メディア試験結果は最終検証報告に記載する。

モバイルの発熱・電力・長時間バックグラウンド動作は実機未測定。モード4の先読み1フレーム、1フレーム特徴キャッシュ、作業配列再利用で保持量を制限するが、OSのメモリ制限・サスペンド動作を実測したとは主張しない。
