import { describe, expect, it, vi } from 'vitest';

import {
  createCleanupOnce,
  isDetachedLauncherChain,
  parsePsOutput,
  startDetachedLauncherWatcher,
  startParentProcessWatcher,
  type ProcessInfo
} from '../src/slot-guardian.js';

describe('slot guardian', () => {
  it('父进程存活时不触发清理', async () => {
    let tick: (() => void) | undefined;
    let cleared = false;
    const onParentExit = vi.fn();

    const stop = startParentProcessWatcher({
      parentPid: 123,
      intervalMs: 1000,
      isProcessAlive: () => true,
      onParentExit,
      setIntervalFn: ((callback: () => void) => {
        tick = callback;
        return {
          unref() {
            return undefined;
          }
        } as unknown as NodeJS.Timeout;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {
        cleared = true;
      }) as typeof clearInterval
    });

    await tick?.();

    expect(onParentExit).not.toHaveBeenCalled();
    expect(cleared).toBe(false);

    stop();
    expect(cleared).toBe(true);
  });

  it('父进程消失时只触发一次清理', async () => {
    let tick: (() => void) | undefined;
    let cleared = 0;
    const onParentExit = vi.fn();

    startParentProcessWatcher({
      parentPid: 123,
      intervalMs: 1000,
      isProcessAlive: () => false,
      onParentExit,
      setIntervalFn: ((callback: () => void) => {
        tick = callback;
        return {
          unref() {
            return undefined;
          }
        } as unknown as NodeJS.Timeout;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {
        cleared += 1;
      }) as typeof clearInterval
    });

    await tick?.();
    await tick?.();

    expect(onParentExit).toHaveBeenCalledTimes(1);
    expect(cleared).toBe(1);
  });

  it('幂等清理包装只执行一次', async () => {
    const cleanup = vi.fn(async () => undefined);
    const runCleanup = createCleanupOnce(cleanup);

    await Promise.all([runCleanup(), runCleanup(), runCleanup()]);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('能识别 Unix 上 npx 启动链已经脱离父进程', () => {
    const lineage: ProcessInfo[] = [
      { pid: 2003, ppid: 2002, command: 'node /tmp/playwright-pool/dist/src/server.js' },
      { pid: 2002, ppid: 2001, command: 'npm exec @jianzhangg/playwright-pool' },
      { pid: 2001, ppid: 1, command: 'npx -y @jianzhangg/playwright-pool' }
    ];

    expect(isDetachedLauncherChain(lineage, undefined, 'linux')).toBe(true);
  });

  it('Unix 上启动链仍挂在宿主进程下时不判定为脱离', () => {
    const lineage: ProcessInfo[] = [
      { pid: 2003, ppid: 2002, command: 'node /tmp/playwright-pool/dist/src/server.js' },
      { pid: 2002, ppid: 2001, command: 'npm exec @jianzhangg/playwright-pool' },
      { pid: 2001, ppid: 1000, command: 'npx -y @jianzhangg/playwright-pool' },
      { pid: 1000, ppid: 1, command: 'Codex Helper' }
    ];

    expect(isDetachedLauncherChain(lineage, undefined, 'linux')).toBe(false);
  });

  it('Windows 上只有 launcher 包装链时判定为脱离', () => {
    const lineage: ProcessInfo[] = [
      { pid: 32528, ppid: 39236, command: 'node ...dist/src/server.js --config D:/Users/jianzhangg/Documents/playwright-pool/config.toml' },
      { pid: 39236, ppid: 24156, command: 'cmd.exe /d /s /c playwright-pool --config D:/Users/jianzhangg/Documents/playwright-pool/config.toml' },
      { pid: 24156, ppid: 35264, command: 'node .../npx-cli.js -y @jianzhangg/playwright-pool@latest' },
      { pid: 35264, ppid: 0, command: 'npx.exe @jianzhangg/playwright-pool@latest' }
    ];

    expect(isDetachedLauncherChain(lineage, undefined, 'win32')).toBe(true);
  });

  it('Windows 上链路仍挂在 codex app-server 下时不判定为脱离', () => {
    const lineage: ProcessInfo[] = [
      { pid: 32528, ppid: 39236, command: 'node ...dist/src/server.js --config D:/Users/jianzhangg/Documents/playwright-pool/config.toml' },
      { pid: 39236, ppid: 24156, command: 'cmd.exe /d /s /c playwright-pool --config D:/Users/jianzhangg/Documents/playwright-pool/config.toml' },
      { pid: 24156, ppid: 39672, command: 'node .../npx-cli.js -y @jianzhangg/playwright-pool@latest' },
      { pid: 39672, ppid: 5528, command: 'codex.exe app-server' },
      { pid: 5528, ppid: 0, command: 'Codex.exe' }
    ];

    expect(isDetachedLauncherChain(lineage, undefined, 'win32')).toBe(false);
  });

  it('能解析 ps 输出中的 pid、ppid 和命令', () => {
    expect(parsePsOutput('38584     1 npx -y @jianzhangg/playwright-pool\n')).toEqual({
      pid: 38584,
      ppid: 1,
      command: 'npx -y @jianzhangg/playwright-pool'
    });
  });

  it('检测到脱离的 Unix 启动链时只触发一次清理', async () => {
    let tick: (() => void) | undefined;
    let cleared = 0;
    const onDetached = vi.fn();

    startDetachedLauncherWatcher({
      currentPid: 2003,
      intervalMs: 1000,
      onDetached,
      loadLineage: vi.fn().mockResolvedValue([
        { pid: 2003, ppid: 2002, command: 'node /tmp/playwright-pool/dist/src/server.js' },
        { pid: 2002, ppid: 2001, command: 'npm exec @jianzhangg/playwright-pool' },
        { pid: 2001, ppid: 1, command: 'npx -y @jianzhangg/playwright-pool' }
      ]),
      launcherMatcher: () => true,
      platform: 'darwin',
      setIntervalFn: ((callback: () => void) => {
        tick = callback;
        return {
          unref() {
            return undefined;
          }
        } as unknown as NodeJS.Timeout;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {
        cleared += 1;
      }) as typeof clearInterval
    } as Parameters<typeof startDetachedLauncherWatcher>[0]);

    await tick?.();
    await tick?.();

    expect(onDetached).toHaveBeenCalledTimes(1);
    expect(cleared).toBe(1);
  });

  it('Windows 上也会启动 watcher 并检测 launcher 链脱离', async () => {
    let tick: (() => void) | undefined;
    let cleared = 0;
    const onDetached = vi.fn();
    const loadLineage = vi.fn().mockResolvedValue([
      { pid: 32528, ppid: 39236, command: 'node ...dist/src/server.js --config D:/Users/jianzhangg/Documents/playwright-pool/config.toml' },
      { pid: 39236, ppid: 24156, command: 'cmd.exe /d /s /c playwright-pool --config D:/Users/jianzhangg/Documents/playwright-pool/config.toml' },
      { pid: 24156, ppid: 35264, command: 'node .../npx-cli.js -y @jianzhangg/playwright-pool@latest' },
      { pid: 35264, ppid: 0, command: 'npx.exe @jianzhangg/playwright-pool@latest' }
    ]);

    startDetachedLauncherWatcher({
      currentPid: 32528,
      intervalMs: 1000,
      onDetached,
      loadLineage,
      platform: 'win32',
      setIntervalFn: ((callback: () => void) => {
        tick = callback;
        return {
          unref() {
            return undefined;
          }
        } as unknown as NodeJS.Timeout;
      }) as unknown as typeof setInterval,
      clearIntervalFn: (() => {
        cleared += 1;
      }) as typeof clearInterval
    } as Parameters<typeof startDetachedLauncherWatcher>[0]);

    await tick?.();
    await tick?.();

    expect(loadLineage).toHaveBeenCalled();
    expect(onDetached).toHaveBeenCalledTimes(1);
    expect(cleared).toBe(1);
  });
});
