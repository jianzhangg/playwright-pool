import { describe, expect, it, vi } from 'vitest';

import { ensureProfileDirClosed } from '../src/profile-usage.js';

describe('ensureProfileDirClosed', () => {
  it('在 win32 上检测不到浏览器进程时允许继续', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: 'INFO: No tasks are running which match the specified criteria.\r\n',
      stderr: ''
    });

    await expect(
      ensureProfileDirClosed('C:/Users/alice/AppData/Local/Microsoft/Edge/User Data', {
        platform: 'win32',
        execFile
      })
    ).resolves.toBeUndefined();

    expect(execFile).toHaveBeenCalledWith('tasklist', ['/FI', 'IMAGENAME eq msedge.exe']);
  });

  it('在 win32 上检测到浏览器进程仍存在时抛出清晰错误', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: 'msedge.exe                   1234 Console                    1    200,000 K\r\n',
      stderr: ''
    });

    await expect(
      ensureProfileDirClosed('C:/Users/alice/AppData/Local/Microsoft/Edge/User Data', {
        platform: 'win32',
        execFile
      })
    ).rejects.toThrow(/Microsoft Edge/);
  });

  it('在非 win32 上 pgrep 返回退出码 1 时视为未占用', async () => {
    const execFile = vi.fn().mockRejectedValue({
      code: 1,
      stderr: ''
    });

    await expect(
      ensureProfileDirClosed('/Users/alice/Library/Application Support/Google/Chrome', {
        platform: 'darwin',
        execFile
      })
    ).resolves.toBeUndefined();

    expect(execFile).toHaveBeenCalledWith('pgrep', ['-f', '/Users/alice/Library/Application Support/Google/Chrome']);
  });
});