# Windows ネイティブ版 v0.3.40

v0.3.39でモード1〜3がCPU固定だった問題を修正し、モード1〜4すべてをWindowsネイティブGPU優先にしました。ZIPを展開してTASL-PC-Boost.exeを起動してください。

- モード1・2：画素集約、濃淡変換、輪郭強調をDirectCompute化。
- モード3：色補正、輪郭抽出・連結、字形照合、ちらつき抑制、文字配置をDirectCompute化。
- モード4：既存の272文字、画像認識、輪郭解析、字形照合、全体組版のGPU実装を維持。
- MP4：既存のDirectCompute描画、FFmpeg/NVENCを維持。
- GPU非対応・失敗時は元のCPU処理へ自動切り替え。変換はPC内で完結し、WebGPUやクラウド変換に依存しません。

Windows CIでビルド、全モードの変換、元アルゴリズムとの品質比較、CPU切り替え、TSL/MP4、梱包EXEを検証する構成です。検証記録はZIP内のVALIDATIONに同梱します。CIのDirectCompute実行は明示的なWARPソフトウェア検証であり、GTX 1050 Ti、DirectML、NVENCの実機性能を確認したものではありません。

入口：https://pc98-archive-player-seven.vercel.app/windows/
スマホ版は独立したWebGPU版 v0.3.39：https://pc98-archive-player-seven.vercel.app/mobile/
