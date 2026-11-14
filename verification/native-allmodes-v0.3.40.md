# Windows native v0.3.40 — all-mode DirectCompute correction

v0.3.39 incorrectly left modes 1–3 on CPU. v0.3.40 adds Windows native DirectCompute implementations while retaining the original CPU converters for unsupported hardware or execution failures.

## Implementation

- Modes 1/2: RGBA sampling, alpha-aware luminance, calibrated 16-level ramp or five round glyphs, tone settings, contour assistance and ordered dithering.
- Mode 3: color normalization, Gaussian filters, connected contour extraction, XDoG target, scene-change and temporal analysis, glyph-mask scoring and variable-width row layout.
- Native shader calculations run through D3D11 compute; browser WebGPU is not selected. CPU work includes transport, string assembly, glyph-atlas preparation, validation and file handling.
- GPU and CPU strings do not have to match. No per-frame CPU shadow conversion or equality gate was introduced.
- Mode 4's native layout, contour, DirectML model handling, native raster/NVENC code and 272-character palette remain unchanged from the existing full-GPU work.
- The mode 3 one-pixel gap rule uses a parallel snapshot pass rather than the CPU scan order; independent contour/template quality is tested.
- Native work is isolated on work/native-allmodes-20261114. Original work/fullgpu-20261114 remains at c05cdd68d3aff553d42155d05b849df721265b7e.
- Mobile remains the independent WebGPU v0.3.39 release.

## Checks

- 66 existing unit tests passed; native application web assets built successfully.
- Linux Chrome with WebGPU disabled: all four modes completed using CPU fallback with reasons reported.
- Windows shader build: all 15 new DirectCompute entry points compiled.
- Windows CI with explicit WARP software adapter and browser WebGPU disabled: mode 1/2 polarity, tone/settings and odd-column behavior; mode 3 contour/template loss, flat-color blanking, moving outlines, checkpoint restoration; forced native-request failures falling back to CPU.
- New modes 1–3 suite: 28 quality/settings cases passed, plus checkpoint and forced-failure checks. The moving person-outline fixture retained contour-mask IoU 0.973882; independent glyph loss was 0.046969 versus original CPU 0.046308 for the first frame. Flat black, white and pink frames produced no contour glyphs. These are synthetic fixture metrics, not real-footage recognition scores.
- Quality comparisons use the original JavaScript implementations and independently recomputed errors; complete output-string equality with CPU is not required.
- Local browser entry tests: correct distinct Windows/mobile identities, 272-character palette, 390×844 layout, offline entry separation, no native-bridge requests from mobile.
- Mode 4 regression: independent original critic passed including the 240×67 grid, with unchanged palette. The same 2-second source produced valid 10-frame MP4s for old/new pipelines; new rendering used DirectCompute on WARP and encoding used libx264 CPU. Native recognition preprocessing, NMS and raster comparisons passed.
- Packaged Windows EXE smoke test passed with bundled native modes executable and ONNX models. All workflow jobs (models, Windows regression, package and publish) succeeded.
- Native release commit: 069e023230147799afc504b0a22ee11f68a06875.
- Workflow: https://github.com/Kanepiro/pc98-archive-player/actions/runs/43575256353

## Scope

WARP is software execution of the native D3D11 shaders, not evidence of physical GPU speed. GTX 1050 Ti hardware, physical DirectML/NVENC execution and all-device compatibility are unverified. Testing every hardware model is not a completion requirement.

## Distribution

- Windows: https://pc98-archive-player-seven.vercel.app/windows/
- Mobile: https://pc98-archive-player-seven.vercel.app/mobile/
- Versioned native package: https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.40
- The existing Vercel project provides both entries. Conversion stays local.

## Saved archive verification

- ZIP: TASL-PC-Boost-v0.3.40-NativeGPU-Windows-x64.zip (182263523 bytes).
- SHA-256: 3c2ace60044a64d0055cbd3319fee0c8b0d6d36f35c41fe3c503d79ba68c4e88.
- Public release digest, downloaded ZIP and Google Drive digest matched. ZIP integrity and all 652 manifest file hashes passed.
- Packaged health record identifies v0.3.40 and native modes support under explicit WARP testing.
- Google Drive: https://drive.google.com/file/d/1LDSkhADkhLON0gKI-EDp8LRveSS-eIT0/view
- Parent: PC9821Ap2/TASL (1ohqx44bfGLelUr8WIfjFnp6nDb2C-oXa). New immutable upload; older files were preserved.
