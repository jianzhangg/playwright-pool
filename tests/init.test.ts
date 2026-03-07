import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderDefaultConfig } from '../src/init.js';
import {
  detectBrowserExecutablePath,
  detectBrowserProfileDir,
  resolveDefaultRuntimeRoot
} from '../src/profile-source.js';
import { resolveDefaultConfigPath } from '../src/playwright-config.js';

function joinForPlatform(platform: NodeJS.Platform, ...segments: string[]): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return pathApi.join(...segments);
}

describe('playwright_pool init defaults', () => {
  it('默认配置文件会跟随目标平台的 Documents 目录', () => {
    const runtimeRoot = joinForPlatform('darwin', '/Users/alice', 'Documents', 'playwright-pool');
    const configPath = joinForPlatform('darwin', runtimeRoot, 'config.toml');

    expect(resolveDefaultRuntimeRoot({ homeDir: '/Users/alice', platform: 'darwin' })).toBe(runtimeRoot);
    expect(resolveDefaultConfigPath({ homeDir: '/Users/alice', platform: 'darwin' })).toBe(configPath);
  });

  it('Windows 默认运行目录会优先使用当前真实 Documents 目录', () => {
    expect(
      resolveDefaultRuntimeRoot({
        homeDir: 'C:/Users/alice',
        platform: 'win32',
        env: {
          USERPROFILE: 'C:/Users/alice'
        } as NodeJS.ProcessEnv,
        resolveWindowsDocumentsPath: () => 'D:/Users/alice/Documents'
      })
    ).toBe(joinForPlatform('win32', 'D:/Users/alice/Documents', 'playwright-pool'));
  });

  it('能探测 macOS 下默认的 Chrome profile 目录', async () => {
    const expected = joinForPlatform('darwin', '/Users/alice', 'Library/Application Support/Google/Chrome');
    const found = await detectBrowserProfileDir('chrome', {
      homeDir: '/Users/alice',
      platform: 'darwin',
      pathExists: async (candidate) => candidate === expected
    });

    expect(found).toBe(expected);
  });

  it('能探测 macOS 下默认的 Chrome 可执行文件', async () => {
    const found = await detectBrowserExecutablePath('chrome', {
      platform: 'darwin',
      pathExists: async (candidate) => candidate === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });

    expect(found).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });

  it('生成默认配置时会保留 slot 数量、源 profile 与浏览器 channel', () => {
    const runtimeRoot = path.join('C:/Users/alice', 'Documents', 'playwright-pool');
    const sourceProfileDir = path.join('C:/Users/alice', 'AppData/Local/Google/Chrome/User Data');
    const rendered = renderDefaultConfig({
      runtimeRoot,
      sourceProfileDir,
      size: 10,
      browserChannel: 'chrome'
    });

    expect(rendered).toContain('size = 10');
    expect(rendered).toContain(`sourceProfileDir = "${sourceProfileDir}"`);
    expect(rendered).toContain(`profileDirTemplate = "${path.join(runtimeRoot, 'profiles/{id}')}"`);
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
