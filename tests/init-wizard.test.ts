import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { runInitWizard } from '../src/init-wizard.js';

type TestIO = {
  readLine: (prompt: string) => Promise<string>;
  writeLine: (message: string) => void;
};

function createTestIO(answers: string[]): { io: TestIO; writes: string[] } {
  const queue = [...answers];
  const writes: string[] = [];

  return {
    io: {
      readLine: vi.fn(async () => queue.shift() ?? ''),
      writeLine: vi.fn((message: string) => {
        writes.push(message);
      })
    },
    writes
  };
}

describe('runInitWizard', () => {
  it('选择 Chrome 并接受探测到的默认 profile 与运行目录', async () => {
    const { io, writes } = createTestIO(['1', '1', '', '', '1']);
    const result = await runInitWizard(io, {}, {
      detectBrowserProfileDir: vi.fn().mockResolvedValue('C:/Users/alice/AppData/Local/Google/Chrome/User Data'),
      detectBrowserExecutablePath: vi.fn().mockResolvedValue('C:/Program Files/Google/Chrome/Application/chrome.exe'),
      resolveDefaultRuntimeRoot: vi.fn().mockReturnValue('D:/Users/alice/Documents/playwright-pool'),
      pathExists: vi.fn().mockResolvedValue(true)
    });

    expect(result).toEqual({
      browser: 'chrome',
      browserChannel: 'chrome',
      browserExecutablePath: path.resolve('C:/Program Files/Google/Chrome/Application/chrome.exe'),
      configPath: path.join(path.resolve('D:/Users/alice/Documents/playwright-pool'), 'config.toml'),
      runtimeRoot: path.resolve('D:/Users/alice/Documents/playwright-pool'),
      sourceProfileDir: path.resolve('C:/Users/alice/AppData/Local/Google/Chrome/User Data'),
      size: 10
    });
    expect(writes.some((line) => line.includes('浏览器数据目录'))).toBe(true);
    expect(writes.some((line) => line.includes('浏览器副本数量'))).toBe(true);
    expect(writes.every((line) => !line.includes('请选择 profile 来源'))).toBe(true);
  });

  it('选择 Edge 且探测不到默认 profile 时允许手动输入', async () => {
    const { io } = createTestIO(['2', 'D:/Profiles/Edge', '', '', '1']);
    const result = await runInitWizard(io, {}, {
      detectBrowserProfileDir: vi.fn().mockResolvedValue(null),
      detectBrowserExecutablePath: vi.fn().mockResolvedValue('C:/Program Files/Microsoft/Edge/Application/msedge.exe'),
      resolveDefaultRuntimeRoot: vi.fn().mockReturnValue('D:/Users/alice/Documents/playwright-pool'),
      pathExists: vi.fn(async (candidate: string) => candidate === path.resolve('D:/Profiles/Edge'))
    });

    expect(result).toEqual({
      browser: 'edge',
      browserChannel: 'msedge',
      browserExecutablePath: path.resolve('C:/Program Files/Microsoft/Edge/Application/msedge.exe'),
      configPath: path.join(path.resolve('D:/Users/alice/Documents/playwright-pool'), 'config.toml'),
      runtimeRoot: path.resolve('D:/Users/alice/Documents/playwright-pool'),
      sourceProfileDir: path.resolve('D:/Profiles/Edge'),
      size: 10
    });
  });

  it('slot 数量非法时会重新提示直到输入正整数', async () => {
    const { io } = createTestIO(['1', '1', '', '0', '3', '1']);
    const result = await runInitWizard(io, {}, {
      detectBrowserProfileDir: vi.fn().mockResolvedValue('C:/Users/alice/AppData/Local/Google/Chrome/User Data'),
      detectBrowserExecutablePath: vi.fn().mockResolvedValue('C:/Program Files/Google/Chrome/Application/chrome.exe'),
      resolveDefaultRuntimeRoot: vi.fn().mockReturnValue('D:/Users/alice/Documents/playwright-pool'),
      pathExists: vi.fn().mockResolvedValue(true)
    });

    expect(result?.size).toBe(3);
  });

  it('汇总确认时取消会返回 null', async () => {
    const { io, writes } = createTestIO(['1', '1', '', '', '2']);
    const result = await runInitWizard(io, {}, {
      detectBrowserProfileDir: vi.fn().mockResolvedValue('C:/Users/alice/AppData/Local/Google/Chrome/User Data'),
      detectBrowserExecutablePath: vi.fn().mockResolvedValue('C:/Program Files/Google/Chrome/Application/chrome.exe'),
      resolveDefaultRuntimeRoot: vi.fn().mockReturnValue('D:/Users/alice/Documents/playwright-pool'),
      pathExists: vi.fn().mockResolvedValue(true)
    });

    expect(result).toBeNull();
    expect(writes.some((line) => line.includes('已取消'))).toBe(true);
  });
});
