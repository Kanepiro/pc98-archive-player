from pathlib import Path
import subprocess,json,struct,hashlib,sys
work=Path(__file__).resolve().parent
app=work/'package/TASL-PC-Boost'
ffmpeg=str(app/'ffmpeg.exe');ffprobe=str(app/'ffprobe.exe')
platform=sys.argv[1];root=work/'qa'/platform
report_path=root/'media.json'
report=json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {'files':{},'regression':{}}
def run(args):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
 if p.returncode or p.stderr:raise RuntimeError(str(args[-1])+': '+p.stderr.decode('utf-8','replace'))
 return p.stdout
source=json.loads(run([ffprobe,'-v','error','-show_streams','-of','json',str(work/'fixture.mp4')]))
source_audio=next(s for s in source['streams'] if s['codec_type']=='audio')
for p in sorted(root.glob('*.mp4')):
 name=p.stem
 # Only consume complete QA cases, never a file that is still being written.
 case=name.removesuffix('-reopened').removesuffix('-baseline').removesuffix('-candidate')
 if not (root/(case+'.json')).exists():continue
 with p.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
 if report['files'].get(p.name,{}).get('sha256')==sha:continue
 q=json.loads(run([ffprobe,'-v','error','-count_frames','-show_streams','-of','json',str(p)]))
 v=next(s for s in q['streams'] if s['codec_type']=='video');audio=next((s for s in q['streams'] if s['codec_type']=='audio'),None)
 assert v['codec_name']=='h264' and v['profile'] in ['Constrained Baseline','Baseline','Main','High'] and v['pix_fmt']=='yuv420p',(name,v['profile'],v['pix_fmt'])
 assert int(v.get('bits_per_raw_sample','8'))==8
 assert int(v['nb_read_frames'])==30,(name,v['nb_read_frames'])
 fixed=not name.startswith('regression-')
 if fixed:
  expected=(1080,1440) if 'portrait-3x4' in name else (1440,1080)
  assert (v['width'],v['height'])==expected,(name,v['width'],v['height'])
 if name.endswith('-reopened'):assert audio is None
 else:
  assert audio and audio['codec_name']=='aac'
  if platform=='windows' or fixed:assert audio['profile']=='LC',(name,audio['profile'])
  assert abs(float(audio.get('start_time',0)))<.05,(name,audio.get('start_time'))
  assert abs(float(audio['duration'])-float(source_audio['duration']))<.06,(name,audio['duration'],source_audio['duration'])
 boxes=[]
 with p.open('rb') as f:
  offset=0
  while offset<p.stat().st_size:
   f.seek(offset);head=f.read(8);size,kind=struct.unpack('>I4s',head)
   if size==1:size=struct.unpack('>Q',f.read(8))[0]
   if size==0:size=p.stat().st_size-offset
   assert size>=8;boxes.append((kind.decode('ascii'),offset));offset+=size
 assert dict(boxes)['moov']<dict(boxes)['mdat'],name+' not faststart'
 decoded=run([ffmpeg,'-nostdin','-v','error','-xerror','-err_detect','explode','-i',str(p),'-map','0:v:0','-pix_fmt','yuv420p','-fps_mode','passthrough','-f','hash','-hash','sha256','-']).decode().strip()
 ahash=run([ffmpeg,'-nostdin','-v','error','-xerror','-err_detect','explode','-i',str(p),'-map','0:a:0','-f','hash','-hash','sha256','-']).decode().strip() if audio else None
 report['files'][p.name]={'sha256':sha,'video':{k:v.get(k) for k in ['codec_name','profile','pix_fmt','bits_per_raw_sample','width','height','r_frame_rate','avg_frame_rate','time_base','start_time','duration','nb_read_frames']},'audio':{k:audio.get(k) for k in ['codec_name','profile','sample_rate','channels','start_time','duration']} if audio else None,'decodedVideoSHA256':decoded,'decodedAudioSHA256':ahash,'faststart':True,'decodeErrors':0}
 report_path.write_text(json.dumps(report,indent=2),encoding='utf-8')
 print('MEDIA '+platform+' '+name+' PASS',flush=True)
for preset in ['portrait','landscape','screen','pc98']:
 for mode in ['legacy','halftone','quality','artisan']:
  name='regression-'+preset+'-'+mode
  pair=[report['files'].get(name+'-'+label+'.mp4') for label in ['baseline','candidate']]
  if not all(pair):continue
  assert pair[0]['video']==pair[1]['video'],name+' video metadata changed'
  assert pair[0]['decodedVideoSHA256']==pair[1]['decodedVideoSHA256'],name+' decoded video changed'
  assert pair[0]['audio']==pair[1]['audio'] and pair[0]['decodedAudioSHA256']==pair[1]['decodedAudioSHA256'],name+' audio changed'
  report['regression'][name]={'decodedVideoIdentical':True,'decodedAudioIdentical':True,'metadataIdentical':True}
report['pass']=True;report['sourceAudio']={k:source_audio.get(k) for k in ['profile','sample_rate','channels','start_time','duration']}
report_path.write_text(json.dumps(report,indent=2),encoding='utf-8')
print('MEDIA VERIFIED '+platform+' '+str(len(report['files']))+' files, '+str(len(report['regression']))+' regression pairs',flush=True)
