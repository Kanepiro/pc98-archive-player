# 再検証

本ディレクトリのスクリプトは独立QA作業フォルダにコピーして実行します。そこに windows/ と web/ のソース＋npm ci、baseline/TASL-PC-Boost/（公式v0.3.45展開）、package-final/TASL-PC-Boost/（本版展開）、web-baseline/dist/（公式Web ZIP展開）、fixture.mp4（入力素材）を配置します。fixture動画そのものは配布しません。

Windows本版39460、Windows旧版39461、Web本版39462、Web旧版39463をlocalhostで起動し、WindowsはTASL_BOOST_PORT / TASL_BOOST_DATA_DIR / TASL_NO_BROWSER=1でユーザーデータから隔離します。ブラウザーのパスは環境に合わせて変更してください。qa.mjsのplatformはwindowsまたはweb、phaseはnew、regression、native16。qa-pwa.mjsは39464番で旧→新PWA更新を検査します。verify-media.pyはplatformを引数に取ります。FFmpegの参照先 package/ は本版パッケージのコピーを使用します。

Vercel試験の一時アクセス情報、ユーザー認証情報、素材動画、生成映像はソース・Releaseには含めていません。qa-deployed.mjsは作業フォルダのpreview-access.jsonまたはproduction引数を使用します。nativeコンパイラー出力の比較はbuild-reportに記載の同一ツールチェーンを使います。
