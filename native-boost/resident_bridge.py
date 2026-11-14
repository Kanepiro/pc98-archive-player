"""Windows layout protocol only; native modes 1–3 and mobile remain unchanged."""
import struct
from fullgpu_bridge import FullGpuClient

class ResidentFullGpuClient(FullGpuClient):
    active = None

    def validate(self, payload):
        if len(payload) < 32 or struct.unpack_from("<I", payload)[0] != 0x524c4754:
            return super().validate(payload)
        magic, version, op, token, seq, old, cut, faces = struct.unpack_from("<8I", payload)
        if version != 1 or op not in (1, 2, 3, 4) or not token or old > 1 or cut > 1 or faces > 8:
            raise ValueError("Resident layout header")
        if op in (1, 3):
            size = super().validate(memoryview(payload)[32:])
            _, _, w, h, s, g, v_old, v_cut, v_faces = struct.unpack_from("<9I", payload, 32)
            if (old, cut, faces) != (v_old, v_cut, v_faces):
                raise ValueError("Resident header mismatch")
        else:
            if not self.active or self.active[:2] != (token, seq-1) or not self.process or self.process.poll() is not None:
                raise ValueError("Resident session expired")
            _, _, w, h, s, g = self.active
            cells, n = w*h, w*h*s*s
            if len(payload) != 32+4*((4*n if op == 4 else 5*n+cells)+faces*4):
                raise ValueError("Resident delta length")
            size = cells*4+144
        return size+128

    def compute(self, payload):
        with self.lock:
            result = super().compute(payload)
            if struct.unpack_from("<I", payload)[0] == 0x524c4754:
                _, _, op, token, seq = struct.unpack_from("<5I", payload)
                if op == 1:
                    w, h, s, g = struct.unpack_from("<4I", payload, 40)
                    self.active = (token, seq, w, h, s, g)
                elif op in (2, 4):
                    self.active = (token, seq, *self.active[2:])
                else:
                    self.active = None
            else:
                self.active = None
            return result
