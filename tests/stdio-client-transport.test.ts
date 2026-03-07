import { describe, expect, it } from 'vitest';

import { JsonRpcLineBuffer } from '../src/stdio-client-transport.js';

describe('JsonRpcLineBuffer', () => {
  it('读取大消息后只保留小尾巴，不继续引用整块旧缓冲', () => {
    const buffer = new JsonRpcLineBuffer();
    const largeMessage = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          {
            type: 'text',
            text: 'x'.repeat(10 * 1024 * 1024)
          }
        ]
      }
    });

    buffer.append(Buffer.from(`${largeMessage}\ntail`, 'utf8'));
    const message = buffer.readMessage();
    const remaining = (buffer as unknown as { buffer?: Buffer }).buffer;

    expect(message).toMatchObject({
      jsonrpc: '2.0',
      id: 1
    });
    expect(remaining?.toString('utf8')).toBe('tail');
    expect(remaining?.buffer.byteLength ?? 0).toBeLessThan(1024 * 1024);
  });

  it('clear 会清空剩余缓冲', () => {
    const buffer = new JsonRpcLineBuffer();

    buffer.append(Buffer.from('partial', 'utf8'));
    buffer.clear();

    expect((buffer as unknown as { buffer?: Buffer }).buffer).toBeUndefined();
  });
});
