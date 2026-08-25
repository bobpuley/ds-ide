// Host MIDI bridge (FR-DEV-18) — forwards a real controller's messages into
// the emulator's midiEvent pipeline (manager.sendMidiEvent), macOS-only by
// explicit decision (02_assumptions-and-risks.md); the on-screen keyboard is
// the cross-platform fallback everywhere else.
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

function defaultInputFactory(): MidiInputLike {
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
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  start(): void {
    if (this.platform !== 'darwin') return;

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
