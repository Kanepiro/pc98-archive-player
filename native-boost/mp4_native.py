"""Actual GPU video output for the standalone Windows PC Boost player.

FFmpeg 8.1.2 is pinned for Pascal (GTX 1050 Ti) NVENC API 13.0 support.
A native Win32 renderer streams CP932 glyph frames to FFmpeg. Hardware NVENC is
selected only after a real one-frame encoding probe, with libx264 failover.
"""
import json
import math
from pathlib import Path
import re
import subprocess

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
    return width * (8 if native16 else 12), height * (16 if native16 else 24)


def nvenc_probe(ffmpeg):
    """'-encoders' is not enough: a current 9.x build can reject Pascal drivers."""
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
           "-f", "lavfi", "-i", "color=c=black:s=128x128:r=1:d=1",
           "-frames:v", "1", "-an", "-c:v", "h264_nvenc",
           "-preset", "p4", "-f", "null", "-"]
    try:
        p = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                           timeout=12, check=False)
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
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pixel_format", pixel_format,
           "-video_size", frame_size, "-framerate", str(fps),
           "-i", "pipe:0",
           "-i", str(job.source),
           "-map", "0:v:0", "-map", "1:a:0?",
           *(["-vf", vf] if not gpu_raster else []), *encoder_opts, "-pix_fmt", "nv12" if gpu_raster else "yuv420p",
           "-c:a", "aac", "-b:a", "192k",
           "-movflags", "+faststart", "-shortest",
           "-stats_period", "0.5", "-progress", "pipe:2",
           "-y", str(target)]
    render_log = job.output.with_suffix(".render.log")
    renderer = encoder = None
    last_lines = []
    try:
        with render_log.open("wb") as log:
            renderer = subprocess.Popen(
                [renderer_bin, "--input", str(job.output), "--fps", str(fps)]+(["--output-width",str(out_width),"--output-height",str(out_height),"--nv12","1"] if gpu_raster else []),
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=log,
                bufsize=1024 * 1024)
            encoder = subprocess.Popen(cmd, stdin=renderer.stdout,
                                       stdout=subprocess.DEVNULL,
                                       stderr=subprocess.PIPE, bufsize=65536)
            renderer.stdout.close()
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
        for proc in (encoder, renderer):
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
        with job.lock:
            job.mp4_procs = []


def run_mp4(job, executable):
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
        fps = max(5, min(30, round(float(job.options.get("fps", 24)))))
        with job.lock:
            job.mp4_total = math.ceil(int(job.plan["ticks"]) * fps / 60)
            job.mp4_width, job.mp4_height = out_width, out_height
        mp4 = job.output.with_suffix(".mp4")
        if mp4.exists() and mp4.stat().st_size > 1024:
            _log(job, state="done", encoder="キャッシュ済み", message="完成済みMP4を再利用",
                 done=job.mp4_total)
            return
        gpu_ok, gpu_detail = nvenc_probe(executable("ffmpeg"))
        raster_ok = False
        if executable("tsl_render_gpu"):
            try:
                probe = subprocess.run([executable("tsl_render_gpu"), "--probe"], capture_output=True, timeout=15)
                raster_ok = probe.returncode == 0 and probe.stdout.startswith(b"DIRECTCOMPUTE_RASTER ")
            except (OSError, subprocess.TimeoutExpired):
                pass
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
        with job.lock:
            finished = job.mp4_state == "done"
        # Do not delete user-provided files, only our own hashed temp video.
        if finished and (job.source.parent.resolve() == job.output.parent.resolve()
                         and re.fullmatch(r"[0-9a-f]{64}", job.source.stem)
                         and job.source.suffix == ".video"):
            try:
                job.source.unlink(missing_ok=True)
            except OSError:
                pass
