# TASL platform split v0.3.39 — 2026-11-14

## Sources and preservation

- Web baseline: main f1894fa85c6c58faf57beaba7847f020ebcbb804 (v0.3.37).
- Windows baseline: work/fullgpu-20261114 c05cdd68d3aff553d42155d05b849df721265b7e (v0.3.38).
- Existing PC boost Draft PRs #6 and #7 reviewed. The simplified older #6 path was not adopted.
- Windows changes are in work/platform-windows-20261114; the fullgpu development branch is preserved.
- Web computation modules and the literal 272-character palette are unchanged from the Web baseline. Native GPU computation sources, model conversion, and the palette are unchanged from the fullgpu baseline.

## Entries and distribution

- Windows: https://pc98-archive-player-seven.vercel.app/windows/
- Android / iOS browser app: https://pc98-archive-player-seven.vercel.app/mobile/
- One existing Vercel project, two static entries. No new conversion server.
- Versioned Windows assets: https://github.com/Kanepiro/pc98-archive-player/releases/tag/windows-v0.3.39
- GitHub Actions artifacts are build inputs only, never the official download link.
- Windows archive is also saved separately under Google Drive PC9821Ap2/TASL without replacing previous files.

## Verified Web checks

- npm test: 66/66 passed; npm run build passed.
- Linux Chrome at 390x844: correct independent entry pages, 4 modes, visible versions, no mobile native-bridge requests, 272-character palette.
- PWA start URL /mobile/; offline navigation between both entries retains the correct page.
- Real MP4 fixture to TSL conversion: all four modes completed, 10 frames each. SwiftShader was correctly rejected as a physical GPU and CPU fallback was displayed.
- TSL to MP4: H.264 at 1080x1920 and 948x648; simulated encoder failure recovered at 720x1280.
- These are desktop browser / software-adapter checks, not Android or iOS hardware verification.

## Windows scope

- v0.3.39 always uses the native backend on loopback regardless of port. WebGPU conversion selection is removed.
- Mode 4 preserves DirectCompute contour, glyph matching, whole-layout optimization, DirectML recognition, GPU raster and NVENC-first direct MP4 output from v0.3.38.
- Modes 1–3 currently use CPU conversion because equivalent native GPU kernels are not implemented. This limitation is visible in the page and runtime diagnostics.
- The release pipeline must pass Windows builds, all-mode isolation with WebGPU disabled, independent original-critic comparison, video/MP4 regression, and packaged executable smoke tests before publishing a prerelease.

## Unverified

GTX 1050 Ti hardware; physical DirectML execution/provider allocation; NVENC hardware performance; Windows 10/11 end-user machine compatibility; Android/iOS device/browser performance; subjective recognition of people/actions across real footage. No hardware speedup is claimed. WARP / SwiftShader measurements are not hardware measurements. The Windows package remains explicitly marked as a prerelease until hardware checks are completed.

## Final publication and additional results

- Windows run https://github.com/Kanepiro/pc98-archive-player/actions/runs/43571770714: models, Windows regression, package smoke and release publication all succeeded.
- Windows release commit: f30957af2a451df31701033910a9dba77346c22a.
- Mode 4 WebGPU shader execution passed on SwiftShader for 8x6, 32x9 and 80x25 grids; this is software shader validation, not physical GPU performance.
- Mode 4 native CPU fallback passed with DirectCompute unavailable on Linux, reporting PC Native Exact. All four modes completed with WebGPU disabled.
- TSL playback rendered both frames and ended normally at the mobile entry.
- Both production URLs returned HTTP 200 with the correct v0.3.39 identities. Production browser tests passed for independent entries, responsive UI, offline separation and the 272-character palette.
- ZIP integrity and released SHA-256 verified after downloading the public GitHub release.
- ZIP size: 182081928 bytes. SHA-256: 060021aa467a957b2c67d61e7a4e1054735f160b79b35b1d3924169c60a59e9c.
- Google Drive: https://drive.google.com/file/d/1Tc53n6njhJoRGhLfrkL0JB7LZMz_2t-x/view
- Drive parent: PC9821Ap2/TASL (1ohqx44bfGLelUr8WIfjFnp6nDb2C-oXa). Remote SHA-256 matched the public release; upload used immutable create semantics.
- Original fullgpu branch remains at c05cdd68d3aff553d42155d05b849df721265b7e. No prior archive was replaced.
