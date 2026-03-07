import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export type ServerLogFields = Record<string, unknown>;

export interface ServerLoggerLike {
  info(event: string, fields?: ServerLogFields): void;
  error(event: string, fields?: ServerLogFields): void;
}

export interface ServerLogger extends ServerLoggerLike {
  close(): Promise<void>;
}

export const noopServerLogger: ServerLogger = {
  info: () => undefined,
  error: () => undefined,
  close: async () => undefined
};

export function measureSerializedBytes(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return Buffer.byteLength(serialized ?? 'null', 'utf8');
  } catch {
    return -1;
  }
}

export async function createServerLogger(logsDir: string, pid = process.pid): Promise<{ logFile: string; logger: ServerLogger }> {
  await mkdir(logsDir, { recursive: true });
  const logFile = buildServerLogPath(logsDir, pid);
  const stream = createWriteStream(logFile, { flags: 'a' });
  return {
    logFile,
    logger: new FileServerLogger(stream, pid)
  };
}

class FileServerLogger implements ServerLogger {
  constructor(
    private readonly stream: WriteStream,
    private readonly pid: number
  ) {}

  info(event: string, fields: ServerLogFields = {}): void {
    this.write('info', event, fields);
  }

  error(event: string, fields: ServerLogFields = {}): void {
    this.write('error', event, fields);
  }

  async close(): Promise<void> {
    if (this.stream.destroyed || this.stream.closed) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.stream.end(() => resolve());
    });
  }

  private write(level: 'info' | 'error', event: string, fields: ServerLogFields): void {
    const mergedFields: ServerLogFields = {
      pid: this.pid,
      ...fields,
      ...formatMemoryFields()
    };
    const serializedFields = Object.entries(mergedFields)
      .map(([key, value]) => serializeField(key, value))
      .filter((entry): entry is string => entry !== null);
    const line = [
      new Date().toISOString(),
      `level=${level}`,
      `event=${event}`,
      ...serializedFields
    ].join(' ');

    this.stream.write(`${line}\n`);
  }
}

function buildServerLogPath(logsDir: string, pid: number): string {
  return resolvePathApi(logsDir).join(logsDir, `server-${pid}.log`);
}

function resolvePathApi(samplePath: string): typeof path.posix | typeof path.win32 {
  return /^[A-Za-z]:[\\/]/.test(samplePath) || samplePath.includes('\\') ? path.win32 : path.posix;
}

function formatMemoryFields(): ServerLogFields {
  const usage = process.memoryUsage();
  return {
    rssMB: formatMegabytes(usage.rss),
    heapUsedMB: formatMegabytes(usage.heapUsed),
    externalMB: formatMegabytes(usage.external)
  };
}

function formatMegabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

function serializeField(key: string, value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return `${key}=${serializeValue(value)}`;
}

function serializeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (value instanceof Error) {
    return JSON.stringify(value.stack ?? value.message);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}
