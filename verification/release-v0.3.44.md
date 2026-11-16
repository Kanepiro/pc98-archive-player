# TASL v0.3.44 — 60pxの輪郭AA
2026-11-16公開。動作確認済みのWindows ZIPを再ビルドせず配布します。

- モード4を60×60px・指定170文字へ更新。輪郭と字形の評価に合格した文字だけを置き、不合格は空白にします。
- 元映像を切り抜かず、60pxで割り切れない部分を余白にします。
- Noto Sans Mono CJK JP Regularを同梱し、文字選択・プレビュー・TSL再生・MP4出力の字形を統一。
- Windowsの字形照合・描画はDirectComputeを優先し、CPUへの切り替えを維持。
- 動画の連続読み取り、途中再開、TSL保存とMP4出力を確認。モード1〜3の変換方式は変更しません。

## 確認結果
Windows 10 / GTX 1050 Tiで22秒・24fps・528フレームを変換。528フレームすべてに変化があり、18秒以降の96フレームも更新を確認しました。全304,128マスのうち150,673マスを採用、153,455マスを空白にし、合格条件違反は0マスです。採用率49.54%、空白率50.46%。ぼかしσ=8px、誤差≤0.34かつ輪郭サンプル数≥8を採用条件としています。

TSLダウンロード・プレビュー・再読み込み後の復元を確認。Windowsの単体テスト94件、スマホ版87件が成功。スマホ版はChromium / WebKitで検証しています。Windows 11・Android・iOSの実機は未検証です。検証環境のMP4エンコードはCPUでした。細かな顔や重なった人物の輪郭には途切れが残ります。

## 配布物
- TASL-PC-Boost-v0.3.44-Windows-x64.zip
- サイズ: 206,672,227 bytes
- SHA-256: `d38c937aaf917f20168979db6880db279d2a22d2057806b740285b06376b838f`
- Windowsソース: `3f0bd408d3e6f47d1e0ea43ccff33265bcf15b94`
- スマホ処理・UIの検証済みソース: `cd5504e79794b6e8e5324f574b03a1c272f830d2`

ZIPを旧版とは別のフォルダへ展開し、旧版を終了してからTASL-PC-Boost.exeを起動してください。新方式の文字位置を正確に再生するには、再生側もv0.3.44へ更新してください。旧方式のモード4途中データは引き継ぎません。

- Windows: https://pc98-archive-player-seven.vercel.app/windows/
- Android / iOS: https://pc98-archive-player-seven.vercel.app/mobile/
- 以前の公開版: https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.42-rc2
