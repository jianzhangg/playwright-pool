import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectBrowserExecutablePath,
  detectBrowserProfileDir,
  inferBrowserProcessName,
  listBrowserExecutableCandidates,
  listBrowserProfileCandidates,
  resolveDefaultRuntimeRoot
} from '../src/profile-source.js';

function joinForPlatform(platform: NodeJS.Platform, ...segments: string[]): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return pathApi.join(...segments);
}

describe('inferBrowserProcessName', () => {
  it('微软 Edge 的用户目录会映射到 Microsoft Edge 进程名', () => {
    expect(
      inferBrowserProcessName('/Users/alice/Library/Application Support/Microsoft Edge')
    ).toBe('Microsoft Edge');
  });

  it('Google Chrome 的用户目录会映射到 Google Chrome 进程名', () => {
    expect(
      inferBrowserProcessName('/Users/alice/Library/Application Support/Google/Chrome')
    ).toBe('Google Chrome');
  });

  it('未知目录退化为目录名，方便手动传入自定义 profile 源', () => {
    expect(inferBrowserProcessName('/tmp/custom-browser-profile')).toBe('custom-browser-profile');
  });
});

describe('browser source resolution', () => {
  it('会按浏览器和平台返回 profile 候选目录', () => {
    expect(listBrowserProfileCandidates('chrome', '/Users/alice', 'darwin')).toEqual([
      joinForPlatform('darwin', '/Users/alice', 'Library/Application Support/Google/Chrome')
    ]);
    expect(listBrowserProfileCandidates('edge', 'C:/Users/alice', 'win32')).toEqual([
      joinForPlatform('win32', 'C:/Users/alice', 'AppData/Local/Microsoft/Edge/User Data')
    ]);
  });

  it('会按浏览器和平台返回可执行文件候选路径', () => {
    expect(
      listBrowserExecutableCandidates('edge', {
        platform: 'win32',
        env: {
          PROGRAMFILES: 'C:/Program Files',
          'PROGRAMFILES(X86)': 'C:/Program Files (x86)',
          LOCALAPPDATA: 'D:/Users/alice/AppData/Local'
        } as NodeJS.ProcessEnv
      })
    ).toContain(joinForPlatform('win32', 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'));

    expect(listBrowserExecutableCandidates('chrome', { platform: 'darwin' })).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ]);
  });

  it('会按浏览器类型探测第一个存在的 profile 目录', async () => {
    const expected = joinForPlatform('win32', 'C:/Users/alice', 'AppData/Local/Microsoft/Edge/User Data');
    const found = await detectBrowserProfileDir('edge', {
      homeDir: 'C:/Users/alice',
      platform: 'win32',
      pathExists: async (candidate) => candidate === expected
    });

    expect(found).toBe(expected);
  });

  it('会按浏览器类型探测第一个存在的可执行文件', async () => {
    const expected = joinForPlatform('win32', 'D:/Users/alice/AppData/Local', 'Google/Chrome/Application/chrome.exe');
    const found = await detectBrowserExecutablePath('chrome', {
      platform: 'win32',
      env: {
        PROGRAMFILES: 'C:/Program Files',
        'PROGRAMFILES(X86)': 'C:/Program Files (x86)',
        LOCALAPPDATA: 'D:/Users/alice/AppData/Local'
      } as NodeJS.ProcessEnv,
      pathExists: async (candidate) => candidate === expected
    });

    expect(found).toBe(expected);
  });

  it('Windows 默认运行目录会优先跟随真实 Documents 位置', () => {
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

  it('Windows 在取不到真实 Documents 时回退到 USERPROFILE/Documents', () => {
    expect(
      resolveDefaultRuntimeRoot({
        homeDir: 'C:/Users/alice',
        platform: 'win32',
        env: {
          USERPROFILE: 'D:/Users/alice'
        } as NodeJS.ProcessEnv,
        resolveWindowsDocumentsPath: () => null
      })
    ).toBe(joinForPlatform('win32', 'D:/Users/alice', 'Documents', 'playwright-pool'));
  });
});
