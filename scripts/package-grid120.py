"""Build an isolated portable Mode 4 candidate from the known-good package.
Usage: python3 scripts/package-grid120.py --baseline ZIP --python-embed ZIP --bin DIR --out NEW_DIR
The baseline and published deployment are never modified.
"""
from pathlib import Path
import argparse,zipfile,shutil,json,hashlib
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
  if rel is not None and rel.parts and rel.parts[0]=='app':continue
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
for f in (r/'native-boost').glob('*.hlsl'):shutil.copy2(f,app/f.name)
(app/'MODE4-120-README.txt').write_text(
 'TASL モード4 120px試験版（公開版とは別です）\n\n'
 'ZIP全体を新しいフォルダへ展開し、TASL-PC-Boost.exeを起動してください。\n'
 'localhost:39087と専用の途中保存領域を使います。フォントのインストールは不要です。\n'
 '指定170文字・120px固定・Noto Sans Mono CJK JP Regular。\n'
 'Windows 10 / GTX 1050 Tiで字形照合GPU・CPU/GPU描画・MP4出力を検証。\n'
 'この環境ではNVENC API互換性のため圧縮はCPUへ自動切替します。\n'
 'Windows 11、Android、iOSの実機検証は未完了です。\n'
 '小さな顔などのAA視認性には制限があります。検証報告を参照してください。\n',
 encoding='utf-8')
files={str(p.relative_to(app)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(app.rglob('*')) if p.is_file()}
(app/'SHA256SUMS.json').write_text(json.dumps(files,ensure_ascii=False,indent=2),encoding='utf-8')
print(app)
