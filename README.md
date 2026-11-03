# PC-98 Archive Player

MAG画像・TSLテキストアニメ・M-MASL (.MMS) を、AndroidのChromeから開く統合プレーヤーです。バージョン0.2.0は検証版です。APKではなく、ホーム画面に追加できるPWAです。

**起動URL:** https://pc98-archive-player-seven.vercel.app/

**GitHub:** https://github.com/Kanepiro/pc98-archive-player （非公開）

## 使い方

1. 配布URLをChromeで開きます。
2. 「ファイルを開く」で端末のMAG / TSL / MMSを選びます。
3. MAGは画像を表示します。TSL / MMSは「再生」を押します。
4. 「停止」「音量」「全画面」を必要に応じて使います。MMSの選択肢には「作品内のキー操作」を使います。
5. 「MP4保存」を押すと、作品を端末内でH.264/AACのMP4に変換して保存します。進行中は「変換中止」を押せます。

MP4保存：MAGは5秒の静止動画、TSLは無音アニメーション、MMSは映像と内蔵音声を変換します。画面録画ではなく作品データから直接生成するため、操作ボタンや通知バーは映りません。MMSはキー未入力の既定経路を出力します。インタラクティブ作品・無限ループは最後まで自動書き出しできない場合があり、上限は5分です。H.264対応のChromeが必要です。AAC非対応ブラウザーでは同梱のWebAssembly AACエンコーダーを使います。Android実機での機種別動作は未検証です。

Chromeメニューの「ホーム画面に追加」でアプリとして起動できます。「オフライン準備済み」表示後はアプリ本体をオフラインで開けます。作品は端末からその都度選びます。画面を離れると停止します。停止後の再生は先頭からです。

選んだ作品のデータをサーバーへ送信する処理はありません。配布元へのアプリ取得の通信は発生します。「動作確認データ」はこの開発用に作った12秒の映像と連続音です。元の作品や旧プレーヤーは同梱していません。

## 実装

- MAG: MAGBIBLE.DOCと正誤表に基づく独立実装。16/256色、部分保存、縦長ピクセル。GRBパレットの格納値を保持。
- TSL: ユーザーの既存TSL_Viewer.htmlを基に移植。Shift-JIS、絶対時刻による再生。1178画面の実ファイルに対応するため旧300画面制限を修正。
- MMS: このプロジェクトのWindows版v0.2のC++エンジンをEmscriptenでWebAssembly化。旧MM32.EXEやWinGを実行しません。
- 音声: WorkerからAudioWorkletへ直接PCMを渡し、20msブロックを12個先読み。UIが一時停止しても音声供給を継続します。
- MP4: 専用WorkerでMMSのフレームとPCM音声をオフライン生成。WebCodecsとMediabunnyでH.264/AACをMP4へ多重化。AACエンコード非対応環境ではFFmpeg AAC（WASM）で代替。
- 同期: 出力済みサンプル数とAudioContextの出力時刻を基準に映像を選択。遅れた映像を追いかけて音声を止める処理は行いません。
- PWA: 内容ハッシュでキャッシュを更新。「更新を適用」で待機中の更新を切り替えます。

## 開発とテスト

Node.js 22とnpmを使用します。

```sh
npm ci
npm test
npm run build
npm run dev
```

http://127.0.0.1:4173/ で動作します。AudioWorkletとService WorkerにはHTTPSまたはlocalhostが必要です。HTMLファイルを直接開いても動作しません。

C++を変更した場合はEmscripten **3.1.69**で再生成します。

```sh
git clone https://github.com/emscripten-core/emsdk.git tools/emsdk
tools/emsdk/emsdk install 3.1.69
tools/emsdk/emsdk activate 3.1.69
npm run build:wasm
npm test
npm run build
```

生成したpublic/mms-core.mjs、public/mms-core.wasm、src/mms/wasm-source.sha256をソースと一緒にコミットします。通常ビルドはソースハッシュの不一致を検出して中止します。Vercel側でSDKを毎回ダウンロードする必要はありません。

実サンプルを所有している場合のみ、reference/MAGとreference/TASLに読み取り用コピーを置きます。MMS_ROOTでMMSフォルダーを指定します。

```sh
MMS_ROOT=/path/to/MMS npm run test:corpus
MMS_ROOT=/path/to/MMS CHROME_PATH=/path/to/chrome npm run test:browser
```

ブラウザー試験はLinuxテスト環境向けのスクリプトです。MMS_ROOTでMMS試料フォルダーを指定してください。npm run devを別ターミナルで起動してから実行します。作品や画面キャプチャーはGitへ追加しないでください。

## GitHubとVercel

GitHubがソース管理先、Vercelが配布先です。VercelのGit連携は接続済みで、mainへのpushから自動デプロイします。Build Commandはnpm run build、Output Directoryはdist、Install Commandはnpm ciです。変更をブランチへpushし、Previewで確認してからmainへ反映します。

GitHub Actionsはnpm testとnpm run buildを実行します。APIキー・データベース・ユーザー登録は必要ありません。Vercelの既定のアクセス保護は維持します。

## 確認状況

[verification/README.md](verification/README.md) と [verification/mp4-export.md](verification/mp4-export.md) に実行結果、[KNOWN_ISSUES.md](KNOWN_ISSUES.md) に未確認事項を記載しています。Android実機・全作品の最初から最後までの鑑賞試験は未完了です。

## 出典とライセンス

新規コード・自作動作確認データはMIT Licenseです。既存MMSエンジンのMIT表記を保持しています。Emscripten等のランタイム表記はlicenses/に収録しています。MP4出力にはMediabunny (MPL-2.0) およびFFmpeg AACエンコーダー (LGPL-2.1-or-later) を使用し、同梱の licenses/mediabunny*.txt と licenses/ffmpeg-aac/ にライセンスを保存しています。対応するソースコードと再現手順は https://github.com/Vanilagy/mediabunny/tree/v1.65.0/packages/aac-encoder にあります。作品データと原資料の権利はそれぞれの権利者に帰属します。

MAG一次資料: https://metanest.jp/mag/mag.xhtml （MAGBIBLE.LZH / 正誤表）
M-MASL一次資料: ユーザー所蔵MM_REF13.DOC、MM.DOC、MM.HEDおよび実ファイル。
音声出力時刻の仕様: https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp

第三者の旧プレーヤーやWeb版のソースコードをこの配布物に流用していません。