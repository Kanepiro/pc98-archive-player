# Mode 4 60px contour AA — v0.3.44-rc.5

This is an isolated validation candidate. Do not replace the published working release until visual and platform acceptance are complete.

## Fixed geometry and unchanged characters

Source selection and display cells are 60×60 pixels. Dimensions are rounded upward to whole cells with centered padding, without cropping. The original CP932 palette has exactly 170 unique characters. The only additional frame character is U+3000 (CP932 81 40), occupying one full 60px cell.

The bundled Noto Sans Mono CJK JP Regular masks are unchanged from RC1/RC2. Font size is nominally 60px. The four 62px ink extents (├ ┤ ┼ β) retain the previously documented uniform 60/62 fit. RC5 does not rotate, distort, scale, clip, add or remove glyphs.

RC5 retains the RC3 position search and evaluates the 2014 legal positions of these same 170 glyphs on a 5px translation lattice. Every nonzero mask pixel must remain inside its own cell. Five source pixels correspond exactly to two 24×24 descriptor pixels. Position candidates are not new palette characters.

## Contours and score

1. Grayscale plus existing contrast/brightness/gamma options.
2. Separable Gaussian sigma 8 source pixels, radius ceil(3 sigma), replicated image boundaries, fused with the following 2×2 area reduction. Each adjacent pair of Gaussian kernels is averaged before convolution; this is the same linear filter up to Float32 rounding. It does not change source-pixel sigma.
3. Central gradient, four-direction nonmaximum suppression, hysteresis high 0.025 / low 0.0125.
4. Remove connected components shorter than 12 half-resolution pixels.
5. Retain the principal local connected stroke per 60px cell: local length × (1 + 0.25 × log(1 + global connected contour length)).
6. Broaden the skeleton with sigma 0.9 at half resolution; source brightness is not added as fill.
7. Area sample the entire 60px cell to 24×24.
8. Evaluate all 170 glyphs at every legal position; choose the minimum error.
9. Accept only if skeleton count >= 8 and error <= 0.34. Otherwise output a stationary full-width blank.

Descriptor: 576 normalized ink weights (cutoff 0.18), then 576 truncated eight-neighbor chamfer distances. Horizontal/vertical distance cost is 1 and diagonal cost is sqrt(2). Distance normalization is min(2,max(0,d-0.5)/2.5).

Error = 0.65 × glyph-ink-weighted target distance + 0.35 × target-ink-weighted glyph distance. Lower is better. Distant extra strokes receive more penalty while missed contours remain penalized.

CPU scoring skips zero ink weights and prunes only using a nonnegative partial-score lower bound; it still considers every position. Native GPU protocol version 2 has 2014 candidates and this same score; version 1 retains its original 170-glyph score for old clients. The native process keeps the glyph buffer resident when the input atlas is unchanged.

A common final gate runs after CPU/GPU selection. There is no blank-filling or post-layout revival. Audit fields include bestChar, bestScore, bestX, bestY, edgePixels, limit, accepted, output, x and y.

## TSL, playback, MP4 and resume

The CP932 TSL 1.08 header, schedule and text frames retain their existing syntax. New files still use TASL_MODE4_CELL60. Optional header comments encode positions:

# TASL_MODE4_OFFSETS <zero-based frame> <base64 of uint8 dx+60,dy+60 pairs>

There is one pair for every cell, including blanks (60,60). Positions must be multiples of five within -55…55, fit the unchanged glyph bounds, and leave blanks stationary. Invalid frame counts, duplicate frame indexes, incorrect lengths and cell overflow are rejected. Files without these comments render at the original positions.

Existing TSL files remain readable. Older players that ignore the new comments can read the text, but cannot reproduce RC3's within-cell placement; accurate positioned playback requires RC3 support.

Browser preview/export and native CPU/GPU export use the same canonical masks and stored offsets. GPU rasterization builds a bounded atlas of the actual character/position combinations used by the TSL. Native CPU rendering checks every shifted ink pixel for overflow.

Engine 6005 distinguishes old conversion checkpoints. Checkpoint batches store offsets alongside frame bytes; resuming reconstructs the same header comments. WebKit continues to use ArrayBuffer storage for the current engine. Modes 1–3 keep their previous algorithms, workers and checkpoint engine numbers.

## Native build and isolation

The Windows validation launcher uses localhost:39092 and TASL-Mode4-60-RC5-Test. Native glyph matching uses DirectCompute, not WebGPU. GPU rasterization and compression are separate; the available GTX 1050 Ti machine uses DirectCompute NV12 rasterization and libx264 CPU encoding.

The source includes tests for palette/bounds, all 2014 positions, sparse/dense score equivalence, positioned TSL roundtrip/resume, malformed offsets, Gaussian equivalence, blank rejection and threshold boundaries. Native validation compares all 2014 positions in browser, CPU and GPU rendering, and checks actual-image CPU/GPU scores.

Windows 11, Android and iOS physical-device verification is not supplied by Linux Chromium/WebKit tests. Actual test measurements and visual limitations are recorded separately in each version’s validation report.

## Earlier Gaussian optimization

RC4 fused Gaussian filtering with the subsequent 2×2 area reduction. This remains unchanged. Tests cover random, constant and corner-impulse images, sigma 0/0.9/4/8/24 and narrow boundary cases against the unfused reference (absolute tolerance 1.2e-7).

## RC5 precision weighting

The final error is 0.65 times glyph-to-contour distance plus 0.35 times contour-to-glyph distance. The per-pixel distance is min(2, max(0, d - 0.5) / 2.5). The pass limit is 0.34. Descriptors scale target distances by 1.3 and glyph distances by 0.7, preserving the existing symmetric dot-product native protocol. Sigma remains 8 source pixels. The 170 characters, legal positions, 60px masks and rejection gate remain unchanged.
