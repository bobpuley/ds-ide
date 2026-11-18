# RtAudio (vendored)

Windows real-time audio backend for the emulator (FR-WIN-AUD-5).

- Upstream: https://github.com/thestk/rtaudio
- Version: **6.0.1** (tag `6.0.1`), unmodified
- Files: `RtAudio.cpp`, `RtAudio.h`, `LICENSE` (MIT-style)

| File          | SHA-256                                                            |
|---------------|--------------------------------------------------------------------|
| `RtAudio.cpp` | `d880f065bdb65536ce5cf4619b6a2408a360ad0103b8b38600f1a29a11ff1e1e` |
| `RtAudio.h`   | `3acbd6d0493a1d03941be3f22e050d0fe9ab4a968784c7d0c81530a58162953d` |
| `LICENSE`     | `73eb32613a621c134b33fbe3c661562dcf5f81f0558af13d483fc241eb21be7b` |

The upstream `include/` directory (Steinberg ASIO SDK files, DirectSound/OSS
headers) is deliberately **not** vendored. ASIO is compiled in only when CMake
is pointed at a locally installed ASIO SDK (`-DASIO_SDK_DIR=...`); the default
Windows build uses WASAPI only.

To upgrade: replace the three files from a new upstream tag, update the
version and hashes above, and re-run the emulator suites and Windows CI.
