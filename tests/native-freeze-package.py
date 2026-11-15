import json,os,subprocess,sys,time,urllib.request
from pathlib import Path
root=Path(sys.argv[1]).resolve();out=Path('freeze-validation');out.mkdir(exist_ok=True)
env=os.environ.copy();env.update(TASL_NO_BROWSER='1',TASL_BOOST_PORT='39086',TASL_TEST_VISION_CPU='1',TASL_TEST_WARP='1',TASL_TEST_NATIVE_VISION='1',BOOST_URL='http://127.0.0.1:39086/')
subprocess.run([str(root/'ffmpeg.exe'),'-v','error','-y','-f','lavfi','-i','testsrc2=size=256x144:rate=30:duration=65','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=65','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(root/'app/__freeze.mp4')],check=True)
log=(out/'packaged-server.log').open('wb');p=subprocess.Popen([str(root/'TASL-PC-Boost.exe')],env=env,stdout=log,stderr=log)
try:
 for _ in range(90):
  try:
   with urllib.request.urlopen(env['BOOST_URL']+'health',timeout=120) as r:health=json.load(r)
   break
  except Exception:
   if p.poll() is not None:raise RuntimeError('Packaged EXE exited')
   time.sleep(1)
 else:raise RuntimeError('Packaged startup timeout')
 assert health['version']=='0.3.43',health
 subprocess.run(['node','tests/native-freeze-packaged.browser.mjs'],env=env,check=True,timeout=900)
 f=out/'native-freeze-65s.mp4'
 probe=json.loads(subprocess.check_output([str(root/'ffprobe.exe'),'-v','error','-show_format','-show_streams','-of','json',str(f)]))
 assert abs(float(probe['format']['duration'])-65)<.1,probe
 assert any(s['codec_type']=='audio' for s in probe['streams'])
 result=subprocess.run([str(root/'ffmpeg.exe'),'-hide_banner','-nostats','-i',str(f),'-an','-vf','scale=320:-2,freezedetect=n=-45dB:d=3','-f','null','-'],capture_output=True,text=True,check=True)
 assert 'lavfi.freezedetect.freeze_start' not in result.stderr,result.stderr
 (out/'packaged-video-report.json').write_text(json.dumps({'health':health,'probe':probe,'freezeOver3Seconds':False,'note':'WARP software GPU and CPU audio/video encoding; physical GTX/NVENC not tested'},indent=2))
 print('PASS packaged MP4: 65 seconds, sound and changing pictures through the end')
finally:
 p.terminate()
 try:p.wait(timeout=10)
 except subprocess.TimeoutExpired:p.kill()
 log.close()
