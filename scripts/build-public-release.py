"""Rebuild the public Windows Boost release with a generic x64 baseline."""
from pathlib import Path
import argparse,subprocess,json,hashlib,shutil,os
r=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
p.add_argument('--toolchain',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args();tool=a.toolchain/'bin';out=a.out;out.mkdir(parents=True,exist_ok=False)
flags=['-std=c++17','-O3','-march=x86-64','-mtune=generic','-mno-avx','-mno-ssse3','-mno-sse4.1','-mno-sse4.2','-ffp-contract=off','-static']
commands=[]
resource=out.resolve()/'public-version.o'
cmd=[str(tool.resolve()/'llvm-windres.exe'),str(r/'native-boost/public-version.rc'),str(resource)]
subprocess.run(cmd,check=True,cwd=r/'native-boost');commands.append(cmd)
for name,source,libs,extra in [
 ('ultimate_small_engine','ultimate_small_engine.cpp',['-ld3d11','-ldxgi','-ld3dcompiler'],[]),
 ('native_modes','native_modes.cpp',['-ld3d11','-ldxgi','-ld3dcompiler'],[]),
 ('portable_engine','portable_engine.cpp',['-ld3d11','-ldxgi','-ld3dcompiler'],[]),
 ('tsl_render_gpu','tsl_render_gpu.cpp',['-ld3d11','-ldxgi','-ld3dcompiler','-lgdi32','-luser32'],[]),
 ('tsl_render','tsl_render_win.cpp',['-lgdi32','-luser32'],[]),
 ('TASL-PC-Boost','grid120_launcher.cpp',[],['-municode','-mwindows'])]:
 command=[str(tool/'clang++.exe'),*flags,*extra,str(r/'native-boost'/source),*([str(resource)] if name=='TASL-PC-Boost' else []),'-o',str(out/(name+'.exe')),*libs]
 print('BUILD '+name,flush=True);subprocess.run(command,check=True);commands.append(command)
for name in ['ultimate_small_match.hlsl','native_modes.hlsl','mode4_directcompute.hlsl','portable_match.hlsl','tsl_render_gpu.hlsl']:
 shutil.copy2(r/'native-boost'/name,out/name)
report={'baseWindowsCommit':'4e834d6681d08ed672ab75abf8afa82b8c6dd7f7','compiler':subprocess.check_output([str(tool/'clang++.exe'),'--version'],text=True),'commands':commands,
 'sha256':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in out.glob('*.exe')}}
(out/'build-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('BUILD COMPLETE',flush=True)
