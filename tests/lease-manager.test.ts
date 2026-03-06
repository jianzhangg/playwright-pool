import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LeaseManager } from '../src/lease-manager.js';
import type { PoolConfig } from '../src/types.js';

describe('LeaseManager', () => {
  let rootDir: string;
  let poolConfig: PoolConfig;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'playwright-pool-test-'));
    poolConfig = {
      size: 2,
      profileDirTemplate: join(rootDir, 'profiles/{id}'),
      outputDirTemplate: join(rootDir, 'output/{id}'),
      leaseDir: join(rootDir, 'leases'),
      logsDir: join(rootDir, 'logs'),
      heartbeatSeconds: 5,
      staleLeaseSeconds: 30,
      sessionKeyEnv: 'CODEX_THREAD_ID'
    };
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it('同一个 threadId 重复获取时复用已有 slot', async () => {
    const manager = new LeaseManager(poolConfig, '/tmp/config.toml');

    const firstLease = await manager.acquire('thread-a', 1001);
    const secondLease = await manager.acquire('thread-a', 1002);

    expect(firstLease.slotId).toBe(1);
    expect(secondLease.slotId).toBe(1);
    expect(secondLease.ownerPid).toBe(1002);
  });

  it('同一个 threadId 重连后会更新 ownerPid，新的进程可以释放 slot', async () => {
    const manager = new LeaseManager(poolConfig, '/tmp/config.toml');

    await manager.acquire('thread-a', 1001);
    await manager.acquire('thread-a', 1002);
    await manager.releaseOwnedByPid(1002);

    await expect(manager.list()).resolves.toEqual([]);
  });

  it('没有可用 slot 时抛出明确错误', async () => {
    const manager = new LeaseManager(poolConfig, '/tmp/config.toml');

    await manager.acquire('thread-a', 1001);
    await manager.acquire('thread-b', 1002);

    await expect(manager.acquire('thread-c', 1003)).rejects.toThrow(/没有可用 Playwright 资源/);
  });

  it('陈旧租约会被新会话回收', async () => {
    const manager = new LeaseManager(
      {
        ...poolConfig,
        staleLeaseSeconds: 0
      },
      '/tmp/config.toml'
    );

    await manager.acquire('thread-a', 1001);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const recycledLease = await manager.acquire('thread-b', 1002);

    expect(recycledLease.slotId).toBe(1);
    expect(recycledLease.threadId).toBe('thread-b');
  });
});
