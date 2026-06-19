export type DeviceKind = 'pot' | 'button' | 'led';

const BEGIN = '// ds-ide:controls:begin';
const END   = '// ds-ide:controls:end';

const TYPE_NAMES: Record<DeviceKind, string> = {
  pot:    'AdcChannelConfig',
  button: 'Switch',
  led:    'Led',
};

export function declarationLine(id: string, kind: DeviceKind, pin: number): string {
  return `${TYPE_NAMES[kind]} ${id}; // ds-ide: id=${id}, kind=${kind}, pin=${pin}`;
}

// Pure: insert declaration into source text. Returns modified text.
export function insertIntoSource(source: string, id: string, kind: DeviceKind, pin: number): string {
  const decl  = declarationLine(id, kind, pin);
  const lines  = source.split('\n');
  const endIdx = lines.findIndex(l => l.replace(/\r$/, '') === END);
  const begIdx = lines.findIndex(l => l.replace(/\r$/, '') === BEGIN);

  if (begIdx === -1 || endIdx === -1 || endIdx <= begIdx) {
    // Block absent — append to end of file
    const trimmed = source.replace(/\n+$/, '');
    return `${trimmed}\n${BEGIN}\n${decl}\n${END}\n`;
  }

  const result = [...lines];
  result.splice(endIdx, 0, decl);
  return result.join('\n');
}

// Pure: remove declaration with the given id. Returns modified text.
export function removeFromSource(source: string, id: string): string {
  const ANNOTATION = /\/\/ ds-ide:\s*id=(\S+),\s*kind=(pot|button|led),\s*pin=(\d+)/;
  return source
    .split('\n')
    .filter(line => {
      const m = ANNOTATION.exec(line);
      return !(m && m[1] === id);
    })
    .join('\n');
}
