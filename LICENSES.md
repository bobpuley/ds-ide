# Third-Party Licenses

This file tracks the licenses of components bundled with or used by ds-ide.

---

## ds-ide (this project)

**License:** PolyForm Shield License 1.0.0 (SPDX: `PolyForm-Shield-1.0.0`)  
**Copyright:** Marco Pugliese  
**Text:** see [LICENSE](LICENSE)

---

## libDaisy

**License:** MIT  
**Copyright:** Electrosmith  
**Source:** https://github.com/electro-smith/libDaisy

ds-ide ships a host compatibility shim (C++ source) derived from the libDaisy public API surface.
libDaisy itself is compiled unchanged from the user's project submodule — not bundled in the extension.

---

## DaisySP

**License:** MIT  
**Copyright:** Electrosmith  
**Source:** https://github.com/electro-smith/DaisySP

ds-ide bundles a pinned copy of DaisySP's `Source/` directory (tag `V1.0.0`, vendored as a git submodule at
`vendor/DaisySP/`), unmodified — the `LICENSE` file is shipped alongside it in the packaged extension.
`Daisy IDE: New Effect Project` copies this bundled copy into new projects at creation time (`FR-PKG-3`);
an imported project with its own DaisySP (e.g. a hardware-build git submodule) is unaffected — ds-ide never
overwrites a project-local copy.

**Not bundled:** `DaisySP-LGPL`, a separately-licensed (LGPL) companion library distributed as DaisySP's own
nested git submodule. ds-ide never initializes or vendors this submodule.

---

## lldb-dap

**License:** Apache License v2.0 with LLVM Exceptions  
**Copyright:** LLVM Project contributors  
**Source:** https://llvm.org/

`lldb-dap` (formerly `lldb-vscode`) is the DAP server component of the LLVM debugger.  
ds-ide **does not bundle** `lldb-dap`. It is located at runtime on the user's machine:

- **macOS:** via `xcrun` or the known Xcode / Command Line Tools paths. Users must have the Xcode Command Line
  Tools installed (`xcode-select --install`) to use the debug feature.
- **Windows:** in the user's own LLVM or MSYS2 CLANG64 install, or in the managed toolchain the extension can
  download on first use (see "Managed Windows toolchain" below), which includes it.

Full license text: https://llvm.org/LICENSE.txt

---

## RtAudio

**License:** MIT-style (see the text below)  
**Copyright:** 2001-2023 Gary P. Scavone  
**Source:** https://github.com/thestk/rtaudio

The emulator's real-time audio backend on Windows uses RtAudio 6.0.1 (WASAPI). Its source is vendored,
unmodified, in `vendor/RtAudio/` and ships in the packaged extension together with its `LICENSE` file; it is
compiled on the user's machine together with the effect. The ASIO SDK is **not** included: ASIO support is
off unless a user builds with their own copy.

RtAudio: a set of realtime audio i/o C++ classes  
Copyright (c) 2001-2023 Gary P. Scavone

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without
limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
Software, and to permit persons to whom the Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions
of the Software.

Any person wishing to distribute modifications to the Software is asked to send the modifications to the
original developer so that they can be incorporated into the canonical version. This is, however, not a
binding provision of this license.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.

---

## Managed Windows toolchain (downloaded, not bundled)

On Windows the extension can download, after the user agrees, a pinned set of programs into its own storage
folder. None of them is part of the extension package; each keeps its own licence files inside its archive, and
the archives are used unmodified and checked against a SHA-256 hash pinned in
`resources/windows-toolchain.json` before they are unpacked.

| Component | Pinned version | Licence | Source |
|---|---|---|---|
| llvm-mingw (clang, lld, lldb, `lldb-dap`, MinGW-w64 runtime) | 20261117 (LLVM 23.1.6) | LLVM: Apache License v2.0 with LLVM Exceptions; MinGW-w64 and the other parts under their own licences, as shipped in the archive | https://github.com/mstorsjo/llvm-mingw |
| CMake | 4.5.0 | BSD 3-Clause | https://github.com/Kitware/CMake |
| Ninja | 1.13.2 | Apache License v2.0 | https://github.com/ninja-build/ninja |

As a fallback source, unmodified copies of the same three archives are kept as assets of a ds-ide GitHub release
(`toolchain-1`); see `docs/toolchain-mirror.md`.

> ⚠️ ASSUMPTION: the licences above are those the projects publish for these releases; the redistribution
> terms for the mirrored copies have not been reviewed beyond that.

---

## Node.js runtime / VS Code extension host

VS Code extensions run inside the VS Code extension host (Node.js).  
Node.js is MIT-licensed. VS Code is MIT-licensed.

---

## midi (host MIDI bridge native addon)

**License:** MIT (node-midi) with RtMidi's MIT-style license  
**Source:** https://github.com/justinlatimer/node-midi

The packaged extension ships `node_modules/midi` (JS glue + the prebuilt `midi.node`, which statically
includes RtMidi) and its two runtime dependencies, `bindings` and `file-uri-to-path`. Their license
notices follow, as the licenses require.

### node-midi 2.0.0

Copyright (C) 2011-2021 by Justin Latimer.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.

### RtMidi (bundled inside node-midi)

RtMidi: realtime MIDI i/o C++ classes  
Copyright (c) 2003-2019 Gary P. Scavone

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

Any person wishing to distribute modifications to the Software is asked to send the modifications to the
original developer so that they can be incorporated into the canonical version. This is, however, not a
binding provision of this license.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.

### bindings 1.5.0 and file-uri-to-path 1.0.0

Copyright (c) 2012 Nathan Rajlich (bindings), Copyright (c) 2014 Nathan Rajlich (file-uri-to-path).
Both are MIT-licensed under the same terms as node-midi above (permission notice and warranty disclaimer
identical to the text of the MIT License).
