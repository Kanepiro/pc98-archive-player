# Windows v0.3.47 build

Run npm ci, npm test, npm run build. Use Python 3.11+ and the LLVM-mingw x86_64 UCRT toolchain:

```text
python scripts/build-public-release.py --toolchain <llvm-mingw-folder> --out <new-native-output>
python scripts/package-public-release.py --baseline-zip <official-v0.3.46-Windows-x64.zip> --native-build <new-native-output> --out <new-package-directory> --zip <new-v0.3.47-Windows-x64.zip>
```

The packager checks the official v0.3.46 runtime ZIP SHA-256 and refuses to overwrite an existing output. The six native executables use generic x64/SSE2 flags. The launcher embeds native-boost/resources/TASL_public_icon.ico through the Windows resource compiler. Runtime libraries, FFmpeg and models retain the official baseline versions. No private owner build is used as a runtime source.

Default port:39083. Data:%LOCALAPPDATA%/TASL-Faithful-Boost. For isolated tests set TASL_BOOST_PORT and TASL_BOOST_DATA_DIR. See verification/public-v0.3.47/TEST-RESULTS.md.
