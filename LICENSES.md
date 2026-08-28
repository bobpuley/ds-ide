# Third-Party Licenses

This file tracks the licenses of components bundled with or used by ds-ide.

---

## ds-ide (this project)

MIT License — Copyright (c) Daisy IDE contributors.

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
ds-ide **does not bundle** `lldb-dap` — it is located at runtime via `xcrun` or known Xcode / CLT paths on the user's machine.  
Users must have Xcode Command Line Tools installed (`xcode-select --install`) to use the debug feature.

Full license text: https://llvm.org/LICENSE.txt

---

## Node.js runtime / VS Code extension host

VS Code extensions run inside the VS Code extension host (Node.js).  
Node.js is MIT-licensed. VS Code is MIT-licensed.
