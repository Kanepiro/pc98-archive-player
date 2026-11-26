# TASL Archive Player v0.3.48

Windows x64・Web・スマホPWA向け公開版。2026年11月26日。

- 「MP4へ自動変換」は初期設定OFFです。チェックを入れた1回の変換でだけMP4を作成します。
- 動画の途中保存と再開、MP4処理中の中断、完了したTSLの保存を改善しました。狭い画面では設定を1列に表示します。
- Windows ZIPに「はじめにお読みください.txt」を同梱しました。ZIPを右クリックして「すべて展開」を選び、展開先の「TASL-PC-Boost.exe」を起動してください。
- 旧版は残したまま、新しいフォルダーへ展開してください。スマホPWAではオンラインで開き、「更新を適用」が表示されたら押してください。

[Web・スマホPWA](https://pc98-archive-player-seven.vercel.app/mobile/) ／ [Windowsダウンロード案内](https://pc98-archive-player-seven.vercel.app/windows/) ／ [配布ファイルとSHA-256](https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.48)

## 確認範囲

Windows 10でChrome・Edgeを使用しました。公開候補の回帰検査では、6種類のモード設定と6種類の出力比率を組み合わせ、Web版・Windows版あわせて72件で旧版と比較しました。TSLのバイト列、描画結果、MP4を復号した映像と音声が一致しました。

Windows 11、Android・iPhone・iPad実機、Safari・Firefox、NVENCでの実エンコードは未検証です。Windowsの実行ファイルは署名されていません。
