// Shared host <-> webview message protocol (FR-IPC-6). Type-only exports —
// safe to import from both the extension host (Node) and webview (browser)
// bundles since nothing here has a runtime footprint.
import type { ConventionControl } from '../controllers/controls-convention-parser';
import type { ControllerConfig } from '../controllers/controller-config';
import type { WiredPin, DeviceType } from '../wiring/wiring-panel';
import type { ControlsPlacement } from './scope-panel';
import type { PeripheralDisplayState } from '../wiring/peripheral-state';
import type { SdEntry } from './sd-viewer';

// ── Daisy Scope panel ────────────────────────────────────────────────────

export type ScopeHostMessage =
  | { command: 'scope'; in: number[]; out: number[] }
  | { command: 'status'; running: boolean; sampleRate?: number; blockSize?: number }
  | { command: 'wavSelected'; name: string }
  | { command: 'event'; kind: string }
  | { command: 'xrun'; count: number }
  | { command: 'latency'; estimatedMs?: number }
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

// ── OLED viewer panel (FR-DEV-15) ────────────────────────────────────────

export type OledHostMessage =
  | { command: 'oledFrame'; data: string }
  | { command: 'oledBus'; bus: string | null };

export type OledWebviewMessage =
  | { command: 'webviewReady' };

// ── MIDI panel (FR-DEV-18) ───────────────────────────────────────────────

// Relays the shim's parsed-event confirmation (emulator/runtime/ipc_server.cpp's
// `midiRx` message, and the shim's own SendMessage()-driven `midiTx` message —
// FR-MIDI-1) for the monitor — `midiType` is daisy::MidiMessageType's
// underlying int value (0=NoteOff, 1=NoteOn, 2=ControlChange, 3=Unknown).
export type MidiHostMessage =
  | { command: 'midiRx'; status: number; data1: number; data2: number; channel: number; midiType: number }
  | { command: 'midiTx'; status: number; data1: number; data2: number; channel: number; midiType: number };

export type MidiWebviewMessage =
  | { command: 'webviewReady' }
  | { command: 'noteOn'; note: number; velocity: number }
  | { command: 'noteOff'; note: number; velocity: number }
  | { command: 'programChange'; program: number }
  | { command: 'controlChange'; controller: number; value: number };

// ── Controls Editor ──────────────────────────────────────────────────────

export type ControlsHostMessage =
  | { command: 'controlsConfig'; controls: ConventionControl[]; placements: ControlsPlacement[]; missingBlock: boolean }
  | { command: 'status'; running: boolean; sampleRate?: number; blockSize?: number }
  | { command: 'editorLoad'; cfg: ControllerConfig }
  | { command: 'led'; gpioPin: number; lit: boolean }
  | { command: 'rgbLed'; gpioPin: number; r: number; g: number; b: number }
  // FR-SD-1: `enabled` gates the whole accordion section; `entries` is the
  // root-level listing, re-read from disk on webview focus/explicit refresh
  // (not cached the way editorLoad/controlsConfig are — see FR-CE-1's note
  // on why this path deliberately doesn't share that cache).
  | { command: 'sdCardEnabled'; enabled: boolean }
  | { command: 'sdContents'; entries: SdEntry[] }
  | { command: 'sdPreview'; name: string; content: string | null }
  // FR-CE-2: `oledEnabled` gates the docked strip's visibility and carries
  // the bus label for its footer (mirrors sdCardEnabled's gating role);
  // `oledFrame` carries the live framebuffer, same wire shape OledHostMessage
  // uses for the standalone panel.
  | { command: 'oledEnabled'; enabled: boolean; bus: string | null }
  | { command: 'oledFrame'; data: string };

export type ControlsWebviewMessage =
  | { command: 'webviewReady' }
  | { command: 'editorSave'; cfg: ControllerConfig }
  | { command: 'pot'; channel: number; value: number }
  | { command: 'button'; gpioPin: number; pressed: boolean }
  | { command: 'toggle'; gpioPin: number; position: number }
  | { command: 'encoder'; gpioPin: number; position: number }
  | { command: 'sdRefresh' }
  | { command: 'sdPreview'; name: string }
  // FR-CE-2: "show in separate view" — opens today's standalone OledPanel
  // unchanged, same target the Wiring Editor's View button opens.
  | { command: 'oledPopOut' };

// ── Wiring Editor ────────────────────────────────────────────────────────

export type WiringHostMessage =
  | { command: 'wiredPins'; pins: WiredPin[] }
  | { command: 'peripherals'; peripherals: PeripheralDisplayState[] };

export type WiringWebviewMessage =
  | { command: 'wirePin'; pinNumber: number; deviceType: DeviceType; id: string }
  | { command: 'unwirePin'; pinNumber: number; id: string }
  // FR-UDM-7: `bus` is the lane a drop landed on; omitted, the host uses
  // the peripheral's current/default bus.
  | { command: 'setPeripheralEnabled'; peripheralId: string; enabled: boolean; bus?: string }
  | { command: 'viewPeripheral'; peripheralId: string }
  // FR-UDM-4: the device popover's "Reveal in code" — `id` is a control's
  // instance id or a peripheral's registry id.
  | { command: 'revealInCode'; id: string };
