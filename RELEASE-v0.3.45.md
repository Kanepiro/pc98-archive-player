# TASL Archive Player Boost v0.3.45
2026-11-17。検証済み v0.3.45-rc.1 を正式化。追加の変換方式変更は行っていません。

## 変更点
- モード1〜4の処理・メモリ・転送を最適化。モード3のGPU状態再利用・行ごとの処理、モード4の前処理・字形照合を高速化しました。
- 文字パレット・フォント・候補数・解像度・FPS・変換判定・TSL形式を高速化のために削減していません。
- 既存TSLの読み込み、保存・中断・再開、GPUが使えない場合のCPU切り替えを維持。
- Windows MP4は従来の互換性重視設定を維持（H.264/AAC、NVENC p4/VBR/CQ21、またはlibx264 veryfast/CRF21、AAC 192kbps）。所有者専用版のロスレス設定は含みません。
- 短尺MP4で欠けていた最後の1フレームを保持します。末尾の圧縮結果と再生長は旧版から変わります。
- Windowsの既定ポート39083・保存先 %LOCALAPPDATA%\TASL-Faithful-Boost は従来の公開版を継承。更新時は旧版を終了し、新しいフォルダにZIPを展開してください。

## Windowsでの代表実測
Windows 10 / AMD Phenom II X6 1065T / GeForce GTX 1050 Ti。22秒・1920×1080・24fps素材、各2回の中央値。TSL変換はDirectCompute、MP4圧縮は両版ともlibx264（この環境ではNVENC初期化に失敗したためCPUへ切り替え）。

|モード|完成MP4まで：v0.3.44 → v0.3.45-rc.1|速度比|
|---|---:|---:|
|1|121.486 → 119.859秒|1.01倍|
|2|120.273 → 122.419秒|0.98倍|
|3|304.103 → 151.116秒|2.01倍|
|4|831.828 → 118.667秒|7.01倍|

約7.01倍は上記Windows環境・素材・モード4での結果です。全端末・全素材・全モードに適用される値ではありません。モード1・2は動画のシーク・読み取りが総時間を占め、改善が小さいか一貫せず、遅くなる試行もあります。Web CPU測定ではモード4の代表総時間は1.41倍、モード3は1.07倍でした。詳細・全試行は [BENCHMARK-REPORT.md](verification/public-performance-v0.3.45/BENCHMARK-REPORT.md) を参照してください。

## 品質・検証範囲
候補版でWindows 48件・Linux Chromium CPU 56件、計104件を測定し、比較52組のTSLはすべてSHA-256一致。既存TSL、プレビュー、保存、中断、checkpoint復元、GPU不可・途中失敗時の切り替え、PWAオフラインを検証しました。正式化は版数・配布情報とWindowsの従来の保存先への復帰が中心で、性能数値を正式版で再測定したものではありません。

Windows 11、Android/iOS実機、他のCPU/GPU、NVENC成功経路、モバイルの発熱・電力は未検証です。Linux WebKitのモード3では細線文字の縮小描画が旧版・候補版の両方で失敗する既存問題があります。細かな顔や重なった人物の輪郭は途切れることがあります。Windows実行ファイルは署名なしです。[既知の制限](verification/public-performance-v0.3.45/KNOWN-LIMITATIONS.md)と[品質検証](verification/public-performance-v0.3.45/QUALITY-AND-STABILITY.md)も参照してください。

## 配布と復旧
- [Windows ZIP・正式リリース](https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.45)
- [Web/PWA](https://pc98-archive-player-seven.vercel.app/mobile/)
- [Windows配布ページ](https://pc98-archive-player-seven.vercel.app/windows/)
- [旧版 v0.3.44](https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.44)を保持しています。
