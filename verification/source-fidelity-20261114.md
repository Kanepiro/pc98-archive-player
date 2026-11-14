# Mode 4 source fidelity correction — 2026-11-14

Windows native v0.3.41 / Mobile WebGPU v0.3.40.

## Problem and correction

Face detections previously triggered an automatic crop/zoom, erased contours outside the main face ellipse, and replaced observed face pixels with a generic landmark-based face illustration. A scene could consequently lose other people, body motion, and background structure. This did not establish that a different input file had been used.

Recognition now affects the importance of observed contours without changing the selected framing or inventing a face. The 272-character palette, contour graph, glyph matching, temporal state, and whole-frame composition remain. Windows DirectCompute receives the equivalent topology correction. All Windows modes retain native GPU paths; the mobile implementation does not import the Windows bridge.

Mode 4 checkpoint version is now 21, so prior transformed frames cannot be resumed as corrected output. Historical completed TSL/MP4 files need reconversion from their source.

## Validation completed

- 67 unit tests passed in each source line, including unchanged framing, no invented portrait on blank pixels, preservation of body/background contours, palette and composition tests.
- Windows CI run [43578503718](https://github.com/Kanepiro/pc98-archive-player/actions/runs/43578503718): native build, source-fidelity integration, modes 1–4, forced CPU fallback, independent Mode 4 composition critic, native MP4 pipeline, packaged EXE.
- Native source-fidelity test: outside-face contour output agrees with the reference in the synthetic fixture (maximum field error 0); captured video draw rectangles remain at the selected fit rectangle despite a small face detection.
- Windows execution tests use the explicit WARP software adapter with browser WebGPU disabled. These are shader correctness tests, not physical GPU performance measurements.
- Linux Chrome mobile-size emulation: dedicated Windows/mobile pages, version text, 272 palette, offline page separation, absence of native bridge requests.
- Linux Chrome synthetic video-to-TSL tests: all four modes completed; software WebGPU adapter was correctly rejected and CPU fallback reported.
- TSL-to-MP4 tests: H.264 at 1080×1920 and 948×648, plus simulated Full-HD failure with successful 720×1280 fallback.

GTX 1050 Ti, hardware DirectML/NVENC, Android and iOS physical-device performance remain unverified. No all-device test requirement is imposed.

## Releases

- Windows: https://pc98-archive-player-seven.vercel.app/windows/
- Mobile: https://pc98-archive-player-seven.vercel.app/mobile/
- Native release: https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.41
- ZIP SHA-256: ec643e22d44f6668270e11f7c6dc728a0ad9a6da3354239a0753be4ccd2875e2

User footage and diagnostic frames are not included in this repository.
