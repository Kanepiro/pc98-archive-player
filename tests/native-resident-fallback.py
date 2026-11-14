"""Actual D3D11 allocation-failure fallback parity, using explicit WARP only."""
import json, os, struct, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
payload=bytearray((root/'gpu-validation/resident-input.bin').read_bytes())
w,h=struct.unpack_from('<2I',payload,40)
exe=root/'native-boost/fullgpu_layout.exe'
env={**os.environ,'TASL_TEST_WARP':'1'}
before=bytearray(payload);struct.pack_into('<I',before,8,3)
a=subprocess.run([str(exe),'--stream'],input=before,capture_output=True,env=env,timeout=180,check=True).stdout
b=subprocess.run([str(exe),'--stream'],input=payload,capture_output=True,
 env={**env,'TASL_TEST_RESIDENT_FAIL_ALLOC':'1'},timeout=180,check=True).stdout
assert len(a)==len(b)==w*h*4+272
assert a[:w*h*4+80]==b[:w*h*4+80], 'Fallback changed glyphs or diagnostics'
metrics=struct.unpack_from('<16d',b,w*h*4+144)
assert metrics[0]==0 and metrics[1]==0 and metrics[14]==3,metrics
report={'adapter':'Explicit WARP software','allocationFailureFallback':'PASS','exactGlyphsAndDiagnostics':True,
 'residentBytes':metrics[1],'reason':metrics[14]}
(root/'gpu-validation/resident-fallback.json').write_text(json.dumps(report,indent=2))
print(report)
