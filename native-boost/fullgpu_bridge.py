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
        if magic != 0x43504754 or op not in (1, 2, 3, 4) or w < 4 or h < 4 or w*h > 3000000:
            raise ValueError("Invalid contour dimensions")
        regions=struct.unpack_from("<I",payload,28)[0] if op == 4 else 0
        if regions>8 or len(payload) != 32+w*h*4+regions*24*4:
            raise ValueError("Contour size mismatch")
        return 24+w*h*(12 if op in (1,4) else 4)
