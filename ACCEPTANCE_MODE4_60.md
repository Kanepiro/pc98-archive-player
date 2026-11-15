# Mode 4 acceptance decisions

2026-11-16 JST: the user confirmed that physical Android/iOS test environments are unavailable and waived physical-device testing as a completion requirement. Use the shared implementation, Chromium/WebKit tests, and available Windows hardware. Report physical-device coverage accurately; do not gate completion on obtaining unavailable devices.

The user reviewed RC5 and said it was substantially improved. The release retains the RC5 algorithm (engine 6005), sigma 8, 170 characters, legal 60px glyph placement, precision-weighted distance score, and strict <= 0.34 gate. Existing RC5 checkpoints stay compatible.

Interpolated nonmaximum suppression was compared at 1/3/5/8 seconds. It changed more characters under 0.5/1px source movement than RC5 and was not adopted. Previous boundary-weighting and weaker-blur experiments were also not adopted.

Acceptance is based on recognizable person/car/building outlines and visible characters, not fine facial detail or pixel similarity. Runtime errors, frame freezes, invalid glyphs, rejected-cell output, and layout mismatch remain release blockers.

Do not overwrite the published release as part of local validation. Preserve prior code and builds. The Windows deliverable restores the original default port and data directory; validation may override them through TASL_BOOST_PORT and TASL_BOOST_DATA_DIR.
