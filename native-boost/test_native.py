"""Smoke checks for the standalone C++/FFmpeg conversion path."""
import importlib.util
import pathlib
import subprocess
import sys
import tempfile

spec = importlib.util.spec_from_file_location("boost_bridge", pathlib.Path(__file__).with_name("bridge.py"))
b = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = b
spec.loader.exec_module(b)

def run():
    assert b.allowed_origin("https://pc98-archive-player-seven.vercel.app")
    assert b.allowed_origin("http://localhost:4173")
    assert not b.allowed_origin("https://evil.example.com")
    assert not b.allowed_origin("http://127.0.0.1.evil.example.com:4173")
    with tempfile.TemporaryDirectory(prefix="pc_boost_test_") as temp:
        root = pathlib.Path(temp)
        movie = root / "test.mp4"
        subprocess.run([
            b.executable("ffmpeg"), "-v", "error", "-f", "lavfi",
            "-i", "testsrc2=size=320x240:rate=15",
            "-t", "1", "-pix_fmt", "yuv420p",
            "-c:v", "mpeg4", "-y", str(movie),
        ], check=True, timeout=60)
        for mode in ("legacy", "halftone", "quality", "artisan"):
            path = root / (mode + ".TSL")
            job = b.Job(mode, movie, path, dict(
                width=41, height=15, fps=10, mode=mode,
                sourceGrid=False, native16=True, fit="cover"))
            b.run_job(job)
            assert job.state == "done", (mode, job.message)
            assert job.done == job.total == 10, (mode, job.done)
            data = path.read_bytes()
            assert data.startswith(b"1.08\r\n10\r\n41\r\n15\r\n"), mode
            assert data.endswith(b"\x1a"), mode
            decoded = data.decode("cp932")
            assert "# PC98_FONT_16X16" in decoded
            lines = decoded.split("\f\r\n", 2)[2].split("\f\r\n")[0].split("\r\n")
            assert len(lines) >= 15, mode
            for line in lines[:15]:
                cols = sum(1 if ord(c) < 127 or 0xff61 <= ord(c) <= 0xff9f else 2 for c in line)
                assert cols == 41, (mode, cols)
            print(mode, "OK", len(data), "bytes")
    print("PC Boost native conversion checks passed.")

if __name__ == "__main__":
    run()
