import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { initializePlaywrightPool, renderDefaultConfig } from '../src/init.js';
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

  it('生成默认配置时支持 Edge channel', () => {
    const runtimeRoot = path.join('C:/Users/alice', 'Documents', 'playwright-pool');
    const sourceProfileDir = path.join('C:/Users/alice', 'AppData/Local/Microsoft/Edge/User Data');
    const rendered = renderDefaultConfig({
      runtimeRoot,
      sourceProfileDir,
      size: 3,
      browserChannel: 'msedge'
    });

    expect(rendered).toContain('size = 3');
    expect(rendered).toContain(`sourceProfileDir = "${sourceProfileDir}"`);
    expect(rendered).toContain('channel = "msedge"');
  });

  it('initializePlaywrightPool 会消费交互确认后的浏览器与 profile 参数', async () => {
    const configPath = path.resolve('C:/temp/playwright-pool/config.toml');
    const runtimeRoot = path.dirname(configPath);
    const sourceProfileDir = 'D:/profiles/edge';
    const resolvedSourceProfileDir = path.resolve(sourceProfileDir);
    const browserExecutablePath = 'C:/Program Files/Microsoft/Edge/Application/msedge.exe';
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const loadPoolConfig = vi.fn().mockResolvedValue({
      pool: {
        size: 2
      },
      playwright: {}
    });
    const prepareProfiles = vi.fn().mockResolvedValue(undefined);
    const ensureProfileDirClosed = vi.fn().mockResolvedValue(undefined);
    const pathExists = vi.fn().mockResolvedValue(true);
    const removeDirRobustly = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();

    const result = await initializePlaywrightPool(
      {
        configPath,
        force: true,
        size: 2,
        browser: 'edge',
        browserChannel: 'msedge',
        sourceProfileDir,
        browserExecutablePath,
        onProgress
      },
      {
        mkdir,
        writeFile,
        loadPoolConfig,
        prepareProfiles,
        ensureProfileDirClosed,
        pathExists,
        removeDirRobustly
      }
    );

    expect(ensureProfileDirClosed).toHaveBeenCalledWith(resolvedSourceProfileDir);
    expect(mkdir).toHaveBeenCalledWith(runtimeRoot, { recursive: true });
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0]?.[0]).toBe(configPath);
    expect(writeFile.mock.calls[0]?.[1]).toContain('channel = "msedge"');
    expect(writeFile.mock.calls[0]?.[1]).toContain(`sourceProfileDir = "${resolvedSourceProfileDir}"`);
    expect(writeFile.mock.calls[0]?.[2]).toEqual({
      encoding: 'utf8',
      flag: 'w'
    });
    expect(loadPoolConfig).toHaveBeenCalledWith(configPath);
    expect(prepareProfiles).toHaveBeenCalledWith(
      {
        pool: {
          size: 2
        },
        playwright: {}
      },
      resolvedSourceProfileDir,
      expect.objectContaining({
        onProgress: expect.any(Function)
      })
    );
    expect(onProgress).toHaveBeenCalledWith('第 1 步/4：检查浏览器是否已完全关闭');
    expect(onProgress).toHaveBeenCalledWith('第 2 步/4：写入初始化配置');
    expect(onProgress).toHaveBeenCalledWith('第 3 步/4：准备浏览器副本');
    expect(onProgress).toHaveBeenCalledWith('第 4 步/4：初始化完成');
    expect(removeDirRobustly).not.toHaveBeenCalled();
    expect(result).toEqual({
      configPath,
      runtimeRoot,
      sourceProfileDir: resolvedSourceProfileDir,
      browserExecutablePath,
      browser: 'edge',
      size: 2
    });
  });

  it('浏览器仍占用时会在写配置前失败，并提示用户先关闭浏览器', async () => {
    const configPath = path.resolve('/tmp/playwright-pool/config.toml');
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const ensureProfileDirClosed = vi.fn().mockRejectedValue(new Error('检测到 profile 仍在使用中'));

    await expect(
      initializePlaywrightPool(
        {
          configPath,
          browser: 'chrome',
          sourceProfileDir: '/tmp/source'
        },
        {
          mkdir,
          writeFile,
          ensureProfileDirClosed
        }
      )
    ).rejects.toThrow(/请先完全关闭浏览器/);

    expect(writeFile).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('首次初始化在复制阶段失败时会清理当前新建的运行目录', async () => {
    const configPath = path.resolve('/tmp/playwright-pool/config.toml');
    const runtimeRoot = path.dirname(configPath);
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const ensureProfileDirClosed = vi.fn().mockResolvedValue(undefined);
    const pathExists = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    const removeDirRobustly = vi.fn().mockResolvedValue(undefined);
    const loadPoolConfig = vi.fn().mockResolvedValue({
      pool: {
        size: 2
      },
      playwright: {}
    });
    const prepareProfiles = vi.fn().mockRejectedValue(new Error('复制失败'));

    await expect(
      initializePlaywrightPool(
        {
          configPath,
          browser: 'chrome',
          sourceProfileDir: '/tmp/source'
        },
        {
          mkdir,
          writeFile,
          ensureProfileDirClosed,
          pathExists,
          removeDirRobustly,
          loadPoolConfig,
          prepareProfiles
        }
      )
    ).rejects.toThrow(/已清理本次新建文件|复制失败/);

    expect(removeDirRobustly).toHaveBeenCalledWith(runtimeRoot);
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
