"""Compatibility alias for the public release build workflow."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("package-public-release.py")),run_name="__main__")
