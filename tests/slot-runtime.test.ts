import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const transports: unknown[] = [];
  const clients: unknown[] = [];
  let nextPid = 1000;

  class FakeTransport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;
    readonly pid: number;
    readonly stderr = null;

    constructor(_params: unknown) {
      this.pid = nextPid;
      nextPid += 1;
      transports.push(this);
    }

    async start(): Promise<void> {
      return undefined;
    }

    async close(): Promise<void> {
      this.onclose?.();
    }

    async send(_message: unknown): Promise<void> {
      return undefined;
    }
  }

  class FakeClient {
    transport: FakeTransport | null = null;

    constructor(..._args: unknown[]) {
      clients.push(this);
    }

    setRequestHandler(): void {
      return undefined;
    }

    async connect(transport: FakeTransport): Promise<void> {
      this.transport = transport;
    }

    async listTools(): Promise<{ tools: [] }> {
      return { tools: [] };
    }

    async callTool(): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
      return {
        content: [{ type: 'text', text: 'ok' }]
      };
    }

    async close(): Promise<void> {
      return undefined;
    }
  }

  const reset = () => {
    transports.length = 0;
    clients.length = 0;
    nextPid = 1000;
  };

  return { transports, clients, reset, FakeTransport, FakeClient };
});

vi.mock('../src/stdio-client-transport.js', () => ({
  StdioClientTransport: mockState.FakeTransport
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mockState.FakeClient
}));

import { SlotRuntime } from '../src/slot-runtime.js';

describe('SlotRuntime', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'slot-runtime-'));
    mockState.reset();
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
    vi.clearAllMocks();
  });

  it('slot 子进程自然关闭后会摘掉当前 handle', async () => {
    const runtime = new SlotRuntime(
      {
        pool: {
          size: 1,
          profileDirTemplate: path.join(rootDir, 'profiles/{id}'),
          outputDirTemplate: path.join(rootDir, 'output/{id}'),
          leaseDir: path.join(rootDir, 'leases'),
          logsDir: path.join(rootDir, 'logs'),
          heartbeatSeconds: 5,
          staleLeaseSeconds: 30,
          sessionKeyEnv: 'CODEX_THREAD_ID'
        },
        playwright: {}
      },
      path.join(rootDir, 'config.toml')
    );

    await runtime.callTool(1, 'browser_snapshot', {}, []);
    expect(runtime.listStatuses()[0]).toMatchObject({ started: true, pid: 1000 });

    (mockState.transports[0] as { onclose?: () => void } | undefined)?.onclose?.();

    expect(runtime.listStatuses()[0]).toMatchObject({ started: false, pid: null });
  });

  it('旧 handle 关闭时不会误删已替换的新 handle', async () => {
    const runtime = new SlotRuntime(
      {
        pool: {
          size: 1,
          profileDirTemplate: path.join(rootDir, 'profiles/{id}'),
          outputDirTemplate: path.join(rootDir, 'output/{id}'),
          leaseDir: path.join(rootDir, 'leases'),
          logsDir: path.join(rootDir, 'logs'),
          heartbeatSeconds: 5,
          staleLeaseSeconds: 30,
          sessionKeyEnv: 'CODEX_THREAD_ID'
        },
        playwright: {}
      },
      path.join(rootDir, 'config.toml')
    );

    await runtime.callTool(1, 'browser_snapshot', {}, [{ uri: 'file:///a', name: 'a' }]);
    const oldTransport = mockState.transports[0] as { onclose?: () => void } | undefined;

    await runtime.callTool(1, 'browser_snapshot', {}, [{ uri: 'file:///b', name: 'b' }]);
    expect(runtime.listStatuses()[0]).toMatchObject({ started: true, pid: 1001 });

    oldTransport?.onclose?.();

    expect(runtime.listStatuses()[0]).toMatchObject({ started: true, pid: 1001 });
  });
});
