import { describe, expect, it } from 'vitest';

import { selectWindowsProfileBrowserPids } from '../src/profile-process.js';

describe('profile-process', () => {
  it('Windows 下只挑出当前 profile 的 Edge/Chrome 进程', () => {
    const profileDir = 'D:\\Users\\jianzhangg\\Documents\\playwright-pool\\profiles\\1';
    const pids = selectWindowsProfileBrowserPids(profileDir, [
      {
        pid: 100,
        name: 'msedge.exe',
        commandLine: '"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" --user-data-dir="D:\\Users\\jianzhangg\\Documents\\playwright-pool\\profiles\\1"'
      },
      {
        pid: 101,
        name: 'chrome.exe',
        commandLine: 'chrome.exe --user-data-dir=D:\\Users\\jianzhangg\\Documents\\playwright-pool\\profiles\\1 --remote-debugging-port=0'
      },
      {
        pid: 102,
        name: 'msedge.exe',
        commandLine: 'msedge.exe --user-data-dir=D:\\Users\\jianzhangg\\Documents\\playwright-pool\\profiles\\2'
      },
      {
        pid: 103,
        name: 'Code.exe',
        commandLine: 'Code.exe'
      },
      {
        pid: 104,
        name: 'chrome.exe',
        commandLine: null
      }
    ]);

    expect(pids).toEqual([100, 101]);
  });

  it('路径大小写和斜杠差异不影响 profile 匹配', () => {
    const pids = selectWindowsProfileBrowserPids('D:/Users/JianZhangg/Documents/playwright-pool/profiles/1', [
      {
        pid: 200,
        name: 'msedge.exe',
        commandLine: 'msedge.exe --user-data-dir="d:\\users\\jianzhangg\\documents\\playwright-pool\\profiles\\1"'
      }
    ]);

    expect(pids).toEqual([200]);
  });
});
