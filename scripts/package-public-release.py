"""Package the public Boost release from an official runtime ZIP and built sources."""
from pathlib import Path,PurePosixPath,PureWindowsPath
import argparse,hashlib,json,re,shutil,zipfile
p=argparse.ArgumentParser()
p.add_argument('--baseline-zip',type=Path,required=True)
p.add_argument('--native-build',type=Path,required=True)
p.add_argument('--out',type=Path,required=True,help='New directory containing TASL-PC-Boost')
p.add_argument('--zip',dest='zip_path',type=Path,help='Optional new ZIP file')
a=p.parse_args();source=Path(__file__).resolve().parents[1]
version=json.loads((source/'package.json').read_text(encoding='utf-8'))['version']
def sha(path):
 with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
expected='7d77e7ff46b78b323599faa3f8c519e4a955008535fb003c414e31d7e138c30b'
assert sha(a.baseline_zip)==expected,'Use the official windows-v0.3.46 runtime ZIP'
for name in ['ultimate_small_engine.exe','ultimate_small_match.hlsl','native_modes.exe','portable_engine.exe','tsl_render.exe','tsl_render_gpu.exe','TASL-PC-Boost.exe','native_modes.hlsl','portable_match.hlsl','tsl_render_gpu.hlsl']:
 assert (a.native_build/name).is_file(),name
dist=source/'dist';index=(dist/'index.html').read_text(encoding='utf-8')
match=re.search(r'src="/(native-assets/[^/]+)/app\.js',index);assert match,'Run npm run build first'
native_assets=match.group(1);assert (dist/native_assets/'app.js').is_file()
assert not a.out.exists(),'Refusing to replace an existing output directory'
if a.zip_path:assert not a.zip_path.exists(),'Refusing to replace an existing ZIP'
app=a.out/'TASL-PC-Boost';app.mkdir(parents=True)
with zipfile.ZipFile(a.baseline_zip) as z:
 for info in z.infolist():
  path=PurePosixPath(info.filename)
  if path.is_absolute() or '..' in path.parts:raise ValueError('Unsafe ZIP path')
  if info.is_dir() or len(path.parts)<2:continue
  assert path.parts[0]=='TASL-PC-Boost'
  rel=Path(*path.parts[1:])
  if rel.parts[0] not in {'_internal','runtime','models'} and rel.name not in {'ffmpeg.exe','ffprobe.exe'} and rel.suffix not in {'.exe','.hlsl'}:continue
  dest=app/rel;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(info))
for path in dist.rglob('*'):
 if not path.is_file() or path.name=='__benchmark.html':continue
 rel=path.relative_to(dist)
 if rel.parts[0]=='native-assets' and '/'.join(rel.parts[:2])!=native_assets:continue
 dest=app/'app'/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,dest)
(app/'python-source').mkdir()
for path in (source/'native-boost').glob('*.py'):shutil.copy2(path,app/'python-source'/path.name)
for path in a.native_build.iterdir():
 if path.suffix in {'.exe','.hlsl'}:shutil.copy2(path,app/path.name)
build_report=json.loads((a.native_build/'build-report.json').read_text(encoding='utf-8'))
# Publish the compiler identity, reproducible flags and file names without local workstation paths.
build_report['compiler']='\n'.join(line for line in build_report['compiler'].splitlines() if not line.startswith('InstalledDir:'))
def publish_command(command):
 result=[PureWindowsPath(command[0]).name]
 for arg in command[1:]:
  path=PureWindowsPath(arg)
  if len(path.parts)>1:
   folder='native-boost' if path.parent.name=='native-boost' else 'build'
   arg=folder+'/'+path.name
  result.append(arg)
 return result
build_report['commands']=[publish_command(cmd) for cmd in build_report['commands']]
metadata={'version':version,'baselineVersion':'0.3.46','baselineWindowsCommit':'4e834d6681d08ed672ab75abf8afa82b8c6dd7f7','baselineRuntimeZipSHA256':expected,'nativeAssets':native_assets,'nativeBuild':build_report}
(app/'RELEASE-BUILD.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
channel='Public Boost release candidate.' if '-' in version else 'Official public Boost release.'
(app/'README-RELEASE.txt').write_text('TASL Archive Player v'+version+'\n\nLaunch TASL-PC-Boost.exe. '+channel+'\nDefault port: 39083\nData: %LOCALAPPDATA%\\TASL-Faithful-Boost\nExtract into a new directory and close the old app before launching.\n',encoding='utf-8')
guide_name='はじめにお読みください.txt'
guide=(source/'native-boost'/guide_name).read_text(encoding='utf-8')
(app/guide_name).write_text('v'+version+'\n'+guide,encoding='utf-8-sig',newline='\r\n')
manifest={path.relative_to(app).as_posix():sha(path) for path in sorted(app.rglob('*')) if path.is_file()}
(app/'SHA256SUMS.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
if a.zip_path:
 a.zip_path.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(a.zip_path,'w',zipfile.ZIP_DEFLATED,6) as z:
  for path in sorted(app.rglob('*')):
   if path.is_file():z.write(path,'TASL-PC-Boost/'+path.relative_to(app).as_posix())
 with zipfile.ZipFile(a.zip_path) as z:assert z.testzip() is None
print(json.dumps({'version':version,'app':str(app.resolve()),'files':len(manifest),'zip':str(a.zip_path.resolve()) if a.zip_path else None,'zipSHA256':sha(a.zip_path) if a.zip_path else None}),flush=True)
