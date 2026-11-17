from pathlib import Path
import subprocess,json,array,math
work=Path(__file__).resolve().parent
ff=str(work/'package-final/TASL-PC-Boost/ffmpeg.exe')
def samples(p):
 raw=subprocess.check_output([ff,'-nostdin','-v','error','-i',str(p),'-vn','-ac','1','-ar','8000','-f','f32le','-'],creationflags=subprocess.CREATE_NO_WINDOW)
 a=array.array('f');a.frombytes(raw);return a
source=samples(work/'fixture.mp4');results=[]
for platform in ['windows','web']:
 p=work/'qa'/platform/'portrait-3x4-legacy.mp4';target=samples(p)
 n=min(len(source),len(target))-800;ref=source[400:400+n]
 scores=[]
 for lag in range(-400,401):
  shifted=target[400+lag:400+lag+n]
  dot=sum(x*y for x,y in zip(ref,shifted));energy=sum(x*x for x in shifted)
  scores.append((dot/math.sqrt(max(1e-30,energy)),lag))
 best=max(scores);lag=best[1];corr=best[0]/math.sqrt(sum(x*x for x in ref))
 assert abs(lag)<=200 and corr>.95,(platform,lag,corr)
 results.append({'platform':platform,'rate':8000,'lagSamples':lag,'lagMilliseconds':lag/8,'correlation':corr,'sourceSamples':len(source),'outputSamples':len(target),'pass':True})
(work/'audio-sync.json').write_text(json.dumps({'pass':True,'method':'8 kHz decoded mono waveform correlation over +/-50 ms; representative new-mode AAC encodes','results':results},indent=2),encoding='utf-8')
print(json.dumps(results),flush=True)
