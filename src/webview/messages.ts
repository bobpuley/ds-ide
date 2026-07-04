// Shared host <-> webview message protocol (FR-IPC-6). Type-only exports —
// safe to import from both the extension host (Node) and webview (browser)
// bundles since nothing here has a runtime footprint.
import type { ConventionControl } from '../controllers/controls-convention-parser';
import type { ControllerConfig } from '../controllers/controller-config';
import type { WiredPin, DeviceType } from '../wiring/wiring-panel';
import type { ControlsPlacement } from './scope-panel';

// ── Daisy Scope panel ────────────────────────────────────────────────────

export type ScopeHostMessage =
  | { command: 'scope'; in: number[]; out: number[] }
  | { command: 'status'; running: boolean; sampleRate?: number; blockSize?: number }
  | { command: 'wavSelected'; name: string }
  | { command: 'event'; kind: string }
  | { command: 'xrun'; count: number }
  | { command: 'latency'; measuredMs?: number }
  | { command: 'led'; gpioPin: number; lit: boolean }
  | { command: 'spectrum'; in_fft: number[]; out_fft: number[]; binHz: number }
  | { command: 'recordingState'; recording: boolean; replaying: boolean; fileName?: string | null }
  | { command: 'replayDone' };

export type ScopeWebviewMessage =
  | { command: 'webviewReady' }
  | { command: 'sine'; freq: number; amplitude: number }
  | { command: 'audioSource'; input: 'sine' | 'live' | 'wav'; sampleRate: number; bufferSize: number; wavLoop: boolean }
  | { command: 'pickWav' }
  | { command: 'startAudio' }
  | { command: 'stopAudio' }
  | { command: 'recordStart' }
  | { command: 'recordStop' }
  | { command: 'replayStart' }
  | { command: 'outputVolume'; volume: number };

// ── Controls Editor ──────────────────────────────────────────────────────

export type ControlsHostMessage =
  | { command: 'controlsConfig'; controls: ConventionControl[]; placements: ControlsPlacement[]; missingBlock: boolean }
  | { command: 'status'; running: boolean; sampleRate?: number; blockSize?: number }
  | { command: 'editorLoad'; cfg: ControllerConfig }
  | { command: 'led'; gpioPin: number; lit: boolean };

export type ControlsWebviewMessage =
  | { command: 'webviewReady' }
  | { command: 'editorSave'; cfg: ControllerConfig }
  | { command: 'pot'; channel: number; value: number }
  | { command: 'button'; gpioPin: number; pressed: boolean };

// ── Wiring Editor ────────────────────────────────────────────────────────

export type WiringHostMessage =
  { command: 'wiredPins'; pins: WiredPin[] };

export type WiringWebviewMessage =
  | { command: 'wirePin'; pinNumber: number; deviceType: DeviceType; id: string }
  | { command: 'unwirePin'; pinNumber: number; id: string };
