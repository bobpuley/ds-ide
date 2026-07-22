// Codegen strategy types (FR-DEV-4) — see codegen/pot.ts for the one
// concrete strategy that exists today.

export interface CodegenInstance {
  id: string;
  pin: number;
}

// Declared only by device kinds whose declaration/init codegen must be
// regenerated in full from every current same-kind instance whenever any of
// them changes — today, only pot, whose real libDaisy AdcHandle::Init()
// needs one contiguous AdcChannelConfig array rather than a separate config
// per instance (FR-CODEGEN-1). A kind without this is handled entirely by
// declarationLine() (controls-writer.ts) plus a per-instance init line built
// from its DeviceDescriptor.initArgs — no shared state to regenerate.
export interface SharedCodegenStrategy {
  /** The declaration-block line representing every current same-kind instance together. */
  declLine(instances: CodegenInstance[]): string;
  /** Matches an existing declLine() output, to find/replace/remove it. */
  isDeclLine(line: string): boolean;
  /** The init-block line(s) representing every current same-kind instance together. */
  initLines(instances: CodegenInstance[]): string[];
  /** Matches a line produced by initLines(), to strip stale ones before regenerating. */
  isInitLine(line: string): boolean;
}

// Declared only by a bus-attached peripheral with no per-instance id/pin at
// all (today: only sdcard, FR-DEV-10) — enabled or not, never keyed by a
// list of named instances the way SharedCodegenStrategy's pot is. Wiring
// this into controls-writer.ts's id/pin-shaped annotation pipeline doesn't
// apply here; FR-DEV-11's peripheral enable/disable flow calls these
// directly instead.
export interface PeripheralCodegenStrategy {
  /**
   * The declaration-block line for this peripheral, emitted at most once.
   * `bus` selects the declared type/driver for a peripheral with more than
   * one candidate bus (FR-DEV-14, e.g. OLED's SPI1 vs I2C1 transport
   * template) — ignored by a single-bus peripheral like sdcard.
   */
  declLine(bus?: string): string;
  /** Matches an existing declLine() output (any bus variant), to find/remove it. */
  isDeclLine(line: string): boolean;
  /**
   * The init-block line(s) emitted once when this peripheral is enabled.
   * `bus` selects the emitted `Init()` content for a peripheral whose mode
   * selection lives in its init line(s) rather than its declared type
   * (FR-DEV-17, e.g. MIDI USB's `INTERNAL`/`EXTERNAL` transport config) —
   * ignored by a peripheral whose Init() call is mode/bus-invariant (sdcard,
   * oled, whose bus only affects declLine()'s declared type).
   */
  initLines(bus?: string): string[];
  /** Matches a line produced by initLines(), to find/remove it. */
  isInitLine(line: string): boolean;
  /**
   * For a multi-bus peripheral only (FR-DEV-14): extracts which bus an
   * existing declLine() output encodes, so the currently-selected bus can be
   * read back from source text — the same "source is the source of truth"
   * convention every other peripheral/control state uses. Undefined for a
   * single-bus peripheral, whose bus never varies.
   */
  busOfDeclLine?(line: string): string | null;
}
