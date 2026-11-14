# Windows ネイティブ版 v0.3.39

Windows 10 / 11 x64向け。ZIPを展開してTASL-PC-Boost.exeを起動します。

- Windows入口: https://pc98-archive-player-seven.vercel.app/windows/
- スマホ入口: https://pc98-archive-player-seven.vercel.app/mobile/
- モード4: v0.3.38の272文字、画像認識、輪郭、字形照合、全体組版を維持。DirectCompute / DirectMLを優先し、失敗時はCPUへ切替。
- モード1〜3: 専用ネイティブGPU計算は未実装のためCPU処理。WebGPUを使用しない。
- MP4直接出力: DirectCompute描画・NVENCを優先。利用不可時はCPU。
- 動画と文字変換はPC内で処理。127.0.0.1の画面はローカルEXEの操作画面。
- Windows CIでビルド、4モード、WebGPU無効時の変換、モード4の独立画質評価、TSL、MP4、梱包EXEの起動・認識を検証。
- WARPはソフトウェアの検証用。GTX 1050 Ti、DirectMLの実GPU割当、NVENCの実機速度、Windows 10/11利用者端末の互換性は未検証。

実機検証済みの完成版とは扱わず、プレリリースとして配布します。詳細はZIP内VALIDATION-REPORT.mdとVALIDATIONフォルダ。

変更履歴: Windows専用経路を固定し、WebGPUへの分岐を除去。バージョン表示と診断番号を更新。既存fullgpuブランチ・旧ZIPは保持。
