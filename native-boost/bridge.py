"""TASL faithful PC Boost: loopback-only local player and exact native scoring.

The video->TSL conversion always runs the original browser Mode 1/2/3/4
pipeline, INCLUDING MediaPipe and the original structural AA layout.
Only the original Mode 4 placementLoss arithmetic is offloaded to a compiled
CPU scorer, with per-frame CPU parity checking and safe fallback.

Standalone Windows EXE uses this to serve the original bundled player.
"""
import hashlib
import json
import math
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import webbrowser
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote
from base64 import urlsafe_b64decode
import mp4_native

HOST = "127.0.0.1"
PORT = int(os.getenv("TASL_BOOST_PORT", "39083"))
ROOT = (Path(sys.executable).resolve().parent if getattr(sys, "frozen", False)
        else Path(__file__).resolve().parent)
WEB_ROOT = ROOT / "app" if (ROOT / "app" / "index.html").is_file() else ROOT.parent / "dist"
DATA = Path(os.getenv("TASL_BOOST_DATA_DIR") or (
    Path(os.getenv("LOCALAPPDATA") or Path.home() / ".cache") / "TASL-Faithful-Boost"))
DATA.mkdir(parents=True, exist_ok=True)
MAX_SCORE_REQUEST = 64 * 1024 * 1024
MAX_VIDEO = 2 * 1024 ** 3
MAX_TSL = 192 * 1024 ** 2
JOBS = {}
LOCK = threading.RLock()


def executable(name):
    ext = ".exe" if os.name == "nt" else ""
    candidate = ROOT / (name + ext)
    return str(candidate) if candidate.is_file() else shutil.which(name) or ""


@dataclass
class Job:
    id: str
    source: Path
    output: Path
    options: dict
    state: str = "receiving"
    plan: dict = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)
    mp4_state: str = "not_started"
    mp4_message: str = ""
    mp4_encoder: str = ""
    mp4_done: int = 0
    mp4_total: int = 0
    mp4_width: int = 0
    mp4_height: int = 0
    mp4_cancel: bool = False
    mp4_procs: list = field(default_factory=list)


def parse_mp4_plan(header):
    if not header or len(header) > 4096:
        raise ValueError("MP4 conversion metadata missing")
    try:
        packed = urlsafe_b64decode(header + "="*((-len(header))%4))
        raw = json.loads(packed.decode("utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("MP4 metadata must be an object")
        result = {}
        for key, maximum in (
            ("width", 480), ("height", 240), ("count", 10000),
            ("ticks", 432000), ("sourceWidth", 3840),
            ("sourceHeight", 2160)):
            value = raw.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= maximum:
                raise ValueError("MP4 metadata field is invalid: " + key)
            result[key] = value
        fps = raw.get("fps")
        if not isinstance(fps, (float, int)) or not math.isfinite(fps) or not 1 <= fps <= 30:
            raise ValueError("MP4 fps is invalid")
        result["fps"] = float(fps)
        if raw.get("native16") not in (True, False):
            raise ValueError("MP4 character font setting is invalid")
        result["native16"] = raw["native16"]
        if result["width"]*result["height"] > 480*240:
            raise ValueError("MP4 character grid exceeds supported dimensions")
        if result["sourceWidth"]*result["sourceHeight"] > 3840*2160:
            raise ValueError("MP4 source resolution exceeds 4K")
        if result["count"] > result["ticks"]:
            raise ValueError("MP4 frame timing is invalid")
        return result
    except (ValueError, TypeError, UnicodeError) as exc:
        raise ValueError("MP4 job settings are invalid: " + str(exc)) from exc


class Handler(BaseHTTPRequestHandler):
    server_version = "TASL-Faithful-Boost/1.0"

    def allowed(self):
        origin = self.headers.get("Origin", "")
        host = self.headers.get("Host", "")
        return (host in (f"127.0.0.1:{PORT}", f"localhost:{PORT}")
                and origin in ("", f"http://127.0.0.1:{PORT}",
                               f"http://localhost:{PORT}"))

    def response(self, code, payload, kind="application/json"):
        if isinstance(payload, dict):
            payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_file(self, filename, kind="application/octet-stream"):
        if not filename.is_file():
            return self.response(404, {"error": "File unavailable"})
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(filename.stat().st_size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            with filename.open("rb") as fp:
                shutil.copyfileobj(fp, self.wfile, 256 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def serve_static(self):
        if not WEB_ROOT.is_dir():
            return self.response(404, {"error": "Bundled player unavailable"})
        rel = unquote(urlsplit(self.path).path).lstrip("/") or "index.html"
        try:
            filename = (WEB_ROOT / rel).resolve()
            filename.relative_to(WEB_ROOT.resolve())
        except ValueError:
            return self.response(403, {"error": "Path denied"})
        if not filename.is_file():
            return self.response(404, {"error": "Asset not found"})
        kind = mimetypes.guess_type(filename.name)[0] or "application/octet-stream"
        if filename.suffix in (".mjs", ".js"):
            kind = "text/javascript; charset=utf-8"
        if filename.suffix == ".wasm":
            kind = "application/wasm"
        if filename.suffix == ".html":
            kind = "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(filename.stat().st_size))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; "
            "worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self' blob: "
            "https://cdn.jsdelivr.net https://storage.googleapis.com; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; media-src 'self' blob:")
        self.end_headers()
        try:
            with filename.open("rb") as fp:
                shutil.copyfileobj(fp, self.wfile, 256 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.allowed():
            return self.response(403, {"error": "Origin denied"})
        route = urlsplit(self.path).path
        if route == "/health":
            return self.response(200, {
                "name": "TASL Original Algorithm PC Boost",
                "version": "1.0", "originalMode4": True,
                "nativeExact": bool(executable("mode4_score_exact")),
                "nativeMp4": bool(executable("tsl_render")),
                "ffmpeg": bool(executable("ffmpeg")),
                "ffprobe": bool(executable("ffprobe"))})
        if route.startswith("/api/mp4/jobs/"):
            parts = route.strip("/").split("/")
            if len(parts) != 5 or parts[:3] != ["api", "mp4", "jobs"]:
                return self.response(404, {"error": "Unknown MP4 operation"})
            with LOCK:
                job = JOBS.get(parts[3])
            if not job:
                return self.response(404, {"error": "Unknown MP4 job"})
            if parts[4] == "status":
                with job.lock:
                    ready = job.output.with_suffix(".mp4")
                    return self.response(200, {
                        "id": job.id, "state": job.mp4_state,
                        "message": job.mp4_message, "encoder": job.mp4_encoder,
                        "done": job.mp4_done, "total": job.mp4_total,
                        "width": job.mp4_width, "height": job.mp4_height,
                        "size": ready.stat().st_size
                        if job.mp4_state == "done" and ready.is_file() else 0})
            if parts[4] == "result":
                with job.lock:
                    done = job.mp4_state == "done"
                if not done:
                    return self.response(409, {"error": "MP4 is not complete"})
                return self.send_file(job.output.with_suffix(".mp4"), "video/mp4")
        return self.serve_static()

    def do_POST(self):
        if not self.allowed():
            return self.response(403, {"error": "Origin denied"})
        route = urlsplit(self.path).path
        if route == "/api/mode4/score":
            if self.headers.get("Content-Type", "").split(";")[0] != "application/octet-stream":
                return self.response(415, {"error": "Binary request required"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 36 <= length <= MAX_SCORE_REQUEST:
                    raise ValueError("Invalid native score payload length")
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise ValueError("Incomplete score payload")
                native = executable("mode4_score_exact")
                if not native:
                    return self.response(503, {"error": "Native exact scorer missing"})
                score = subprocess.run([native], input=payload,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       check=False, timeout=90)
                if score.returncode:
                    message = score.stderr.decode("utf-8", "replace")[-300:]
                    return self.response(422, {"error": message or "Exact scorer failed"})
                return self.response(200, score.stdout, "application/octet-stream")
            except (ValueError, subprocess.TimeoutExpired) as exc:
                return self.response(422, {"error": str(exc)})
        if route == "/api/mp4/jobs":
            try:
                plan = parse_mp4_plan(self.headers.get("X-TASL-Plan", ""))
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_VIDEO:
                    raise ValueError("MP4 source video must be 1 byte to 2 GiB")
                jid = secrets.token_hex(12)
                source = DATA / (jid + ".source")
                with source.open("wb") as out:
                    remaining = length
                    while remaining:
                        block = self.rfile.read(min(1024 * 1024, remaining))
                        if not block:
                            raise ValueError("MP4 source transfer ended early")
                        out.write(block)
                        remaining -= len(block)
                job = Job(id=jid, source=source, output=DATA/(jid+".TSL"),
                          options={"fps": plan["fps"]}, plan=plan,
                          state="waiting_tsl")
                with LOCK:
                    JOBS[jid] = job
                return self.response(202, {"id": jid})
            except (ValueError, OSError) as exc:
                if "source" in locals():
                    source.unlink(missing_ok=True)  # Our own incomplete transfer.
                return self.response(400, {"error": str(exc)})
        if route.startswith("/api/mp4/jobs/"):
            parts = route.strip("/").split("/")
            if len(parts) != 5 or parts[:3] != ["api", "mp4", "jobs"]:
                return self.response(404, {"error": "Unknown MP4 operation"})
            with LOCK:
                job = JOBS.get(parts[3])
            if not job:
                return self.response(404, {"error": "Unknown MP4 job"})
            if parts[4] == "tsl":
                with job.lock:
                    if job.state != "waiting_tsl":
                        return self.response(409, {"error": "TSL already submitted"})
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 128 < length <= MAX_TSL:
                        raise ValueError("TSL exceeds output size limit")
                    temporary = job.output.with_suffix(".upload")
                    with temporary.open("wb") as out:
                        remaining = length
                        while remaining:
                            block = self.rfile.read(min(1024 * 1024, remaining))
                            if not block:
                                raise ValueError("TSL upload ended early")
                            out.write(block)
                            remaining -= len(block)
                    with temporary.open("rb") as check:
                        head = check.read(1024)
                        expected = ("1.08\r\n" + str(job.plan["count"]) + "\r\n" +
                                    str(job.plan["width"]) + "\r\n" +
                                    str(job.plan["height"]) + "\r\n").encode("ascii")
                        if not head.startswith(expected):
                            raise ValueError("TSL header does not match original plan")
                        if job.plan["native16"] and b"# PC98_FONT_16X16" not in head:
                            raise ValueError("Original PC-98 font flag missing")
                        check.seek(-1, os.SEEK_END)
                        if check.read(1) != b"\x1a":
                            raise ValueError("Original TSL file is incomplete")
                    temporary.replace(job.output)
                    with job.lock:
                        job.state = "done"
                    return self.response(200, {"state": "done"})
                except (ValueError, OSError) as exc:
                    return self.response(422, {"error": str(exc)})
            if parts[4] == "start":
                with job.lock:
                    if job.state != "done" or not job.output.is_file():
                        return self.response(409, {"error": "Original TSL not yet saved"})
                    if job.mp4_state in ("queued", "preparing", "encoding"):
                        return self.response(202, {"state": job.mp4_state})
                    if job.mp4_state == "done" and job.output.with_suffix(".mp4").is_file():
                        return self.response(200, {"state": "done"})
                    job.mp4_cancel = False
                    job.mp4_state = "queued"
                threading.Thread(target=mp4_native.run_mp4,
                                 args=(job, executable), daemon=True).start()
                return self.response(202, {"state": "queued"})
            if parts[4] == "cancel":
                with job.lock:
                    job.mp4_cancel = True
                    for proc in job.mp4_procs:
                        if proc.poll() is None:
                            proc.terminate()
                return self.response(200, {"ok": True})
        return self.response(404, {"error": "Unknown operation"})

    def log_message(self, fmt, *args):
        print("TASL faithful:", fmt % args, flush=True)


def main():
    ThreadingHTTPServer.allow_reuse_address = True
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as exc:
        raise SystemExit("Port 39083 in use. Close the other TASL PC Boost first.") from exc
    url = f"http://{HOST}:{PORT}/"
    print("TASL Original Algorithm Boost: " + url, flush=True)
    if os.getenv("TASL_NO_BROWSER") != "1" and WEB_ROOT.joinpath("index.html").exists():
        threading.Timer(.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(.25)
    except KeyboardInterrupt:
        print("Stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
