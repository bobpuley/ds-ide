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

DaisySP is compiled unchanged from the user's project submodule — not bundled in the extension.

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
