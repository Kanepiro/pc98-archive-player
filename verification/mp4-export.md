# MP4書き出し機能 0.2.0 の検証

検証環境：Linux x64、Google Chrome 152（ヘッドレス）、Node.js 22.22.1、Mediabunny 1.65.0。Android実機ではない。

- MAG：合成MAGを5秒のH.264 MP4へ変換、保存成功（16×16出力）。
- TSL：合成2画面TSLを1.5秒の無音MP4へ変換、保存成功。
- MMS：同梱の自作 `ContinuityTest.MMS`（約12秒）を、オフライン音声・映像レンダリングでMP4へ変換、保存成功。
- MMSの生成ファイル：325,744 bytes、長さ12.032秒、映像H.264/640×400、音声AAC/48kHz/monoを `ffprobe` で確認。
- このChromeにはWebCodecsのネイティブAACエンコーダーがないため、同梱のWebAssembly AAC代替エンコーダーを使用して成功。
- 既存の `npm test` は5件成功し、`npm run build` も成功。

未確認：Android実機、様々なメーカーのH.264エンコーダー、大きな作品、外部MMS分岐、保存後の実機TikTok投稿、原機との全編精度比較。

MMS実作品はリポジトリへ含めず、テストには著作権上問題のない自作の動作確認データのみ使用。