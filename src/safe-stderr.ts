import process from 'node:process';

export type StderrWriter = {
  write: (chunk: string) => unknown;
  destroyed?: boolean;
  closed?: boolean;
  writable?: boolean;
  writableEnded?: boolean;
};

export function isBrokenPipeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const errorLike = error as NodeJS.ErrnoException;
  const code = errorLike.code;
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'ERR_STREAM_WRITE_AFTER_END') {
    return true;
  }

  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /broken pipe|write after end|stream destroyed/i.test(message);
}

export function safeStderrWrite(
  message: string,
  options: {
    writer?: StderrWriter;
  } = {}
): void {
  const writer = options.writer ?? process.stderr;
  if (!writer || typeof writer.write !== 'function') {
    return;
  }

  if (writer.destroyed || writer.closed || writer.writable === false || writer.writableEnded) {
    return;
  }

  try {
    writer.write(message);
  } catch (error) {
    if (isBrokenPipeError(error)) {
      return;
    }
    throw error;
  }
}
