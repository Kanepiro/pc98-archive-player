# v0.3.44 公開記録

2026-11-16、日本時間。ユーザーの動作確認と公開指示に基づき、既存の配布URLを更新しました。

- Android / iOS: https://pc98-archive-player-seven.vercel.app/mobile/
- Windows 10 / 11: https://pc98-archive-player-seven.vercel.app/windows/
- Windowsリリース: https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.44
- 本番コミット: `aa20464353766735ccf082a10d3344122eec2120`
- Windowsソース: `3f0bd408d3e6f47d1e0ea43ccff33265bcf15b94`
- 本番デプロイ: `dpl_59cuJvcRidqtqJvY7GGjcFLRCaiM`
- スマホタグ: `mobile-v0.3.44`
- サービスワーカーのキャッシュ: `pc98-cdbd62e2f5300bda`

## 公開後の確認

公開中の80ファイルすべてが、公開用ローカルビルドとSHA-256で一致しました。WindowsページのダウンロードリンクからZIPを取得し、206,672,227 bytes、SHA-256 `d38c937aaf917f20168979db6880db279d2a22d2057806b740285b06376b838f`を確認しました。動作確認済みのZIPを再ビルドしていません。

公開されたスマホ画面をChromiumとWebKitで開き、ローカルの試験動画を選択し、モード4で2秒・5fps・10フレームを変換しました。横32×18マス、縦18×32マス、60pxグリッドを確認。TSLダウンロード、プレビュー、ページ再読み込み後の復元が成功し、復元したTSLは元のダウンロードとバイト一致しました。両ブラウザーともページエラー0件、HTTPエラー0件でした。

公開前のv0.3.40を保存したブラウザープロファイルでも更新を確認しました。最初のオフライン試験では旧画面を観測しましたが、再試験で更新ワーカーのインストールから有効化までを確認し、完了後は旧キャッシュが消え、v0.3.44のオフライン起動が成功しました。セル60、エンジン6005、σ8、合格ライン0.34も公開画面から取得して確認しています。

公開用の変更は配布説明・リンク・公開記録です。変換処理と操作用JavaScriptは検証済みスマホソース `cd5504e79794b6e8e5324f574b03a1c272f830d2`と同一です。公開前の単体テスト87件、ビルド、GitHubのCheck playerが成功しました。

Windows 11・Android・iOSの実機試験は未実施です。Chromium / WebKitでの確認と区別します。Windows 10 / GTX 1050 Tiでの528フレーム変換など、完成版の検証範囲は[リリース記録](release-v0.3.44.md)を参照してください。

## 旧版の保全

- 旧本番コミット: `f7e3509f2e0c6847503e025c196b1bcaf67075d9`
- 旧本番デプロイ: `dpl_ABu76EJuTWhHBooeDDZVoQzjKayN`
- 旧Windows公開版: https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.42-rc2

旧Windowsリリースを削除・上書きしていません。詳細な機械検証結果は[published-v0.3.44.json](published-v0.3.44.json)に保存しました。
