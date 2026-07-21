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
