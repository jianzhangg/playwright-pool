import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { renderDefaultConfig } from '../src/init.js';
import {
  detectChromeExecutablePath,
  detectChromeProfileDir,
  resolveDefaultRuntimeRoot
} from '../src/profile-source.js';
import { resolveDefaultConfigPath } from '../src/playwright-config.js';

describe('playwright_pool init defaults', () => {
  it('默认配置文件落在 Documents/playwright-pool/config.toml', () => {
    expect(resolveDefaultRuntimeRoot('/Users/alice')).toBe('/Users/alice/Documents/playwright-pool');
    expect(resolveDefaultConfigPath('/Users/alice')).toBe('/Users/alice/Documents/playwright-pool/config.toml');
  });

  it('能探测 macOS 下默认的 Chrome profile 目录', async () => {
    const found = await detectChromeProfileDir({
      homeDir: '/Users/alice',
      platform: 'darwin',
      pathExists: async (candidate) => candidate === '/Users/alice/Library/Application Support/Google/Chrome'
    });

    expect(found).toBe('/Users/alice/Library/Application Support/Google/Chrome');
  });

  it('能探测 macOS 下默认的 Chrome 可执行文件', async () => {
    const found = await detectChromeExecutablePath({
      platform: 'darwin',
      pathExists: async (candidate) => candidate === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });

    expect(found).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('生成默认配置时保留 10 个 slot 和 Chrome channel', () => {
    const rendered = renderDefaultConfig({
      runtimeRoot: '/Users/alice/Documents/playwright-pool',
      sourceProfileDir: '/Users/alice/Library/Application Support/Google/Chrome',
      size: 10
    });

    expect(rendered).toContain('size = 10');
    expect(rendered).toContain('sourceProfileDir = "/Users/alice/Library/Application Support/Google/Chrome"');
    expect(rendered).toContain('profileDirTemplate = "/Users/alice/Documents/playwright-pool/profiles/{id}"');
    expect(rendered).toContain('channel = "chrome"');
    expect(rendered).toContain('headless = false');
  });

  it('导入 init 模块时不应触发 prepare-profiles CLI 入口', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/init.ts")'],
      {
        cwd: process.cwd(),
        encoding: 'utf8'
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe('');
  });
});
