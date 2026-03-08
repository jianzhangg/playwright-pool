import { describe, expect, it, vi } from 'vitest';

import { createFatalProcessHandler, createSingleExitHandler } from '../src/process-shutdown.js';

describe('process shutdown', () => {
  it('同一轮退出请求只会执行一次核心清理', () => {
    const onExit = vi.fn();
    const requestExit = createSingleExitHandler(onExit);

    expect(requestExit(0, 'first')).toBe(true);
    expect(requestExit(1, 'second')).toBe(false);

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith(0, 'first');
  });

  it('错误本身就是 broken pipe 时不会再写诊断，但仍会请求退出', () => {
    const requestExit = vi.fn();
    const writeDiagnostic = vi.fn();
    const handler = createFatalProcessHandler({
      reason: '发生 uncaughtException，准备退出',
      requestExit,
      writeDiagnostic
    });
    const error = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });

    expect(() => handler(error)).not.toThrow();
    expect(writeDiagnostic).not.toHaveBeenCalled();
    expect(requestExit).toHaveBeenCalledTimes(1);
    expect(requestExit).toHaveBeenCalledWith(1, '发生 uncaughtException，准备退出');
  });

  it('写诊断时再次遇到 broken pipe 也不会递归抛错', () => {
    const requestExit = vi.fn();
    const handler = createFatalProcessHandler({
      reason: '发生 uncaughtException，准备退出',
      requestExit,
      writeDiagnostic: () => {
        const error = new Error('broken pipe while logging');
        Object.assign(error, { code: 'EPIPE' });
        throw error;
      }
    });

    expect(() => handler(new Error('actual failure'))).not.toThrow();
    expect(requestExit).toHaveBeenCalledTimes(1);
  });

  it('非 broken pipe 错误会先写诊断，再请求退出', () => {
    const requestExit = vi.fn();
    const writeDiagnostic = vi.fn();
    const handler = createFatalProcessHandler({
      reason: '发生 unhandledRejection，准备退出',
      requestExit,
      writeDiagnostic
    });
    const error = new Error('boom');

    handler(error);

    expect(writeDiagnostic).toHaveBeenCalledTimes(1);
    expect(writeDiagnostic.mock.calls[0]?.[0]).toContain('boom');
    expect(requestExit).toHaveBeenCalledWith(1, '发生 unhandledRejection，准备退出');
  });
});
