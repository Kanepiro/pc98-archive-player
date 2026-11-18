"""Bounded, persistent owner-only Mode 4 protocol."""
import struct, mmap, uuid, subprocess, threading, queue
from fullgpu_bridge import FullGpuClient
class UltimateClient(FullGpuClient):
 program_name="ultimate_engine"
 marker=b"ULTIMATE_DIRECTCOMPUTE "
 def validate(self,payload):
  if len(payload)<32:raise ValueError("Ultimate header missing")
  magic,op,a,b,c,_,_,channels=struct.unpack_from("<8I",payload)
  if magic!=0x55343654:raise ValueError("Ultimate magic invalid")
  if op==1:
   if (a,b)!=(2014,1152) or len(payload)!=32+a*b*4:raise ValueError("Ultimate atlas size")
   return 96
  if op==2:
   if not 1<=a<=4095 or (b,c)!=(2014,1152) or len(payload)!=32+a*c*4:raise ValueError("Ultimate feature size")
   return 96+a*12
  if op==3:
   if channels not in (0,3,4) or a<60 or b<60 or a%60 or b%60 or a*b>8640000 or not 1<=c<=145 or len(payload)!=96+c*4+a*b*(3 if channels==3 else 4):raise ValueError("Ultimate pixel size")
   return 96+(a//60)*(b//60)*12
  raise ValueError("Ultimate operation invalid")

 def close(self):
  super().close()
  if getattr(self,"mapping",None):self.mapping.close();self.mapping=None
 def compute(self,payload):
  with self.lock:
   size=self.validate(payload)
   if not self.probe():raise RuntimeError(self.reason)
   if not self.process or self.process.poll() is not None:
    self.close()
    name="Local\\TASL-ULTIMATE-"+uuid.uuid4().hex
    self.mapping=mmap.mmap(-1,40*1024*1024,tagname=name)
    self.process=subprocess.Popen([self.executable(self.program_name),"--stream",name],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0,creationflags=subprocess.CREATE_NO_WINDOW)
   proc=self.process;answer=queue.Queue(maxsize=1)
   self.mapping.seek(0);self.mapping.write(memoryview(payload)[32:])
   header=bytearray(payload[:32]);op=struct.unpack_from("<I",header,4)[0];struct.pack_into("<I",header,4,op|0x80000000)
   def exchange():
    try:
     proc.stdin.write(header);proc.stdin.flush();data=bytearray()
     while len(data)<size:
      block=proc.stdout.read(size-len(data))
      if not block:raise RuntimeError("ULTIMATE process exited; restart conversion")
      data.extend(block)
     answer.put(bytes(data))
    except Exception as e:answer.put(e)
   threading.Thread(target=exchange,daemon=True).start()
   try:
    result=answer.get(timeout=180)
    if isinstance(result,Exception):raise result
    return result
   except (queue.Empty,OSError,RuntimeError) as e:
    self.close();raise RuntimeError(str(e) or "ULTIMATE timed out") from e
