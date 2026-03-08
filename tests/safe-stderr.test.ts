import { describe, expect, it, vi } from 'vitest';

import { isBrokenPipeError, safeStderrWrite } from '../src/safe-stderr.js';

describe('safe stderr', () => {
  it('写 stderr 遇到 broken pipe 时会静默吞掉', () => {
    const writer = {
      write: vi.fn(() => {
        const error = new Error('broken pipe');
        Object.assign(error, { code: 'EPIPE' });
        throw error;
      })
    };

    expect(() => safeStderrWrite('hello\n', { writer })).not.toThrow();
    expect(writer.write).toHaveBeenCalledWith('hello\n');
  });

  it('写 stderr 遇到非 broken pipe 错误时继续抛出', () => {
    const writer = {
      write: vi.fn(() => {
        const error = new Error('boom');
        Object.assign(error, { code: 'EINVAL' });
        throw error;
      })
    };

    expect(() => safeStderrWrite('hello\n', { writer })).toThrow('boom');
  });

  it('能识别常见的 broken pipe 错误码', () => {
    expect(isBrokenPipeError(Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).toBe(true);
    expect(isBrokenPipeError(Object.assign(new Error('stream destroyed'), { code: 'ERR_STREAM_DESTROYED' }))).toBe(true);
    expect(isBrokenPipeError(Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' }))).toBe(true);
    expect(isBrokenPipeError(Object.assign(new Error('other'), { code: 'EINVAL' }))).toBe(false);
    expect(isBrokenPipeError('plain string')).toBe(false);
  });
});
