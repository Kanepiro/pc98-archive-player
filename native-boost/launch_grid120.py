"""Boot the 60px release using its packaged Python runtime."""
import sys,os,runpy
from pathlib import Path
root=Path(__file__).resolve().parents[1]
log=(root/'grid60-host.log').open('a',encoding='utf-8',buffering=1)
sys.stdout=sys.stderr=log
sys.frozen=True
sys.executable=str(root/'TASL-PC-Boost.exe')
sys._MEIPASS=str(root/'_internal')
dll_dirs=[os.add_dll_directory(str(p)) for p in [root,root/'_internal'] if p.is_dir()]
sys.path.insert(0,str(root/'python-source'))
runpy.run_path(str(root/'python-source/bridge.py'),run_name='__main__')
