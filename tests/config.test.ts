import { describe, expect, it } from 'vitest';

import { buildSlotPaths, loadPoolConfig } from '../src/config.js';

describe('loadPoolConfig', () => {
  it('解析 pool 和 playwright 配置，并展开 slot 路径模板', async () => {
    const config = await loadPoolConfig(new URL('./fixtures/basic-config.toml', import.meta.url));

    expect(config.pool.size).toBe(3);
    expect(config.pool.sessionKeyEnv).toBe('CODEX_THREAD_ID');
    expect(config.pool.sourceProfileDir).toBe('/tmp/pw/source');
    expect(
      (config.playwright.browser as { launchOptions?: { channel?: string } } | undefined)?.launchOptions?.channel
    ).toBe('msedge');
    expect(buildSlotPaths(config.pool, 2)).toEqual({
      profileDir: '/tmp/pw/profiles/2',
      outputDir: '/tmp/pw/output/2',
      logFile: '/tmp/pw/logs/slot-2.log',
      leaseFile: '/tmp/pw/leases/slot-2.json',
      lockDir: '/tmp/pw/leases/slot-2.lock'
    });
  });

  it('缺少必须的 pool 字段时抛出清晰错误', async () => {
    await expect(
      loadPoolConfig(new URL('./fixtures/invalid-config.toml', import.meta.url))
    ).rejects.toThrow(/profileDirTemplate/);
  });
});
