// Buffers `child_process` stdout/stderr chunks and emits complete lines only,
// carrying an incomplete trailing segment over to the next chunk instead of
// splitting on '\n' per-chunk (which drops/misreports text split across a
// chunk boundary). Each stream (stdout, stderr) needs its own instance.
export interface LineSplitter {
  push(data: Buffer): void;
  // Emits a pending unterminated trailing segment, e.g. on stream close.
  flush(): void;
}

export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  let carry = '';
  return {
    push(data: Buffer): void {
      carry += data.toString('utf8');
      const lines = carry.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    },
    flush(): void {
      if (carry.trim()) onLine(carry);
      carry = '';
    },
  };
}
