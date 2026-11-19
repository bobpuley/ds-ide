// Host MIDI bridge (FR-DEV-18) — forwards a real controller's messages into
// the emulator's midiEvent pipeline (manager.sendMidiEvent). Runs wherever the
// 'midi' addon is shipped (macOS arm64, Windows x64 — FR-WIN-MIDI-1); on any
// other platform the addon is absent, the lazy load fails and the bridge
// degrades to a console warning, with the on-screen keyboard as the fallback.
// On Windows RtMidi uses the WinMM backend (the 'midi' package's default);
// each physical device appears as one input port, and WinMM allows a port to
// be opened by one process at a time, so a busy port is skipped, not fatal.
//
// 'midi' (RtMidi bindings) is a native addon esbuild can't inline (see
// esbuild.js's `external`) — loaded lazily via the injectable
// `inputFactory`, never at module load time, so a missing/broken native
// binary for this platform/arch can never take down extension activation.

export interface MidiInputLike {
  getPortCount(): number;
  getPortName(index: number): string;
  openPort(index: number): void;
  closePort(): void;
  on(event: 'message', callback: (deltaTime: number, message: number[]) => void): void;
}

export type MidiInputFactory = () => MidiInputLike;

// Exported so a smoke test (FR-EXT-36) can verify the installed 'midi'
// package's Input class still satisfies MidiInputLike — not just that
// HostMidiBridge's own injected-factory tests pass (those never touch the
// real package).
export function defaultInputFactory(): MidiInputLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const midi = require('midi') as { Input: new () => MidiInputLike };
  return new midi.Input();
}

export interface MidiEventSender {
  sendMidiEvent(status: number, data1: number, data2: number): void;
}

// Listens on every enumerated host MIDI input port simultaneously (each
// `midi.Input` instance binds to exactly one port) — no port-selection UI in
// this milestone, matching FR-DEV-18's scope; a real controller just works
// without the user picking it out of a list.
export class HostMidiBridge {
  private openInputs: MidiInputLike[] = [];

  constructor(
    private readonly manager: MidiEventSender,
    private readonly inputFactory: MidiInputFactory = defaultInputFactory,
  ) {}

  start(): void {
    let probe: MidiInputLike;
    try {
      probe = this.inputFactory();
    } catch (err) {
      console.warn('ds-ide: MIDI host bridge unavailable —', err);
      return;
    }
    const count = probe.getPortCount();
    // Only used to read the port count — close it immediately rather than
    // leaking its underlying native handle (FR-EXT-15).
    probe.closePort();

    for (let i = 0; i < count; i++) {
      try {
        const input = this.inputFactory();
        input.openPort(i);
        input.on('message', (_deltaTime, message) => {
          const [status, data1, data2] = message;
          if (status === undefined) return;
          this.manager.sendMidiEvent(status, data1 ?? 0, data2 ?? 0);
        });
        this.openInputs.push(input);
      } catch (err) {
        // One bad/busy port must not stop the rest from opening, or
        // propagate out of start() (and thus activate()) (FR-EXT-14).
        console.warn(`ds-ide: failed to open MIDI port ${i} —`, err);
      }
    }
  }

  stop(): void {
    for (const input of this.openInputs) input.closePort();
    this.openInputs = [];
  }
}
