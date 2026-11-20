# Windows toolchain: pinned manifest and mirror

On Windows the extension can download the toolchain it needs (clang/MinGW, CMake,
Ninja) on first use (FR-WIN-TCH-4). What it downloads is described by
[`resources/windows-toolchain.json`](../resources/windows-toolchain.json), which is
shipped in the VSIX and read at run time.

## What is pinned

| Component | Pinned | Source |
|---|---|---|
| llvm-mingw (clang, lld, lldb, `lldb-dap`) | `20261117`, LLVM 23.1.6, `ucrt-x86_64` zip | GitHub Releases of `mstorsjo/llvm-mingw` |
| CMake | `4.5.0`, `windows-x86_64` zip | GitHub Releases of `Kitware/CMake` |
| Ninja | `1.13.2`, `ninja-win.zip` | GitHub Releases of `ninja-build/ninja` |

Each entry carries the version, the upstream URL, a **mirror URL**, our own
**SHA-256** and size, the size once extracted (for the free-disk-space check), the
directory the archive extracts into (`archiveRoot`, `{version}` is substituted),
the directories to put on `PATH` (`binDirs`), the files that must exist after
extraction (`requiredFiles`), and, for llvm-mingw, the target sysroots that are
deleted after extraction (`prune`: `i686`, `aarch64`, `armv7`; the `x86_64` one is
the only one the emulator needs).

The hashes are ours, computed from the archives that were actually downloaded, not
copied from upstream: Ninja publishes no hash file, and a release asset can change
or be deleted. Upstream digests (GitHub's `digest` field, CMake's `SHA-256.txt`)
are a cross-check; at adoption time all three matched.

### What the pinned llvm-mingw archive was checked for

`llvm-mingw-20261117-ucrt-x86_64.zip` (191,082,415 bytes, 9,315 entries, one
top-level directory) was downloaded and its contents listed: it contains
`bin/clang++.exe`, `bin/clang.exe`, `bin/ld.lld.exe`, **`bin/lldb-dap.exe`** and
`bin/liblldb.dll`, plus the four target sysroots (752,994,883 bytes extracted;
536 MB after pruning three of them; longest relative path 85 characters). A
separate `lldb-dap` source is therefore not needed.

> ⚠️ ASSUMPTION: that this `lldb-dap.exe` runs standalone and reads MinGW DWARF
> correctly is not established by the listing. Debugging with the MSYS2 CLANG64
> build of the same LLVM series was verified in M81; the managed build is exercised
> in M84.

## The mirror

Upstream release assets can be deleted by their maintainers, so the downloader falls
back to a copy of each archive kept as an asset of a ds-ide GitHub release.

- Release tag: `toolchain-<toolchainVersion>` (currently `toolchain-1`) on
  `github.com/bobpuley/ds-ide`.
- Asset names are exactly the upstream file names
  (`llvm-mingw-20261117-ucrt-x86_64.zip`, `cmake-4.5.0-windows-x86_64.zip`,
  `ninja-win.zip`); the manifest's `mirrorUrl` is derived from them.
- **The assets are uploaded by hand**, by someone with write access to the
  repository; the extension never uploads anything. Until they are uploaded the
  mirror URL answers 404 and the downloader simply reports the primary failure.

## Maintaining the manifest

```bash
node scripts/update-toolchain-manifest.mjs check                  # validate the manifest
node scripts/update-toolchain-manifest.mjs hash <file>...         # SHA-256 and size of a file
node scripts/update-toolchain-manifest.mjs verify <dir>           # archives in <dir> vs the manifest
node scripts/update-toolchain-manifest.mjs adopt <name> <version> <url> <file>
```

To adopt a new version of a component:

1. Download the archive from the official source and inspect it (it must still
   contain the `requiredFiles`).
2. `adopt <name> <version> <url> <archive>` records its version, URL, SHA-256 and
   size, **bumps `toolchainVersion`** (the storage directory and the mirror release
   tag follow it) and re-derives every mirror URL.
3. Update `extractedSize` (and `archiveRoot` / `prune` if the layout changed) by
   hand, then `check`.
4. Create the `toolchain-<new version>` release and upload all three archives.
5. Run `verify <dir>` against the uploaded files.

## Licences

llvm-mingw, CMake and Ninja are downloaded by the user's machine from their own
release pages (or the ds-ide mirror), not redistributed inside the VSIX. The mirror
does redistribute them as release assets; their licences (Apache-2.0 with LLVM
exceptions, BSD-3-Clause, Apache-2.0) permit it, but the licence texts shipped
inside the archives are kept intact because the archives are mirrored unmodified.

> ⚠️ ASSUMPTION: the licence terms for redistributing the mirrored archives have not
> been reviewed beyond the above; review them before the first public release that
> ships this feature.
