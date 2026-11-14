"""Persistent native global layout service. Never labels software emulation as hardware."""
import os
import struct
import subprocess
import threading
import queue

class FullGpuClient:
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
            program = self.executable("fullgpu_layout")
            if os.name != "nt" or not program:
                self.reason = "Windowsネイティブ全体組版GPUを使用できません"
                return False
            try:
                p = subprocess.run([program, "--probe"], capture_output=True, timeout=90)
                self.healthy = p.returncode == 0 and p.stdout.startswith(b"DIRECTCOMPUTE_LAYOUT ")
                if self.healthy:
                    self.name = p.stdout.decode("utf-8", "replace").strip().split("DIRECTCOMPUTE_LAYOUT ", 1)[1]
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
            if len(payload) < 36:
                raise ValueError("Incomplete layout request")
            magic, version, w, h, s, g, old, cut, faces = struct.unpack_from("<9I", payload)
            if magic != 0x4353344d or version != 1 or not (4 <= w <= 480 and 4 <= h <= 240 and 4 <= s <= 10 and 2 <= g <= 512 and faces <= 8 and old <= 1 and cut <= 1):
                raise ValueError("Invalid layout dimensions")
            cells, n = w*h, w*h*s*s
            expected = 4*(9+5*n+9*cells+4*faces+7*g+4*g*s*s)
            if len(payload) != expected or cells*g > 6000000 or n > 3000000:
                raise ValueError("Layout payload length/capacity mismatch")
            size = cells*4+144
            if not self.process or self.process.poll() is not None:
                self.process = subprocess.Popen([self.executable("fullgpu_layout"), "--stream"],
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
