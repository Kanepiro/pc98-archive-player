"""Modes 1-3: bounded shared-memory transport, exact GPU temporal residency."""
import mmap
import queue
import struct
import subprocess
import threading
import uuid
from fullgpu_bridge import ModesGpuClient

class ResidentModesClient(ModesGpuClient):
    def state(self,session,sequence):
        with self.lock:
            result=getattr(self,'states',{}).get((session,sequence))
            if result is None:raise ValueError('Mode snapshot expired; resume the committed checkpoint')
            return result
    def validate(self, payload):
        if len(payload)<64:
            raise ValueError('Mode header missing')
        h=struct.unpack_from('<16I',payload)
        if h[1]==1:
            return super().validate(payload)
        magic,version,mode,w,height,s,g,old=h[:8]
        if magic!=0x4d475354 or version!=2 or mode not in (1,2,3) or not (1<=w<=480 and 1<=height<=240 and 1<=s<=10 and old<=1) or h[15]&~3:
            raise ValueError('Resident mode header')
        n,cells=w*height*s*s,w*height
        if n>3000000 or (mode==3 and not (2<=g<=128 and cells*g<=10000000 and h[12]<g)) or (mode!=3 and (g or old)):
            raise ValueError('Resident mode capacity')
        expected=64+n*4+(4*g*(2+2*s*s) if mode==3 and h[15]&1 else 0)+(4*(2*n+cells) if old and h[15]&2 else 0)
        if len(payload)!=expected:
            raise ValueError('Resident mode payload length')
        return 48+cells*4+(n*8 if mode==3 else 0)

    def close(self):
        super().close()
        if getattr(self,'mapping',None) is not None:
            self.mapping.close()
            self.mapping=None

    def compute(self,payload):
        with self.lock:
            size=self.validate(payload)
            if not self.probe():
                raise RuntimeError(self.reason)
            if not self.process or self.process.poll() is not None:
                self.close()
                name='Local\\TASL-Public-Modes-'+uuid.uuid4().hex
                self.mapping=mmap.mmap(-1,96*1024*1024,tagname=name)
                self.process=subprocess.Popen([self.executable(self.program_name),'--stream',name],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0,creationflags=subprocess.CREATE_NO_WINDOW)
            proc=self.process
            self.mapping.seek(0)
            self.mapping.write(memoryview(payload)[64:])
            header=bytearray(payload[:64])
            struct.pack_into('<I',header,4,struct.unpack_from('<I',header,4)[0]|0x80000000)
            answer=queue.Queue(maxsize=1)
            def exchange():
                try:
                    proc.stdin.write(header)
                    proc.stdin.flush()
                    ack=bytearray()
                    while len(ack)<4:
                        part=proc.stdout.read(4-len(ack))
                        if not part: raise RuntimeError('Mode engine exited')
                        ack.extend(part)
                    if struct.unpack('<I',ack)[0]!=size: raise RuntimeError('Mode result length')
                    self.mapping.seek(64*1024*1024)
                    answer.put(self.mapping.read(size))
                except Exception as exc:
                    answer.put(exc)
            threading.Thread(target=exchange,daemon=True).start()
            try:
                result=answer.get(timeout=180)
                if isinstance(result,Exception): raise result
                h=struct.unpack_from('<16I',payload)
                if h[1]==2 and h[2]==3:
                    if not hasattr(self,'states'):self.states={}
                    self.states[(h[13],h[14])]=result
                    while len(self.states)>2:del self.states[next(iter(self.states))]
                return result
            except (queue.Empty,OSError,RuntimeError):
                self.close()
                raise RuntimeError('Mode exchange failed; last committed checkpoint remains available')
