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

  it('能识别 npx 启动链已经脱离父进程', () => {
    const lineage: ProcessInfo[] = [
      { pid: 2003, ppid: 2002, command: 'node /tmp/playwright-pool/dist/src/server.js' },
      { pid: 2002, ppid: 2001, command: 'npm exec @jianzhangg/playwright-pool' },
      { pid: 2001, ppid: 1, command: 'npx -y @jianzhangg/playwright-pool' }
    ];

    expect(isDetachedLauncherChain(lineage)).toBe(true);
  });

  it('启动链仍挂在宿主进程下时不判定为脱离', () => {
    const lineage: ProcessInfo[] = [
      { pid: 2003, ppid: 2002, command: 'node /tmp/playwright-pool/dist/src/server.js' },
      { pid: 2002, ppid: 2001, command: 'npm exec @jianzhangg/playwright-pool' },
      { pid: 2001, ppid: 1000, command: 'npx -y @jianzhangg/playwright-pool' },
      { pid: 1000, ppid: 1, command: 'Codex Helper' }
    ];

    expect(isDetachedLauncherChain(lineage)).toBe(false);
  });

  it('能解析 ps 输出中的 pid、ppid 和命令', () => {
    expect(parsePsOutput('38584     1 npx -y @jianzhangg/playwright-pool\n')).toEqual({
      pid: 38584,
      ppid: 1,
      command: 'npx -y @jianzhangg/playwright-pool'
    });
  });

  it('检测到脱离的启动链时只触发一次清理', async () => {
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
});
