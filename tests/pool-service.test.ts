import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LeaseRecord } from '../src/types.js';
import { PoolService } from '../src/pool-service.js';

describe('PoolService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('调用普通工具时缺少 CODEX_THREAD_ID 会回退到当前服务实例会话标识', async () => {
    const acquire = vi.fn().mockResolvedValue({
      slotId: 1,
      threadId: 'playwright-pool:server-1',
      ownerPid: 321,
      acquiredAt: '2026-03-06T00:00:00.000Z',
      lastHeartbeatAt: '2026-03-06T00:00:00.000Z',
      configPath: '/tmp/playwright-pool.local.toml'
    });
    const callTool = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }]
    });
    const service = new PoolService({
      sessionKeyEnv: 'CODEX_THREAD_ID',
      sessionFallbackKey: 'playwright-pool:server-1',
      leaseManager: {
        acquire,
        heartbeat: vi.fn(),
        releaseOwnedByPid: vi.fn(),
        list: vi.fn().mockResolvedValue([])
      },
      slotRuntime: {
        callTool
      }
    });

    const result = await service.callTool(
      {
        name: 'browser_navigate',
        arguments: { url: 'https://example.com' }
      },
      {}
    );

    expect(acquire).toHaveBeenCalledWith('playwright-pool:server-1', process.pid);
    expect(callTool).toHaveBeenCalledWith(1, 'browser_navigate', { url: 'https://example.com' });
    expect(result.content[0]?.text).toBe('ok');
  });

  it('pool_status 不需要会话绑定，直接返回当前租约状态', async () => {
    const leases: LeaseRecord[] = [
      {
        slotId: 1,
        threadId: 'thread-a',
        ownerPid: 123,
        acquiredAt: '2026-03-06T00:00:00.000Z',
        lastHeartbeatAt: '2026-03-06T00:00:05.000Z',
        configPath: '/tmp/playwright-pool.local.toml'
      }
    ];
    const service = new PoolService({
      sessionKeyEnv: 'CODEX_THREAD_ID',
      sessionFallbackKey: 'playwright-pool:server-1',
      leaseManager: {
        acquire: vi.fn(),
        heartbeat: vi.fn(),
        releaseOwnedByPid: vi.fn(),
        list: vi.fn().mockResolvedValue(leases)
      },
      slotRuntime: {
        callTool: vi.fn()
      }
    });

    const result = await service.callTool({ name: 'pool_status', arguments: {} }, {});

    expect(result.structuredContent).toEqual({
      leases,
      runtimeStatuses: []
    });
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('slot 1');
  });

  it('调用普通工具时会先分配 slot 再转发给对应 runtime', async () => {
    const acquire = vi.fn().mockResolvedValue({
      slotId: 2,
      threadId: 'thread-a',
      ownerPid: 321,
      acquiredAt: '2026-03-06T00:00:00.000Z',
      lastHeartbeatAt: '2026-03-06T00:00:00.000Z',
      configPath: '/tmp/playwright-pool.local.toml'
    });
    const callTool = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'ok'
        }
      ]
    });

    const service = new PoolService({
      sessionKeyEnv: 'CODEX_THREAD_ID',
      sessionFallbackKey: 'playwright-pool:server-1',
      leaseManager: {
        acquire,
        heartbeat: vi.fn(),
        releaseOwnedByPid: vi.fn(),
        list: vi.fn().mockResolvedValue([])
      },
      slotRuntime: {
        callTool
      }
    });

    const result = await service.callTool(
      {
        name: 'browser_snapshot',
        arguments: {}
      },
      {
        CODEX_THREAD_ID: 'thread-a'
      }
    );

    expect(acquire).toHaveBeenCalledWith('thread-a', process.pid);
    expect(callTool).toHaveBeenCalledWith(2, 'browser_snapshot', {});
    expect(result.content[0]?.text).toBe('ok');
  });

  it('拿到 slot 后会按心跳间隔续租，并在关闭时释放当前进程租约', async () => {
    vi.useFakeTimers();

    const heartbeat = vi.fn().mockResolvedValue(null);
    const releaseOwnedByPid = vi.fn().mockResolvedValue(undefined);
    const service = new PoolService({
      sessionKeyEnv: 'CODEX_THREAD_ID',
      sessionFallbackKey: 'playwright-pool:server-1',
      heartbeatSeconds: 1,
      leaseManager: {
        acquire: vi.fn().mockResolvedValue({
          slotId: 1,
          threadId: 'thread-a',
          ownerPid: process.pid,
          acquiredAt: '2026-03-06T00:00:00.000Z',
          lastHeartbeatAt: '2026-03-06T00:00:00.000Z',
          configPath: '/tmp/playwright-pool.local.toml'
        }),
        heartbeat,
        releaseOwnedByPid,
        list: vi.fn().mockResolvedValue([])
      },
      slotRuntime: {
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'ok' }]
        })
      }
    });

    await service.callTool(
      {
        name: 'browser_snapshot',
        arguments: {}
      },
      {
        CODEX_THREAD_ID: 'thread-a'
      }
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(heartbeat).toHaveBeenCalledWith(1);

    await service.shutdown();
    expect(releaseOwnedByPid).toHaveBeenCalledWith(process.pid);
  });
});
