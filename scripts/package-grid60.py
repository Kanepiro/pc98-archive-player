"""Build a portable Mode 4 release from the known-good package.
Usage: python3 scripts/package-grid60.py --baseline ZIP --python-embed ZIP --bin DIR --out NEW_DIR
The baseline and published deployment are never modified.
"""
from pathlib import Path
import argparse,zipfile,shutil,json,hashlib,subprocess
a=argparse.ArgumentParser()
for name in ['baseline','python-embed','bin','out']:a.add_argument('--'+name,required=True,type=Path)
o=a.parse_args();r=Path(__file__).resolve().parents[1]
o.out.mkdir(parents=True,exist_ok=False)
with zipfile.ZipFile(o.baseline) as z:
 roots=[Path(i.filename).parent for i in z.infolist() if Path(i.filename).name=='TASL-PC-Boost.exe']
 assert len(roots)==1
 original=roots[0]
 for i in z.infolist():
  p=Path(i.filename)
  if p.is_absolute() or '..' in p.parts:raise ValueError('Unsafe archive path')
  rel=p.relative_to(original) if p.is_relative_to(original) else None
  if rel is not None and rel.parts and rel.parts[0] in {'app','FREEZE-VALIDATION','SHA256SUMS.json'}:continue
  z.extract(i,o.out)
app=o.out/original
shutil.copytree(r/'dist',app/'app')
runtime=app/'runtime';runtime.mkdir(exist_ok=True)
with zipfile.ZipFile(o.python_embed) as z:z.extractall(runtime)
(runtime/'python312._pth').write_text('python312.zip\n.\n../_internal\n../python-source\nimport site\n')
source=app/'python-source';source.mkdir(exist_ok=True)
for f in (r/'native-boost').glob('*.py'):shutil.copy2(f,source/f.name)
for src,dst in [('mode4_grid_gpu','mode4_grid_gpu'),('tsl_render_gpu','tsl_render_gpu'),('tsl_render_win','tsl_render'),('grid120_launcher','TASL-PC-Boost')]:
 shutil.copy2(o.bin/(src+'.exe'),app/(dst+'.exe'))
shutil.copy2(r/'native-boost/mode4_grid_gpu.hlsl',app/'mode4_grid_gpu.hlsl')
version=json.loads((r/'package.json').read_text())['version']
probe="import{MODE4_LIMIT,MODE4_BLUR_SIGMA,MODE4_MIN_EDGE,MODE4_GLYPH_PRECISION}from'./public/tsl-mode4-grid60.js';console.log(JSON.stringify({limit:MODE4_LIMIT,sigma:MODE4_BLUR_SIGMA,minEdge:MODE4_MIN_EDGE,precision:MODE4_GLYPH_PRECISION}))"
info=json.loads(subprocess.check_output(['node','--input-type=module','-e',probe],cwd=r,text=True))
(app/'MODE4-60-README.txt').write_text(
 f'TASL Archive Player v{version} — モード4 60px輪郭AA\n\n'
 'ZIP全体を新しいフォルダへ展開し、TASL-PC-Boost.exeを起動してください。旧アプリを開いている場合は先に閉じてください。\n'
 '従来と同じlocalhost:39083・TASL-Faithful-Boost保存領域を使用します。フォントのインストールは不要です。\n'
 '指定170文字、60×60px固定セル、Noto Sans Mono CJK JP Regularを使用します。\n'
 f'Gaussian sigma={info["sigma"]}、輪郭量{info["minEdge"]}以上、誤差{info["limit"]}以下の文字だけを採用します。\n'
 f'余分な字形線の評価重みは{info["precision"]*100:.0f}%です。不合格は60px幅の全角空白になります。\n'
 '字形の名目サイズは60pxです。62pxのインク範囲を持つ4字（├ ┤ ┼ β）は60/62倍でセル内に収めます。\n'
 'Windows 10 / GTX 1050 Tiで検証しています。GPU描画とMP4圧縮は別処理で、この環境では圧縮にlibx264 CPUを使用します。\n'
 'スマホ向けは共通実装とChromium/WebKitで検証します。Windows 11・Android・iOSの実機動作は未確認です。\n'
 '既存TSLを再生できます。新しい位置調整付きTSLの正確な再生にはRC3以降が必要です。\n'
 'モード1～3の方式は維持します。旧方式のモード4途中データは混在させません。RC5の途中データは同じエンジン6005です。\n'
 '詳細はMODE4_GRID60.md、ACCEPTANCE_MODE4_60.md、検証報告を参照してください。\n',encoding='utf-8')
shutil.copy2(r/'ACCEPTANCE_MODE4_60.md',app/'ACCEPTANCE_MODE4_60.md')
shutil.copy2(r/'MODE4_GRID60.md',app/'MODE4_GRID60.md')
files={str(p.relative_to(app)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(app.rglob('*')) if p.is_file()}
(app/'SHA256SUMS.json').write_text(json.dumps(files,ensure_ascii=False,indent=2),encoding='utf-8')
print(app)
