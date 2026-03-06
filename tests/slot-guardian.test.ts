import { describe, expect, it, vi } from 'vitest';

import { createCleanupOnce, startParentProcessWatcher } from '../src/slot-guardian.js';

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
});
