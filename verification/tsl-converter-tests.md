# TSLコンバーター検証記録（2026-11-05）

## 環境

RDC上のUbuntu / Node.js 22.22.1 / Google Chrome 157.0.8103.38。
390×844のモバイルエミュレーションと1280×900の表示領域。Windows・Android実機は利用不可で未検証。
PC-98 TASL Ver.1.08の実機・エミュレーター検証も未実施。

## 基準と回帰

- 開始時main 5d640f4c05fbc78497c23a45b485967575406499 の全47ファイルをgit blob SHA-1で照合。
- 開始時 npm ci / npm test（5件）/ npm run build が成功。
- 追加後 npm test（16件）/ npm run build が成功。再生エンジン（mag.js, tsl.js, MMSソース/WASM）とMP4エクスポーターは変更なし。
- 実作品コーパス: MAG 48、TSL 15、MMS 42件で失敗0。MMSは冒頭5秒の既定経路であり、全編・全分岐を保証しない。
- 従来browser.mjsも通過。MAG・TSL表示、MMS連続音、キー未入力の完走、停止、破損ファイル後の回復、オフライン再起動。音声gapSamples=0。
- 最新の回帰記録: [converter-player-regression.json](converter-player-regression.json)。

## コンバーター

[converter-local.json](converter-local.json) に実行結果。

| 試験 | 結果 |
|---|---|
| H.264 MP4の選択→自動変換→ダウンロード→既存プレーヤー再生 | 通過 |
| 生成TSLを既存MP4保存機能で再出力 | 通過 |
| 350画面のTSLを生成・ダウンロード後、既存ファイル入力から再読込 | 通過、35秒 |
| 10分の実MP4を5 fpsで変換 | 通過、3,000画面、600秒、6,595,950 bytes |
| 10分動画の処理時間 | この試験機で13.881秒（160×90入力の人工動画。4Kや他端末の性能保証ではない） |
| 2時間・最大画面寸法のスケジュール/出力見積もり | 自動テスト通過。2時間の動画デコード完走は未実施 |
| WebM VP9の読み取り | 通過 |
| 中止、破損MP4、再変換 | 通過 |
| ドラッグ＆ドロップ | 通過 |
| オフライン再読込→MP4変換→TSL保存 | 通過 |
| 9:16のTSL生成 | 90列×80行 |
| 端末比率390×844のTSL生成 | 90列×97行、比率差0.001832（約0.4%） |
| 縦全画面表示 | 原点0,0、390×844を使用。通常Fullscreen/非対応時fallbackとも確認、画像を目視確認 |
| 文字の比率 | 同じ12×24セルで描画し、object-fit:containで等倍比率を保持 |
| ページエラー / アップロード通信 | 0 / 0 |

## 配布確認

専用ブランチ feature/video-tsl-converter でPreviewへ反映し、その環境で同じブラウザー試験を実行する。
Previewと本番の結果は、それぞれconverter-preview.json、converter-production.jsonとして追記する。
Vercelのプロジェクト・Git連携・アクセス保護設定を維持する。

## 限界

MP4/H.264とWebM/VP9の人工動画で検証。他コーデック、端末ごとの低メモリ挙動、Windows/Android実機、当時のTASLでの再生は未検証。
縦画面モードはWeb向けでPC-98標準画面範囲を超える。PC-98向けモードを別に維持する。
