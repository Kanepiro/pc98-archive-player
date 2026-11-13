"""Loopback-only transport for the separate, native TASL PC Boost converter.

No account, cloud upload, or remote access. The browser sends an MP4/WebM to
127.0.0.1, FFmpeg decodes it sequentially, and C++ writes a compatible TSL.
"""
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from base64 import urlsafe_b64decode

HOST = "127.0.0.1"
PORT = 39083
APP_ORIGIN = "https://pc98-archive-player-seven.vercel.app"
ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
WORK = Path(tempfile.mkdtemp(prefix="tasl_pc_boost_"))
MAX_INPUT = 2 * 1024 ** 3
LIMIT = 192 * 1024 ** 2
JOBS = {}
LOCK = threading.RLock()


def allowed_origin(origin):
    return origin in (None, "", APP_ORIGIN) or bool(
        re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):[0-9]{2,5}", origin)
    )


def executable(name):
    ext = ".exe" if os.name == "nt" else ""
    path = ROOT / (name + ext)
    return str(path) if path.exists() else shutil.which(name) or ""


def clamp(v, lo, hi, field_name):
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise ValueError("Invalid " + field_name)
    if not math.isfinite(n) or not lo <= n <= hi:
        raise ValueError("Out of range: " + field_name)
    return n


@dataclass
class Job:
    id: str
    source: Path
    output: Path
    options: dict
    state: str = "queued"
    done: int = 0
    total: int = 0
    message: str = ""
    cancel: bool = False
    procs: list = field(default_factory=list)
    plan: dict = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)


def probe(input_path):
    result = subprocess.run([
        executable("ffprobe"), "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,duration:format=duration",
        "-of", "json", str(input_path),
    ], capture_output=True, text=True, timeout=45, check=True)
    obj = json.loads(result.stdout)
    v = obj.get("streams", [{}])[0]
    width, height = int(v["width"]), int(v["height"])
    duration = float(obj.get("format", {}).get("duration") or v.get("duration") or 0)
    if width < 32 or height < 64 or width * height > 3840 * 2160:
        raise ValueError("Video dimensions must be <= 4K")
    if not 0 < duration <= 7200:
        raise ValueError("Video duration must be at most 2 hours")
    return width, height, duration


def make_plan(opts, sw, sh, duration):
    mode = opts.get("mode")
    if mode not in ("legacy", "halftone", "quality", "artisan"):
        raise ValueError("Invalid conversion mode")
    pc98 = opts.get("sourceGrid") is True
    width = int(clamp(opts.get("width"), 4, 480, "width"))
    height = int(clamp(opts.get("height"), 4, 240, "height"))
    native16 = opts.get("native16") is True
    if pc98:
        width, height = (sw // 16) * 2, sh // 16
        native16 = True
    if width > (480 if native16 else 160) or height > (240 if native16 else 100):
        raise ValueError("Character dimensions exceed selected font mode")
    fps = clamp(opts.get("fps"), 1, 30, "fps")
    brightness = clamp(opts.get("brightness", 0), -100, 100, "brightness")
    contrast = clamp(opts.get("contrast", 1), .25, 3, "contrast")
    gamma = clamp(opts.get("gamma", 1), .4, 2.5, "gamma")
    edge = clamp(opts.get("edge", .6), 0, 1, "edge")
    fit = opts.get("fit", "contain")
    if fit not in ("contain", "cover"):
        raise ValueError("Invalid fit")
    px = clamp(opts.get("positionX", .5), 0, 1, "positionX")
    py = clamp(opts.get("positionY", .5), 0, 1, "positionY")
    ticks = max(1, math.floor(duration * 60 + .5))
    per_frame = (width + 2) * height + 3 + 24
    capacity = min(10000, (LIMIT - 4096) // per_frame)
    count = min(capacity, ticks, max(1, math.ceil(duration * fps)))
    return dict(width=width, height=height, fps=fps, count=count,
                ticks=ticks, native16=native16, mode=mode,
                brightness=brightness, contrast=contrast, gamma=gamma,
                edge=edge, fit=fit, positionX=px, positionY=py,
                sourceGrid=pc98, sourceWidth=sw, sourceHeight=sh,
                duration=ticks/60)


def ffmpeg_filter(plan):
    width = (plan["width"] + 1)//2 * 8
    height = plan["height"]*8
    fps = f'fps={plan["count"]*60}/{plan["ticks"]}'
    if plan["sourceGrid"]:
        sw, sh = plan["sourceWidth"], plan["sourceHeight"]
        cw, ch = (sw//16)*16, (sh//16)*16
        crop_x = int((sw-cw)*plan["positionX"])
        crop_y = int((sh-ch)*plan["positionY"])
        vf = f"crop={cw}:{ch}:{crop_x}:{crop_y},scale={width}:{height}:flags=fast_bilinear"
    else:
        ratio = "decrease" if plan["fit"] == "contain" else "increase"
        vf = f"scale={width}:{height}:force_original_aspect_ratio={ratio}:flags=fast_bilinear"
        if plan["fit"] == "contain":
            vf += (f",pad={width}:{height}:(ow-iw)*{plan['positionX']}:"
                   f"(oh-ih)*{plan['positionY']}:black")
        else:
            vf += (f",crop={width}:{height}:(iw-ow)*{plan['positionX']}:"
                   f"(ih-oh)*{plan['positionY']}")
    return f"{fps},{vf}"


def run_job(job):
    decoder = native = None
    try:
        with job.lock:
            job.state, job.message = "probing", "動画情報を調査中"
        sw, sh, duration = probe(job.source)
        plan = make_plan(job.options, sw, sh, duration)
        with job.lock:
            job.state, job.total = "converting", plan["count"]
            job.plan = plan
            job.message = "FFmpeg連続デコード＋C++文字変換"
        cmd = [executable("tsl_boost"), "--output", str(job.output),
               "--width", str(plan["width"]), "--height", str(plan["height"]),
               "--count", str(plan["count"]), "--ticks", str(plan["ticks"]),
               "--mode", plan["mode"], "--native16", "1" if plan["native16"] else "0",
               "--brightness", str(plan["brightness"]), "--contrast", str(plan["contrast"]),
               "--gamma", str(plan["gamma"]), "--edge", str(plan["edge"])]
        with (WORK / f"{job.id}.ffmpeg.log").open("wb") as log:
            decoder = subprocess.Popen(
                [executable("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error",
                 "-i", str(job.source), "-an", "-vf", ffmpeg_filter(plan),
                 "-frames:v", str(plan["count"]), "-pix_fmt", "rgb24",
                 "-f", "rawvideo", "pipe:1"], stdout=subprocess.PIPE, stderr=log,
                stdin=subprocess.DEVNULL, bufsize=1024*1024)
            native = subprocess.Popen(cmd, stdin=decoder.stdout,
                                      stdout=subprocess.DEVNULL,
                                      stderr=subprocess.PIPE, bufsize=65536)
            decoder.stdout.close()
            with job.lock:
                job.procs = [native, decoder]
                should_cancel = job.cancel
            if should_cancel:
                native.terminate()
                decoder.terminate()
            lines = []
            for raw in native.stderr:
                line = raw.decode("utf-8", "replace").strip()
                lines.append(line)
                if len(lines) > 20:
                    lines.pop(0)
                if line.startswith("FRAME "):
                    with job.lock:
                        job.done = int(line[6:].split("/", 1)[0])
            c_return = native.wait()
            d_return = decoder.wait()
        with job.lock:
            if job.cancel:
                job.state, job.message = "cancelled", "キャンセル済み"
            elif c_return == 0 and d_return == 0 and job.output.is_file():
                job.state, job.message = "done", "TSL完成"
                job.done = job.total
            else:
                job.state = "error"
                job.message = " / ".join(lines[-4:]) or f"converter={c_return}, decoder={d_return}"
    except Exception as exc:
        with job.lock:
            job.state = "cancelled" if job.cancel else "error"
            job.message = str(exc)
    finally:
        for p in (native, decoder):
            if p and p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    p.kill()
        with job.lock:
            job.procs = []


class Handler(BaseHTTPRequestHandler):
    server_version = "TASL-PC-Boost/0.1"

    def _ok_origin(self):
        return (self.headers.get("Host") in
                (f"127.0.0.1:{PORT}", f"localhost:{PORT}")
                and allowed_origin(self.headers.get("Origin")))

    def send(self, code, data, content_type="application/json"):
        if isinstance(data, (dict, list)):
            data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        if isinstance(data, str):
            data = data.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        origin = self.headers.get("Origin")
        if origin and allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_OPTIONS(self):
        if not self._ok_origin():
            return self.send(403, {"error": "Origin not allowed"})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type,X-TASL-Options,Access-Control-Request-Private-Network")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if not self._ok_origin():
            return self.send(403, {"error": "Origin not allowed"})
        parts = urlsplit(self.path).path.strip("/").split("/")
        if parts == ["health"]:
            return self.send(200, {"name": "TASL PC Native Boost", "version": "0.1",
                                   "native": bool(executable("tsl_boost")),
                                   "ffmpeg": bool(executable("ffmpeg")),
                                   "ffprobe": bool(executable("ffprobe"))})
        if len(parts) < 2 or parts[0] != "jobs":
            return self.send(404, {"error": "Not found"})
        with LOCK:
            job = JOBS.get(parts[1])
        if not job:
            return self.send(404, {"error": "Unknown job"})
        if len(parts) == 2:
            with job.lock:
                return self.send(200, {"id": job.id, "state": job.state,
                                       "done": job.done, "total": job.total,
                                       "message": job.message, "plan": job.plan})
        if len(parts) == 3 and parts[2] == "result":
            with job.lock:
                ready = job.state == "done"
            if not ready:
                return self.send(409, {"error": "Not complete"})
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(job.output.stat().st_size))
            origin = self.headers.get("Origin")
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with job.output.open("rb") as f:
                shutil.copyfileobj(f, self.wfile, 256*1024)
            return
        return self.send(404, {"error": "Not found"})

    def do_POST(self):
        if not self._ok_origin():
            return self.send(403, {"error": "Origin not allowed"})
        path = urlsplit(self.path).path
        if path.startswith("/jobs/") and path.endswith("/cancel"):
            job_id = path.split("/")[2]
            with LOCK:
                job = JOBS.get(job_id)
            if not job:
                return self.send(404, {"error": "Unknown job"})
            with job.lock:
                job.cancel = True
                for p in job.procs:
                    if p.poll() is None:
                        p.terminate()
            return self.send(200, {"ok": True})
        if path != "/jobs":
            return self.send(404, {"error": "Not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_INPUT:
                raise ValueError("MP4/WebM must be 1 byte to 2 GiB")
            enc = self.headers.get("X-TASL-Options", "")
            if len(enc) > 4096:
                raise ValueError("Settings too large")
            options = json.loads(urlsafe_b64decode(enc + "="*((-len(enc))%4)))
            if not isinstance(options, dict):
                raise ValueError("Invalid options")
            if not all(executable(x) for x in ("tsl_boost", "ffmpeg", "ffprobe")):
                raise ValueError("Native converter, FFmpeg, or FFprobe is missing")
            with LOCK:
                if any(j.state not in ("done", "error", "cancelled") for j in JOBS.values()):
                    return self.send(409, {"error": "PCブーストの処理が実行中です"})
                jid = secrets.token_hex(12)
                source = WORK / f"{jid}.video"
                job = Job(jid, source, WORK / f"{jid}.TSL", options)
                JOBS[jid] = job
            with source.open("wb") as f:
                remaining = length
                while remaining:
                    buf = self.rfile.read(min(1024*1024, remaining))
                    if not buf:
                        raise ValueError("Video upload ended early")
                    f.write(buf)
                    remaining -= len(buf)
            thread = threading.Thread(target=run_job, args=(job,), daemon=True)
            thread.start()
            return self.send(202, {"id": jid, "state": "queued"})
        except Exception as exc:
            if 'jid' in locals():
                with LOCK:
                    JOBS.pop(jid, None)
            return self.send(400, {"error": str(exc)})

    def log_message(self, fmt, *args):
        # Never log uploaded filenames or video contents.
        print("PC Boost:", fmt % args, flush=True)


def main():
    if not all(executable(x) for x in ("tsl_boost", "ffmpeg", "ffprobe")):
        raise SystemExit("Missing tsl_boost / FFmpeg / FFprobe executable")
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("TASL PC Boost running locally at http://127.0.0.1:39083", flush=True)
    print("Open " + APP_ORIGIN + " on this PC, select 'PCブースト' and choose a video.")
    try:
        server.serve_forever(poll_interval=.25)
    except KeyboardInterrupt:
        print("\nPC Boost stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
