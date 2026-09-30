# M72 — Scope Instrument — Emulator Capture

**Version:** 0.23.0
**Status:** planned
**Source:** feature intake session, 2026-09-30 (01_input-ideas.md; design_plan.md P0-4; follow-up to M70–M71)

## Goal

The scope stream is decimated, so fine time bases lose detail and a webview trigger can miss a
transient between snapshots. After this milestone the emulator keeps a full-rate capture ring,
triggers without adding work to the real-time callback, and returns a triggered window on request,
so single-shot is reliable and fine time bases show full-rate detail. Task breakdown is deferred
until M70–M71 have shipped and their limits are measured.

## Sprint Tasks

### [ ] feat: emulator-side full-rate capture and triggered window (FR-SCI-14)

Design deferred; this placeholder keeps M72 in the registry. Replace it with real tasks when the
milestone is planned.

**Affected files:** `emulator/runtime/audio_engine.cpp`, `src/ipc/narrow.ts`, `src/webview/scope-webview.ts`

**DoD:**
- to be defined when M72 is planned
