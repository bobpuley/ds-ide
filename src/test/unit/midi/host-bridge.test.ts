import { describe, it, expect, vi } from 'vitest';
import { HostMidiBridge, defaultInputFactory } from '../../../midi/host-bridge';
import type { MidiInputLike, MidiInputFactory } from '../../../midi/host-bridge';

function fakeManager() {
  return { sendMidiEvent: vi.fn() };
}

function fakeInput(portCount: number, messageHandlers: Array<(dt: number, msg: number[]) => void>[]): MidiInputLike {
  const handlers: Array<(dt: number, msg: number[]) => void> = [];
  messageHandlers.push(handlers);
  return {
    getPortCount: () => portCount,
    getPortName: (i) => `port-${i}`,
    openPort: vi.fn(),
    closePort: vi.fn(),
    on: (event, cb) => { if (event === 'message') handlers.push(cb); },
  };
}

describe('HostMidiBridge (FR-DEV-18)', () => {
  it('is inert on a non-macOS platform — never touches the input factory', () => {
    const factory = vi.fn();
    const bridge = new HostMidiBridge(fakeManager(), factory as unknown as MidiInputFactory, 'linux');
    bridge.start();
    expect(factory).not.toHaveBeenCalled();
  });

  it('is inert (no throw) when the native binding fails to load', () => {
    const factory: MidiInputFactory = () => { throw new Error('native module not found'); };
    const bridge = new HostMidiBridge(fakeManager(), factory, 'darwin');
    expect(() => bridge.start()).not.toThrow();
  });

  it('opens every enumerated port on macOS', () => {
    const opened: number[] = [];
    const handlerLists: Array<Array<(dt: number, msg: number[]) => void>> = [];
    let call = 0;
    const factory: MidiInputFactory = () => {
      call++;
      const input = fakeInput(2, handlerLists);
      const originalOpen = input.openPort;
      input.openPort = (i: number) => { opened.push(i); originalOpen(i); };
      return input;
    };
    const bridge = new HostMidiBridge(fakeManager(), factory, 'darwin');
    bridge.start();
    // First factory call is the enumeration probe (never opened); one more
    // factory call per port to actually listen on it.
    expect(call).toBe(3);
    expect(opened.sort()).toEqual([0, 1]);
  });

  it('forwards an incoming message into sendMidiEvent(status, data1, data2)', () => {
    const manager = fakeManager();
    const handlerLists: Array<Array<(dt: number, msg: number[]) => void>> = [];
    const factory: MidiInputFactory = () => fakeInput(1, handlerLists);
    const bridge = new HostMidiBridge(manager, factory, 'darwin');
    bridge.start();
    // handlerLists[0] is the enumeration probe's (never fired); [1] is the
    // one open port's real handler list.
    for (const cb of handlerLists[1] ?? []) cb(0, [0x90, 60, 100]);
    expect(manager.sendMidiEvent).toHaveBeenCalledWith(0x90, 60, 100);
  });

  it('closes the enumeration probe port after reading the port count (FR-EXT-15)', () => {
    const handlerLists: Array<Array<(dt: number, msg: number[]) => void>> = [];
    const probes: MidiInputLike[] = [];
    let call = 0;
    const factory: MidiInputFactory = () => {
      call++;
      const input = fakeInput(1, handlerLists);
      if (call === 1) probes.push(input);
      return input;
    };
    const bridge = new HostMidiBridge(fakeManager(), factory, 'darwin');
    bridge.start();
    expect(probes[0]?.closePort).toHaveBeenCalledOnce();
  });

  it('one bad port does not prevent other ports from opening or throw out of start() (FR-EXT-14)', () => {
    const handlerLists: Array<Array<(dt: number, msg: number[]) => void>> = [];
    const opened: number[] = [];
    let call = 0;
    const factory: MidiInputFactory = () => {
      call++;
      const input = fakeInput(3, handlerLists);
      const portIndex = call - 2; // call 1 is the probe; calls 2..4 are ports 0..2
      input.openPort = vi.fn((i: number) => {
        if (portIndex === 1) throw new Error('port 1 is busy');
        opened.push(i);
      });
      return input;
    };
    const bridge = new HostMidiBridge(fakeManager(), factory, 'darwin');
    expect(() => bridge.start()).not.toThrow();
    expect(opened.sort()).toEqual([0, 2]);
  });

  it('stop() closes every opened port', () => {
    const handlerLists: Array<Array<(dt: number, msg: number[]) => void>> = [];
    const closedPorts: MidiInputLike[] = [];
    const factory: MidiInputFactory = () => {
      const input = fakeInput(1, handlerLists);
      const originalClose = input.closePort;
      input.closePort = () => { closedPorts.push(input); originalClose(); };
      return input;
    };
    const bridge = new HostMidiBridge(fakeManager(), factory, 'darwin');
    bridge.start();
    closedPorts.length = 0; // start() also closes the enumeration probe (FR-EXT-15); isolate stop()'s own closes
    bridge.stop();
    expect(closedPorts).toHaveLength(1);
  });
});

// FR-EXT-36: the pinned 'midi' dependency's Input class must keep satisfying
// MidiInputLike. 'midi' is a native addon rebuilt against Electron's ABI by
// scripts/rebuild-midi-native.sh (FR-DEV-19) — not the plain Node.js this
// test suite runs under — so a NODE_MODULE_VERSION mismatch here is the
// expected, documented state outside VS Code's actual Extension Host (see
// scripts/check-native-abi.js's identical tolerance) and isn't a shape
// regression; any other load failure (e.g. the package going missing) is.
describe('installed midi package (FR-EXT-36)', () => {
  it('satisfies the MidiInputLike shape host-bridge.ts depends on', () => {
    let probe: MidiInputLike;
    try {
      probe = defaultInputFactory();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/NODE_MODULE_VERSION/.test(message)) {
        console.warn('ds-ide: midi package ABI mismatch under this Node runtime — skipping shape check:', message);
        return;
      }
      throw err;
    }
    expect(typeof probe.getPortCount).toBe('function');
    expect(typeof probe.getPortName).toBe('function');
    expect(typeof probe.openPort).toBe('function');
    expect(typeof probe.closePort).toBe('function');
    expect(typeof probe.on).toBe('function');
  });
});
