import json,os,subprocess,sys,time,urllib.request
from pathlib import Path
root=Path(sys.argv[1]).resolve()
env=os.environ.copy();env.update(TASL_NO_BROWSER='1',TASL_BOOST_PORT='39086',TASL_TEST_VISION_CPU='1',TASL_TEST_WARP='1',TASL_TEST_NATIVE_VISION='1')
log=(root/'packaged-smoke.log').open('wb')
p=subprocess.Popen([str(root/'TASL-PC-Boost.exe')],env=env,stdout=log,stderr=log)
base='http://127.0.0.1:39086'
def get(path):return json.load(urllib.request.urlopen(base+path,timeout=120))
try:
 for _ in range(60):
  try:health=get('/health');break
  except Exception:
   if p.poll() is not None:raise RuntimeError('Packaged application exited')
   time.sleep(1)
 else:raise RuntimeError('Packaged application startup timeout')
 assert health['nativeLayout'] and health['nativeContour'],health
 vision=get('/api/vision/health');assert vision['ready'] and vision['backend']=='CPU-Test',vision
 req=urllib.request.Request(base+'/api/vision/detect',data=bytes([80,140,180,255])*64*64,
  headers={'Content-Type':'application/octet-stream','X-TASL-Width':'64','X-TASL-Height':'64'})
 detected=json.load(urllib.request.urlopen(req,timeout=120))
 assert detected['backend']=='CPU-Test',detected
 assert detected['preprocessBackend']=='WARP-Test',detected
 assert detected['timing']['nmsBackend']=='WARP-Test',detected
 report={'app':health,'vision':vision,'detection':detected,'note':'Software adapter and CPU model provider only; real GTX/DirectML/NVENC remain unverified'}
 (root/'VALIDATION'/'packaged-smoke.json').write_text(json.dumps(report,indent=2))
 print('PASS packaged application, bundled ONNX models, native GPU preprocessing and GPU NMS')
finally:
 p.terminate()
 try:p.wait(timeout=10)
 except subprocess.TimeoutExpired:p.kill()
 log.close()
