"""Actual GPU video output for the standalone Windows PC Boost player.

FFmpeg and codec quality settings are preserved from public v0.3.44.
A native Win32 renderer streams CP932 glyph frames to FFmpeg. Hardware NVENC is
selected only after a real one-frame encoding probe, with libx264 failover.
"""
import json
import math
from pathlib import Path
import re
import subprocess
import time
import threading
from gpu_metrics import RunMetrics
from portable_pipe import large_pipe

_probe_cache={}
_probe_lock=threading.Lock()
def cached_probe(kind,path,probe):
    try:
        stat=Path(path).stat();key=(kind,str(Path(path).resolve()),stat.st_size,stat.st_mtime_ns)
    except OSError:return probe()
    with _probe_lock:
        if key in _probe_cache:return _probe_cache[key]
        result=probe()
        if result[0]:_probe_cache[key]=result
        return result

def raster_probe(path):
    try:
        p=subprocess.run([path,"--probe"],capture_output=True,timeout=15,creationflags=subprocess.CREATE_NO_WINDOW)
        return p.returncode==0 and p.stdout.startswith(b"DIRECTCOMPUTE_RASTER "),p.stderr.decode("utf-8","replace")[-400:]
    except (OSError,subprocess.TimeoutExpired) as e:return False,str(e)

def metadata(tsl):
    with tsl.open("rb") as f:
        head = f.read(8192).split(b"\x0c\r\n", 1)[0]
    lines = head.decode("ascii", errors="replace").splitlines()
    if len(lines) < 4 or lines[0] != "1.08":
        raise ValueError("TSL header invalid")
    width, height = int(lines[2]), int(lines[3])
    native16 = "# PC98_FONT_16X16" in lines
    if not 1 <= width <= 480 or not 1 <= height <= 240:
        raise ValueError("TSL grid out of range")
    grid120 = "# TASL_MODE4_CELL120" in lines
    gridcell = next((cell for cell in (30,40,60) if "# TASL_MODE4_CELL"+str(cell) in lines),0)
    return width * (gridcell//2 if gridcell else 60 if grid120 else 8 if native16 else 12), height * (gridcell if gridcell else 120 if grid120 else 16 if native16 else 24)


def nvenc_probe(ffmpeg):
    """'-encoders' is not enough: a current 9.x build can reject Pascal drivers."""
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
           "-f", "lavfi", "-i", "color=c=black:s=128x128:r=1:d=1",
           "-frames:v", "1", "-an", "-c:v", "h264_nvenc",
           "-preset", "p4", "-f", "null", "-"]
    try:
        p = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                           timeout=12, check=False, creationflags=subprocess.CREATE_NO_WINDOW)
        return p.returncode == 0, p.stderr.decode("utf-8", "replace")[-400:]
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)[-400:]


def _log(job, state=None, message=None, encoder=None, done=None):
    with job.lock:
        if state is not None:
            job.mp4_state = state
        if message is not None:
            job.mp4_message = message
        if encoder is not None:
            job.mp4_encoder = encoder
        if done is not None:
            job.mp4_done = done


def _encode(job, executable, fps, native_width, native_height,
            out_width, out_height, gpu, target, gpu_raster=False):
    """Piped C++ Win32 GDI -> FFmpeg NVENC or CPU; no intermediate PNG images."""
    renderer_bin = executable("tsl_render_gpu" if gpu_raster else "tsl_render")
    if not renderer_bin:
        raise RuntimeError("Windows TSL renderer executable is missing")
    ffmpeg = executable("ffmpeg")
    vf = (f"scale={out_width}:{out_height}:flags=neighbor:"
          f"force_original_aspect_ratio=decrease,"
          f"pad={out_width}:{out_height}:(ow-iw)/2:(oh-ih)/2:"
          f"color=0x080d12,format=yuv420p")
    encoder_opts = (["-c:v", "h264_nvenc", "-preset", "p4",
                     "-rc", "vbr", "-cq", "21", "-b:v", "0"]
                    if gpu else
                    ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21"])
    codec = "NVIDIA NVENC (GPU)" if gpu else "libx264 (CPU)"
    _log(job, state="encoding", message=f"MP4変換中 · {codec} · " + ("描画・拡大縮小・色変換 DirectCompute" if gpu_raster else "描画 GDI CPU"), encoder=codec, done=0)
    frame_size = f"{out_width}x{out_height}" if gpu_raster else f"{native_width}x{native_height}"
    pixel_format = "nv12" if gpu_raster else "bgr0"
    audio_opts=["-c:a","aac","-b:a","192k"]
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pixel_format", pixel_format,
           "-video_size", frame_size, "-framerate", str(fps),
           "-i", "pipe:0",
           "-i", str(job.source),
           "-map", "0:v:0", "-map", "1:a:0?",
           *(["-vf", vf] if not gpu_raster else []), *encoder_opts, "-pix_fmt", "nv12" if gpu_raster else "yuv420p",
           *audio_opts,
           "-movflags", "+faststart",
           "-stats_period", "0.5", "-progress", "pipe:2",
           "-y", str(target)]
    render_log = job.output.with_suffix(".render.log")
    renderer = encoder = None
    pipe_read = pipe_write = None
    attempt_started=time.perf_counter()
    last_lines = []
    try:
        with render_log.open("wb") as log:
            pipe_read, pipe_write = large_pipe()
            renderer = subprocess.Popen(
                [renderer_bin, "--input", str(job.output), "--fps", str(fps)]+(["--output-width",str(out_width),"--output-height",str(out_height),"--nv12","1"] if gpu_raster else []),
                stdin=subprocess.DEVNULL, stdout=pipe_write, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW)
            encoder = subprocess.Popen(cmd, stdin=pipe_read,
                                       stdout=subprocess.DEVNULL,
                                       stderr=subprocess.PIPE, bufsize=65536, creationflags=subprocess.CREATE_NO_WINDOW)
            pipe_write.close(); pipe_write = None
            pipe_read.close(); pipe_read = None
            with job.lock:
                job.mp4_procs = [encoder, renderer]
                cancelled = job.mp4_cancel
            if cancelled:
                encoder.terminate()
                renderer.terminate()
            for raw in encoder.stderr:
                line = raw.decode("utf-8", "replace").strip()
                if len(last_lines) > 20:
                    last_lines.pop(0)
                if line:
                    last_lines.append(line)
                match = re.match(r"^frame=\s*(\d+)$", line)
                if match:
                    _log(job, done=min(job.mp4_total, int(match.group(1))))
            encoder_rc = encoder.wait()
            renderer_rc = renderer.wait()
        with job.lock:
            if job.mp4_cancel:
                return False, "キャンセルしました"
        if encoder_rc != 0 or renderer_rc != 0:
            return False, "; ".join(last_lines[-5:])[:800] or (
                f"renderer={renderer_rc}, encoder={encoder_rc}")
        if not target.is_file() or target.stat().st_size < 1024:
            return False, "MP4ファイルの作成に失敗しました"
        return True, ""
    finally:
        for stream in (pipe_read, pipe_write):
            if stream: stream.close()
        for proc in (encoder, renderer):
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
        with job.lock:
            job.mp4_procs = []
            if not hasattr(job,"mp4_attempts"):job.mp4_attempts=[]
            job.mp4_attempts.append({"wallSeconds":time.perf_counter()-attempt_started,
                "encoder":codec,"raster":"DirectCompute NV12" if gpu_raster else "GDI CPU",
                "encoderExit":encoder.returncode if encoder else None,"rendererExit":renderer.returncode if renderer else None,
                "renderLog":render_log.read_text(encoding="utf-8",errors="replace")[-2000:] if render_log.exists() else ""})


def run_mp4(job, executable):
    started=time.perf_counter()
    try:
        metrics=RunMetrics(job.output.parent)
        measurement=metrics.start()
    except Exception:
        metrics=None
    try:
        with job.lock:
            job.mp4_state = "preparing"
            job.mp4_message = "TSL字形とGPUエンコーダーを確認中"
            job.mp4_done = 0
        if not job.output.is_file() or not job.source.is_file():
            raise RuntimeError("TSLか元動画が不足しています。元動画を再選択してください")
        native_width, native_height = metadata(job.output)
        # Match original video's shape; PC-98 1920x1072 is padded to 1920x1080.
        out_width = max(2, int(job.plan["sourceWidth"]) // 2 * 2)
        out_height = max(2, int(job.plan["sourceHeight"]) // 2 * 2)
        with job.output.open("rb") as stream:
            header = stream.read(8192)
        grid120 = any(tag in header for tag in [b"# TASL_MODE4_CELL120",b"# TASL_MODE4_CELL60",b"# TASL_MODE4_CELL40",b"# TASL_MODE4_CELL30"])
        if grid120:
            out_width, out_height = native_width, native_height
        if "outputWidth" in job.plan:
            out_width, out_height = job.plan["outputWidth"], job.plan["outputHeight"]
        fps = max(1 if grid120 else 5, min(30, round(float(job.options.get("fps", 24)))))
        timing = re.search(rb"# TASL_MODE4_TIMING\s+([0-9.]+)\s+([0-9.]+)", header)
        total_frames = math.ceil(float(timing.group(2)) * fps) if grid120 and timing else math.ceil(int(job.plan["ticks"]) * fps / 60)
        if not grid120 and int(job.plan["count"])==total_frames+1:total_frames=int(job.plan["count"])
        with job.lock:
            job.mp4_total = total_frames
            job.mp4_width, job.mp4_height = out_width, out_height
        mp4 = job.output.with_suffix(".mp4")
        if mp4.exists() and mp4.stat().st_size > 1024:
            _log(job, state="done", encoder="キャッシュ済み", message="完成済みMP4を再利用",
                 done=job.mp4_total)
            return
        probe_started=time.perf_counter()
        gpu_ok, gpu_detail = cached_probe("nvenc",executable("ffmpeg"),lambda:nvenc_probe(executable("ffmpeg")))
        job.mp4_preparation={"nvencProbeSeconds":time.perf_counter()-probe_started}
        probe_started=time.perf_counter()
        raster_ok = False
        if executable("tsl_render_gpu"):
            raster_ok,_ = cached_probe("raster",executable("tsl_render_gpu"),lambda:raster_probe(executable("tsl_render_gpu")))
        job.mp4_preparation["rasterProbeSeconds"]=time.perf_counter()-probe_started
        if not gpu_ok:
            _log(job, message="NVENCが使用できないためCPUエンコードに切替")
        gpu_target = job.output.with_suffix(".gpu.tmp.mp4")
        cpu_target = job.output.with_suffix(".cpu.tmp.mp4")
        if gpu_ok:
            success, reason = _encode(job, executable, fps, native_width,
                                      native_height, out_width, out_height,
                                      True, gpu_target, raster_ok)
            if not success and raster_ok and not job.mp4_cancel:
                # A renderer failure does not justify disabling a working NVENC device.
                success, reason = _encode(job, executable, fps, native_width,
                    native_height, out_width, out_height, True, gpu_target, False)
            if success:
                gpu_target.replace(mp4)
                _log(job, state="done", message="GPU NVENCによるMP4書き出し完了",
                     encoder="NVIDIA NVENC (GPU)", done=job.mp4_total)
                return
            if job.mp4_cancel:
                _log(job, state="cancelled", message="MP4生成を中断しました")
                return
            _log(job, message="GPU書き出しに失敗。CPUへ自動切替: " + reason[:150])
        success, reason = _encode(job, executable, fps, native_width,
                                  native_height, out_width, out_height,
                                  False, cpu_target, raster_ok)
        if not success and raster_ok and not job.mp4_cancel:
            success, reason = _encode(job, executable, fps, native_width,
                native_height, out_width, out_height, False, cpu_target, False)
        if success:
            cpu_target.replace(mp4)
            _log(job, state="done", message="CPUでMP4書き出し完了",
                 encoder="libx264 (CPU)", done=job.mp4_total)
        elif job.mp4_cancel:
            _log(job, state="cancelled", message="MP4生成を中断しました")
        else:
            _log(job, state="error", message=reason[:800])
    except Exception as exc:
        _log(job, state="cancelled" if job.mp4_cancel else "error",
             message=str(exc)[:800])
    finally:
        try:
            if metrics is not None:
                report=metrics.finish(measurement,{"appVersion":"0.3.48","stage":"MP4","status":job.mp4_state,
                "totalMp4Seconds":time.perf_counter()-started,"encoder":job.mp4_encoder,"message":job.mp4_message,
                "attempts":getattr(job,"mp4_attempts",[]),"preparation":getattr(job,"mp4_preparation",{}),"plan":job.plan})
                job.output.with_suffix(".mp4-report.json").write_bytes(report.read_bytes())
        except Exception:
            pass
        with job.lock:
            discard_source = job.mp4_state in ("done","cancelled")
        for suffix in (".gpu.tmp.mp4", ".cpu.tmp.mp4"):
            try:
                job.output.with_suffix(suffix).unlink(missing_ok=True)
            except OSError:
                pass
        if discard_source:
            discard_job_source(job)
        with job.lock:
            job.report_finished = True
            job.mp4_active = False


def discard_job_source(job):
    if (job.source == job.output.with_suffix(".source") and
            re.fullmatch(r"[0-9a-f]{24}", job.id) and job.source.stem == job.id):
        try:
            job.source.unlink(missing_ok=True)
        except OSError:
            pass
