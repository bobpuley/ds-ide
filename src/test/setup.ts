import { afterEach } from 'vitest';

// FR-EXT-1: fail loudly on any unobserved promise rejection during a test,
// instead of letting it disappear as a silent Node warning. Deploy failures
// in particular must never leak an unhandledRejection.
let unhandledRejections: unknown[] = [];

process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason);
});

afterEach(() => {
  const pending = unhandledRejections;
  unhandledRejections = [];
  if (pending.length > 0) {
    throw new Error(
      `Unhandled promise rejection(s) during test: ${pending.map(String).join('; ')}`,
    );
  }
});
