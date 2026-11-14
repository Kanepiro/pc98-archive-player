from pathlib import Path
import hashlib,json,os,sys
root=Path(sys.argv[1]);validation=root/'VALIDATION'
layout=json.loads((validation/'layout-report.json').read_text(encoding='utf-8'))
mp4=json.loads((validation/'mp4-report.json').read_text(encoding='utf-8'))
lines=['# 検証結果 — TASL PC Boost v0.3.40','','検証環境: Windows / 明示的なWARPソフトウェア実行。GTX 1050 Tiの速度・DirectML・NVENC実機動作は未検証。','','## 組版と画質','','元のJavaScript全画面評価式による独立再計算。値は小さいほど良好。','','| 半角マス | 旧経路 ms | 新経路 ms | 元CPU評価値 | 新評価値 | 差 |','|---|---:|---:|---:|---:|---:|']
for r in layout:
 old=r['reference']['total'];new=r['independent']['total']
 lines.append(f"| {r['W']}×{r['H']} | {r['oldNativeMs']:.1f} | {r['nativeMs']:.1f} | {old:.4f} | {new:.4f} | {(new/old-1)*100:+.3f}% |")
lines+=['','時間はWARP実行であり、GPU実機の高速化を示すものではありません。初回処理には初期化費用が含まれます。','','## 同じ元動画・同じ設定の全体比較','','入力: testsrc2 / 640×360 / 2秒 / 4fps。PC-98実寸、モード4。MP4は5fps。旧経路はv0.3.37と同じCPU輪郭・CPU組版＋DirectCompute照合。','','元動画 SHA-256: '+mp4['sameSourceSha256'],'','| 経路 | MP4出力 秒 | 変換＋MP4 秒 | 出力フレーム数 |','|---|---:|---:|---:|']
for r in mp4['runs']:lines.append(f"| {r['variant']} | {r['mp4Seconds']:.3f} | {r['conversionPlusMp4Seconds']:.3f} | {r['frameCount']} |")
lines+=['','NVENCは実機未検証のため、この動画比較は両方ともCPUエンコードです。新経路の文字描画・サイズ調整・色変換はWARP上のDirectComputeです。','','## その他の実行確認','']
for name in ['raster-report','preprocess-report','nms-report','native-modes','platform-isolation']:
 value=json.loads((validation/(name+'.json')).read_text(encoding='utf-8'))
 lines+=['- '+name+': '+json.dumps(value,ensure_ascii=False)]
lines+=['- 梱包済みEXEの起動、モデル同梱、前処理・NMSのソフトウェア実行を確認。','- GPU使用率: Windows検証環境にNVIDIA実GPUなし。測定不可。','- 追加の制約と未検証範囲: VALIDATION-NOTES.md。','','ビルドコミット: '+os.getenv('GITHUB_SHA','unknown')]
(root/'VALIDATION-REPORT.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
manifest={}
for p in root.rglob('*'):
 if p.is_file() and p.name!='SHA256SUMS.json':manifest[p.relative_to(root).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
(root/'SHA256SUMS.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
