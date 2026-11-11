# 04 — Architecture (v25)

> **v23 complete** — full v23 architecture in
> [`docs/v23/04_architecture.md`](v23/04_architecture.md).
>
> **v24 complete** — full v24 architecture in
> [`docs/v24/04_architecture.md`](v24/04_architecture.md).

## First public preview (`FR-REL-*`)

No architecture impact. `FR-REL-1` is a `package.json` manifest declaration. `FR-REL-2` adds a `detectCMake()` helper beside `detectDfuUtil()` in `src/hardware/toolchain.ts` (same injectable `exists`/`exec` shape, same `which` → known-paths order) and routes `EmulatorManager.build()`'s `cmake` invocations through it; the transport state machine and the `buildFailed` flow are unchanged apart from carrying a failure reason to the notification.
