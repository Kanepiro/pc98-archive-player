# Mode 4 60px contour AA — v0.3.44-rc.2

This is an isolated validation candidate. Visual acceptance is not complete; do not replace the published working release.

## Rendering contract

- Fixed 60×60 source and display cells. Columns/rows are ceil(source dimension / 60); extra pixels are centered padding, without cropping.
- A cell contains one of the original 170 CP932 palette characters, or the two-byte full-width space 0x81 0x40.
- The original palette bytes are preserved without Unicode normalization.
- Matching, browser preview, TSL playback and native/browser MP4 use the same bundled Noto Sans Mono CJK JP Regular raster masks.
- Font rasterization is nominal 60px. Four glyphs (├ ┤ ┼ β) have 62px ink extent and use a uniform 60/62 fit to stay inside the cell. Other glyphs retain their raster size.
- New TSL files carry TASL_MODE4_CELL60. The existing 120px and legacy TSL renderers remain available.

## Pipeline and acceptance

1. Grayscale and the existing contrast/brightness/gamma settings.
2. Separable Gaussian blur, sigma 8 source pixels, radius ceil(3 sigma).
3. Half-resolution area sampling; central gradient, four-direction non-maximum suppression; hysteresis high 0.025 / low 0.0125; connected components shorter than 12 half-resolution pixels are removed.
4. Label connected contours across the frame. Within each 60px cell keep the strongest connected local stroke, ranked by local pixel count × (1 + 0.25 × log(1 + global connected contour length)). This removes secondary local strokes without adding pixels. Then broaden the one-pixel contour skeleton using sigma 0.9 at half resolution, to compare it with actual glyph strokes.
5. Sample each 60px cell to 24×24 using area sampling. The complete cell remains represented.
6. Score all 170 characters using symmetric weighted chamfer error. A descriptor stores 576 normalized ink weights and 576 truncated distance values. Ink cutoff is 0.18. Distance uses two-pass eight-neighbor chamfer (costs 1 and sqrt(2)), with normalized distance min(1, max(0,d-0.5)/6).
7. Error = 0.65 × glyph-ink-weighted target distance + 0.35 × target-ink-weighted glyph distance. Smaller is better; extra glyph strokes receive the larger penalty.
8. Select the minimum-error character. Accept only if contour count >= 8 half-resolution skeleton pixels and error <= 0.24. Otherwise output a full-width space.

The final common gate runs after CPU or native GPU matching. There is no subsequent layout pass that can revive rejected characters. No density target or blank-filling pass exists.

## Diagnostics and resume

Set mode4Diagnostics:true in conversion options to receive an audit for every cell in conversion progress. It contains bestChar, bestScore, edgePixels, limit, accepted, output and reason. The validation script writes scores.csv and checks it against the actual serialized TSL.

Engine 6002 and a fingerprint including threshold/blur/edge settings prevent incompatible checkpoints from mixing. A conversion interrupted under this engine can resume at its last 16-frame checkpoint. A 120px conversion must be restarted to use 60px; old TSL playback remains supported.

## Native path

Windows DirectCompute scores the 1152-component descriptor. The original 469-component kernel remains for legacy requests. The historical grid120 endpoint and launcher filenames are retained for packaging compatibility; the private 60px candidate uses localhost:39089 and TASL-Mode4-60-RC2-Test storage.

Native renderers use the canonical 60px masks, including the formal full-width space. GPU rasterization and encoding are distinct: this test machine used DirectCompute NV12 rendering with libx264 CPU encoding.

## Validation status

Windows 10 Pro 10.0.19045 / GTX 1050 Ti: 10 seconds at 24 fps, 240 converted and decoded frames, all unique; zero rejected-character violations. 46,335 accepted / 91,905 blank cells, placement 33.52%. Conversion took 398.57 seconds on the test machine.

All 170 glyphs and full-width blank positioning were tested in native CPU/GPU rendering. The browser/native comparison had a maximum one-level RGB rounding difference, with matching placement.

Mobile common code was tested sequentially in Chromium and WebKit, including portrait, padded dimensions and partial resume. These are browser-engine tests, not Android/iOS physical-device certification. Windows 11 is also untested.

RC2 reduces secondary strokes compared with RC1. Car/building recognition and some face/body continuity remain insufficient. A 22-second, 5-fps Windows test also produced 110 unique frames, zero score violations, and exact resume from frame 16. Chromium and WebKit partial resume now use the current engine constant for ArrayBuffer checkpoint storage. This candidate is not a finished release.

## RC2 implementation notes

The Gaussian uses paired symmetric taps and an unclamped interior loop; its kernel, boundary replication and sigma are unchanged. The tested 1080p benchmark had zero output difference. No render masks, glyph positions, palette entries, CPU/GPU score kernels, or modes 1–3 algorithms changed from RC1.
