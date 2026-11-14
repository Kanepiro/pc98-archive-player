import os,sys,json,time,threading,subprocess,math
from pathlib import Path
from types import SimpleNamespace
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root/'native-boost'))
import mp4_native
os.environ['TASL_TEST_WARP']='1'
def exe(name):return str(root/'native-boost'/(name+'.exe'))
report=[]
for old in [True,False]:
 name='legacy' if old else 'fullgpu'
 tsl=root/'gpu-validation'/(name+'-video.TSL')
 nw,nh=mp4_native.metadata(tsl)
 job=SimpleNamespace(output=tsl,source=root/'dist/__validation.mp4',lock=threading.RLock(),
  mp4_state='',mp4_message='',mp4_encoder='',mp4_done=0,mp4_total=10,mp4_procs=[],mp4_cancel=False)
 start=time.perf_counter()
 success,reason=mp4_native._encode(job,exe,5,nw,nh,640,360,False,tsl.with_suffix('.mp4'),not old)
 elapsed=time.perf_counter()-start
 assert success,reason
 probe=json.loads(subprocess.check_output([exe('ffprobe'),'-v','error','-show_streams','-show_format','-of','json',str(tsl.with_suffix('.mp4'))]))
 stream=next(s for s in probe['streams'] if s['codec_type']=='video')
 assert stream['width']==640 and stream['height']==360 and abs(float(probe['format']['duration'])-2)<.25
 report.append({'variant':name,'mp4Seconds':elapsed,'encoder':job.mp4_encoder,'gpuRaster':not old,
  'frameCount':stream.get('nb_frames'),'duration':probe['format']['duration'],'bytes':tsl.with_suffix('.mp4').stat().st_size})
video=json.loads((root/'gpu-validation/video-report.json').read_text())
for item,run in zip(report,video['runs']):item['conversionPlusMp4Seconds']=run['wallMs']/1000+item['mp4Seconds']
out={'adapter':'WARP software validation; NVENC and GTX 1050 Ti unverified','sameSourceSha256':video['sourceSha256'],'runs':report}
(root/'gpu-validation/mp4-report.json').write_text(json.dumps(out,indent=2));print(out)
