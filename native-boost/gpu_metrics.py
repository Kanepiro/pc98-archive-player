"""Local-only per-run GPU usage samples. Absence of telemetry is explicit."""
from pathlib import Path
import json,subprocess,threading,time,uuid,shutil
class RunMetrics:
 def __init__(self,root):
  self.root=Path(root);self.active={};self.lock=threading.RLock()
 def start(self):
  identity=uuid.uuid4().hex;event=threading.Event()
  state={'stop':event,'samples':[],'started':time.time(),'reason':''}
  with self.lock:self.active[identity]=state
  def sample():
   exe=shutil.which('nvidia-smi')
   if not exe:
    candidate=Path('C:/Windows/System32/nvidia-smi.exe')
    exe=str(candidate) if candidate.exists() else None
   if not exe:state['reason']='nvidia-smi unavailable; GPU utilization is unverified';return
   while not event.is_set():
    try:
     command=[exe,'--query-gpu=index,name,utilization.gpu,utilization.memory,memory.used','--format=csv,noheader,nounits']
     p=subprocess.run(command,capture_output=True,text=True,timeout=5,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
     if p.returncode:state['reason']=p.stderr.strip()[:300];return
     state['samples'].append({'seconds':time.time()-state['started'],'devices':p.stdout.strip().splitlines()})
    except Exception as e:state['reason']=str(e);return
    event.wait(1)
  thread=threading.Thread(target=sample,daemon=True);state['thread']=thread;thread.start();return identity
 def finish(self,identity,report):
  with self.lock:state=self.active.pop(identity,None)
  if not state:raise ValueError('Unknown measurement run')
  state['stop'].set();state['thread'].join(timeout=6)
  report.update({'reportFormat':1,'finishedUnix':time.time(),'wallFromMeasurementStartSeconds':time.time()-state['started'],
   'gpuUsage':{'source':'nvidia-smi','samples':state['samples'],'unavailableReason':state['reason']},
   'gpuUsageSamplesAvailable':bool(state['samples'])})
  path=self.root/('metrics-'+identity+'.json')
  path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
  return path
