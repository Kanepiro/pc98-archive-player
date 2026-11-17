# TASL Archive Player Boost v0.3.46

2026-11-17。縦3:4（1080×1440）・横4:3（1440×1080）の生成モードを追加。モード1〜4に対応し、既存の変換精度とBoost高速化を維持しました。

新モードの画像配置は「全体を表示（余白あり）」が初期値です。入力の縦横比を維持し、明示的に「画面いっぱい」を選べば従来の切り抜きを使えます。モード4は60px・170文字の既存照合方式で、縦18×24セル、横24×18セルです。デフォルトのスマホ縦9:16と既存4生成モードの挙動は維持しています。

通常のTSLコメント `# TASL_OUTPUT_SIZE 幅 高さ` に出力サイズを記録し、保存・再読込・中断再開・MP4保存へ反映します。文字エンコード、パレット、時刻、位置情報は変更していません。TSL自体に音声は入りません。モード1〜3は整数の文字グリッドで比率を揃え、MP4を指定解像度で描画します。24px指定では縦75列×50行、横104列×39行。16ドットでは縦135列×90行、横184列×69行となり、最終段階で比率を維持して指定解像度へ収めます。

新2モードでは指定解像度や指定fpsを自動的に下げません。ブラウザーのエンコーダー制限やTSLフレーム数上限を超えた場合はエラーを表示します。MP4は公開版v0.3.45のH.264/AVC・8bit 4:2:0・AAC音声・faststart設定とNVENC/libx264切り替えを維持しています。

WindowsとWeb/PWAは、それぞれ公式v0.3.45タグから改修しました。所有者専用版は設計と試験方法のみ参照し、そのファイルやGPU処理・ロスレス設定は移植していません。追加高速化や性能倍率の再測定は行っていません。

## 配布

- [Windows ZIP](https://github.com/Kanepiro/pc98-archive-player/releases/download/windows-v0.3.46/TASL-PC-Boost-v0.3.46-Windows-x64.zip)
- [GitHub Release](https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.46)
- [Web/PWA](https://pc98-archive-player-seven.vercel.app/mobile/)
- [Windows配布ページ](https://pc98-archive-player-seven.vercel.app/windows/)
- [今回の検証結果](verification/public-4x3-v0.3.46/TEST-RESULTS.md)

Windowsは旧版を終了し、新しいフォルダへZIPを全展開して起動してください。既定ポート39083、既存の保存領域を維持します。Web/PWAはオンラインで開き、更新後のv0.3.46表示を確認してください。旧v0.3.45のRelease・ZIP・ソースタグは保持します。

Android/iOS実機、Windows 11、他CPU/GPUでの動作は未検証です。デスクトップChromeによる代替試験と区別しています。詳細は今回の検証結果を参照してください。
