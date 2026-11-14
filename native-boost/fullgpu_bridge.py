"""Persistent native global layout service. Never labels software emulation as hardware."""
import os
import struct
import subprocess
import threading
import queue

class FullGpuClient:
    program_name = "fullgpu_layout"
    marker = b"DIRECTCOMPUTE_LAYOUT "
    def __init__(self, executable):
        self.executable = executable
        self.lock = threading.RLock()
        self.process = None
        self.known = self.healthy = False
        self.name = self.reason = ""
        self.software = False

    def probe(self):
        with self.lock:
            if self.known:
                return self.healthy
            self.known = True
            program = self.executable(self.program_name)
            if os.name != "nt" or not program:
                self.reason = "Windowsネイティブ全体組版GPUを使用できません"
                return False
            try:
                p = subprocess.run([program, "--probe"], capture_output=True, timeout=90)
                self.healthy = p.returncode == 0 and p.stdout.startswith(self.marker)
                if self.healthy:
                    self.name = p.stdout.decode("utf-8", "replace").strip().split(self.marker.decode(), 1)[1]
                    self.software = "TEST ONLY" in self.name
                else:
                    self.reason = p.stderr.decode("utf-8", "replace")[-800:]
            except (OSError, subprocess.TimeoutExpired) as e:
                self.reason = str(e)
            return self.healthy

    def close(self):
        with self.lock:
            p, self.process = self.process, None
            if p and p.poll() is None:
                p.kill()
                try:
                    p.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    pass

    def compute(self, payload):
        with self.lock:
            if not self.probe():
                raise RuntimeError(self.reason)
            size = self.validate(payload)
            if not self.process or self.process.poll() is not None:
                self.process = subprocess.Popen([self.executable(self.program_name), "--stream"],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
            proc = self.process
            result = queue.Queue(maxsize=1)
            def exchange():
                try:
                    view = memoryview(payload)
                    while view:
                        count = proc.stdin.write(view)
                        if not count:
                            raise RuntimeError("GPU input pipe closed")
                        view = view[count:]
                    proc.stdin.flush()
                    data = bytearray()
                    while len(data) < size:
                        block = proc.stdout.read(min(1024*1024, size-len(data)))
                        if not block:
                            raise RuntimeError("GPU layout process exited")
                        data.extend(block)
                    result.put(bytes(data))
                except Exception as e:
                    result.put(e)
            thread = threading.Thread(target=exchange, daemon=True)
            thread.start()
            try:
                answer = result.get(timeout=180)
                if isinstance(answer, Exception):
                    raise answer
                return answer
            except (queue.Empty, OSError, RuntimeError, ValueError) as e:
                self.close()
                self.healthy = False
                self.reason = str(e) or "GPU layout timed out"
                raise RuntimeError(self.reason) from e

    def validate(self, payload):
        if len(payload) < 36:
            raise ValueError("Incomplete layout request")
        magic, version, w, h, s, g, old, cut, faces = struct.unpack_from("<9I", payload)
        if magic != 0x4353344d or version != 1 or not (4 <= w <= 480 and 4 <= h <= 240 and 4 <= s <= 10 and 2 <= g <= 512 and faces <= 8 and old <= 1 and cut <= 1):
            raise ValueError("Invalid layout dimensions")
        cells, n = w*h, w*h*s*s
        expected = 4*(9+5*n+9*cells+4*faces+7*g+4*g*s*s)
        if len(payload) != expected or cells*g > 6000000 or n > 3000000:
            raise ValueError("Layout payload length/capacity mismatch")
        return cells*4+144

class ContourGpuClient(FullGpuClient):
    program_name = "fullgpu_contour"
    marker = b"DIRECTCOMPUTE_CONTOUR "

    def validate(self, payload):
        if len(payload) < 32:
            raise ValueError("Incomplete contour header")
        magic, op, w, h = struct.unpack_from("<4I", payload)
        if magic != 0x43504754 or op not in (1, 2, 3, 4, 5, 6) or w < 4 or h < 4 or w*h > 3000000:
            raise ValueError("Invalid contour dimensions")
        if op == 5:
            points=struct.unpack_from("<I",payload,28)[0]
            if points>100000 or len(payload)!=32+w*h*8+32+points*16:raise ValueError("Face commands mismatch")
            return 24+w*h*8
        if op == 6:
            if len(payload)!=32+w*h*4:raise ValueError("Vision pixel mismatch")
            return 24+128*128*3*4+320*320*4
        regions=struct.unpack_from("<I",payload,28)[0] if op == 4 else 0
        if regions>8 or len(payload) != 32+w*h*4+regions*24*4:
            raise ValueError("Contour size mismatch")
        return 24+w*h*(12 if op in (1,4) else 4)

class NmsGpuClient(FullGpuClient):
    program_name="fullgpu_nms"
    marker=b"DIRECTCOMPUTE_NMS "
    def validate(self,payload):
        if len(payload)<16:raise ValueError("NMS header")
        magic,nf,no,_=struct.unpack_from("<4I",payload)
        if magic!=0x534d4e54 or not 1<=nf<=896 or not 1<=no<=19206 or len(payload)!=16+4*(nf*17+no*6):raise ValueError("NMS bounds")
        return (2+nf*17+36)*4

class ModesGpuClient(FullGpuClient):
    program_name = "native_modes"
    marker = b"DIRECTCOMPUTE_MODES "

    def validate(self, payload):
        if len(payload) < 64:
            raise ValueError("Incomplete native modes header")
        magic, version, mode, w, h, s, g, old = struct.unpack_from("<8I", payload)
        if magic != 0x4d475354 or version != 1 or mode not in (1, 2, 3) or not (1 <= w <= 480 and 1 <= h <= 240 and 1 <= s <= 10 and old <= 1):
            raise ValueError("Invalid native mode dimensions")
        n, cells = w*h*s*s, w*h
        if n > 3000000 or (mode == 3 and not (2 <= g <= 128 and cells*g <= 10000000 and struct.unpack_from("<I", payload, 48)[0] < g)) or (mode != 3 and (g or old)):
            raise ValueError("Native mode capacity")
        expected = 64+4*n+(4*g*(2+2*s*s) if mode == 3 else 0)+(4*(2*n+cells) if old else 0)
        if len(payload) != expected:
            raise ValueError("Native mode payload length")
        return 48+4*cells+(8*n if mode == 3 else 0)
