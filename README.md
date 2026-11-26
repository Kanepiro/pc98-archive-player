# TASL Archive Player Boost v0.3.48-rc.1

公開前の検証候補です。配布リンクは正式版 v0.3.47 を指しています。動画をTSLに変換した後、同じ操作でMP4も作る場合は「MP4へ自動変換」をONにしてください。初期設定はOFFで、選択は1回の変換に適用されます。画面の再読み込みや再起動後はOFFになります。

MAG・TSL・MMSの再生、動画からTSL文字アニメーションへの変換、MP4出力に対応するフリーウェアです。Windowsネイティブ版とWeb/PWA版があります。素材は端末内で処理します。

- [Web/PWAを開く](https://pc98-archive-player-seven.vercel.app/mobile/)
- [Windows版をダウンロード](https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.47)
- [v0.3.47の更新内容](RELEASE-v0.3.47.md)
- [検証結果と対応環境](verification/public-v0.3.47/TEST-RESULTS.md)
- [以前の正式版 v0.3.46](https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.46)

## 使い方

WindowsはZIPを新しいフォルダーへ展開し、旧版を終了してからTASL-PC-Boost.exeを起動します。Web/PWAは上記URLをChrome/Edge等で開きます。

「ファイルを開く」でMAG・TSL・MMSを再生できます。「動画→TSL」では動画を選び、出力比率・モード・FPS・明るさ等を指定して変換します。モード4は60・40・30pxから選べます。60pxは従来と同じ170文字の輪郭AAです。モード2は丸文字の5階調、モード3は高画質・ちらつき抑制、モード1は従来の濃淡変換です。

自動補正は複数の場面を実際に文字変換して設定を選びます。手動設定も使用できます。変換途中のデータは16フレームごとに保存し、同じ動画を選び直して再開できます。TSLファイルには元動画の音声は保存しません。変換直後に元動画と合わせてMP4へ出力すると音声付きで保存できます。

縦9:16・縦3:4・横16:9・横4:3・端末画面比率・PC-98向けを用意。旧TSLの読み込みに対応します。新しい40/30pxのTSLはv0.3.47以降を使用してください。

PWAの「オフライン準備済み」表示後はアプリをオフラインで開けます。更新時に保存データを削除する必要はありません。Windows公開版は標準ポート39083、保存領域 `%LOCALAPPDATA%/TASL-Faithful-Boost` を従来どおり使用します。

## 対応状況

Windows 10 / Phenom II X6 / GTX 1050 Ti、Chrome/Edgeで確認。Windows 11・Android/iOS・他のCPU/GPUは実機未検証です。細線や淡色の輪郭は欠ける場合があり、自動補正の効果も素材に依存します。

Windowsは汎用x64/SSE2向け。利用できるGPU処理を実行時に選び、失敗時はCPUへ切り替えます。AVX/AVX2/FMA/SSE4を必須としません。MP4はH.264/8bit/yuv420p、AAC-LC、faststart。署名なしの実行ファイルです。

## ビルド

`npm ci`、`npm test`、`npm run build`。Webの配布物はdistです。Windowsの追加手順はBUILD-RELEASE.mdを参照してください。ネイティブビルドは `scripts/build-public-release.py`、パッケージ作成は `scripts/package-public-release.py` を使用します。

通常ビルドは保存済みの字形マスクを使用します。再校正用 `scripts/build-mode4-small.py` はPython/Pillow、`scripts/build-halftone-atlas.mjs` はPlaywright/Chromeを使います。MMSのWASMソースを変更した場合は同梱ビルド手順に従って再生成してください。

ライセンスと同梱ライブラリーの表記はLICENSE・licenses/を参照してください。
