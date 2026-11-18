# TASL Archive Player Boost v0.3.47

2026年11月18日公開。Windows版・Web/PWA版を更新しました。

- モード4に40px・30pxを追加。従来の60px・170文字の変換を維持し、TSL保存・再読込・中断再開・プレビュー・MP4に対応。
- モード2の丸文字を実際の描画濃度で校正し、階調表現を改善。旧TSLの描画互換性を維持。
- 時間表示を秒単位へ統一。再生速度・FPS・時刻計算は変更していません。
- 自動補正を、候補設定で実際に文字変換した結果を評価する方式へ更新。手動設定と解析中止を尊重。
- Windows EXEに既存の98アイコンを埋込み。通常ビルドにも反映。
- Webの音声付きMP4出力をAAC-LCに統一。H.264/8bit/yuv420p・faststart、WindowsのNVENC/libx264切替を維持。

## ダウンロードと更新

Windows ZIPを新しいフォルダーへ展開し、旧版を終了してから **TASL-PC-Boost.exe** を実行してください。Python/Node.jsの追加インストールは不要です。保存先・標準ポートは従来公開版と同じです。旧版フォルダーと保存データはそのまま残せます。

[Web/PWAを開く](https://pc98-archive-player-seven.vercel.app/mobile/) / [Windowsダウンロード案内](https://pc98-archive-player-seven.vercel.app/windows/)

PWAはオンラインで開き、v0.3.47と「オフライン準備済み」の表示を確認してください。保存データを削除する必要はありません。

## 確認範囲

Windows 10 / Phenom II X6 / GTX 1050 Ti、Chrome/Edgeで確認。候補版で単体テスト213件、MP4全編デコード107本、約215秒・6,463フレームの長尺変換、音声同期、旧TSL・中断再開・全出力プリセット・PWA更新/オフラインを検証しました。正式版への変更は版番号・配布案内・従来保存先への復帰で、変換アルゴリズムは候補版と同じです。

Windows 11、Android/iOS、その他のCPU/GPUは実機未検証です。モード2と自動補正は素材によって効果が異なり、細線や淡い輪郭が欠ける場合があります。処理時間は素材・端末に依存し、全モードの高速化を保証する更新ではありません。詳細は添付のTEST-RESULTS.mdを参照してください。

[旧安定版 v0.3.46](https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.46)は引き続き利用できます。問題があれば、OS・ブラウザー・モード・設定と再現手順を添えてIssueでお知らせください。
