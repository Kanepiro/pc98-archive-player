"""Exercise interruption, durable partial frames, and exact-length native resume."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time

spec = importlib.util.spec_from_file_location("boost_bridge", Path(__file__).with_name("bridge.py"))
b = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = b
spec.loader.exec_module(b)

with tempfile.TemporaryDirectory(prefix="tasl-resume-test-") as d:
    directory = Path(d)
    movie = directory / "movie.mp4"
    output = directory / "result.TSL"
    subprocess.run([b.executable("ffmpeg"), "-v", "error", "-f", "lavfi",
                    "-i", "testsrc2=size=1920x1080:rate=24",
                    "-t", "8", "-pix_fmt", "yuv420p", "-c:v", "mpeg4",
                    "-q:v", "16", "-y", str(movie)],
                   check=True, timeout=90)
    opts = dict(mode="artisan", sourceGrid=True, width=240, height=67,
                fps=24, native16=True, brightness=0, contrast=1,
                gamma=1, edge=.6, fit="contain")
    job = b.Job("interrupt", movie, output, opts)
    worker = threading.Thread(target=b.run_job, args=(job,))
    worker.start()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        with job.lock:
            done = job.done
            state = job.state
        if done >= 32 or state in ("error", "done"):
            break
        time.sleep(.015)
    assert done >= 32, (done, state, job.message)
    with job.lock:
        job.cancel = True
        for p in job.procs:
            if p.poll() is None:
                p.terminate()
    worker.join(timeout=15)
    assert not worker.is_alive()
    assert job.state == "cancelled", (job.state, job.message)
    partial = output.with_suffix(".partial")
    assert partial.exists(), "Partial TSL must survive cancellation"
    saved = b.recover_partial(partial, b.make_plan(opts, 1920, 1080, 8))
    print("Interrupted after", saved, "complete TSL frames")
    assert 16 <= saved < 192, saved
    restarted = b.Job("resumed", movie, output, opts)
    t = time.monotonic()
    b.run_job(restarted)
    print("Resumed", restarted.state, restarted.message,
          restarted.done, restarted.total, "elapsed", round(time.monotonic()-t, 2))
    assert restarted.state == "done", restarted.message
    assert restarted.total == restarted.done == 192
    assert not partial.exists(), "Partial file should atomically become complete TSL"
    data = output.read_bytes()
    assert data.endswith(b"\x1a")
    assert data.count(b"\x0c\r\n") == 194, "Exactly 2 headers + 192 frames"
    assert output.stat().st_size < b.LIMIT
    # Cache hit must not reconvert or change the output.
    cached = b.Job("cache", movie, output, opts)
    b.run_job(cached)
    assert cached.state == "done"
    assert cached.done == 192
    assert cached.message == "保存済みの完成TSLを復元しました"
    print("PASS: stop -> resume -> full TSL -> cache reuse")
