import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';

import type { Root } from '@modelcontextprotocol/sdk/types.js';

import { ForwardedRootsState } from '../src/forwarded-roots.js';

describe('ForwardedRootsState', () => {
  it('没有外部 roots 时会回退到指定目录', () => {
    const state = new ForwardedRootsState('/workspace');

    expect(state.list()).toEqual<Root[]>([
      {
        uri: pathToFileURL('/workspace').href,
        name: '/workspace'
      }
    ]);
  });

  it('只有 extraAllowedRoots 时使用配置目录而不是 fallback', () => {
    const state = new ForwardedRootsState('/workspace', [], ['/uploads', '/shared']);

    expect(state.list()).toEqual<Root[]>([
      {
        uri: pathToFileURL('/uploads').href,
        name: '/uploads'
      },
      {
        uri: pathToFileURL('/shared').href,
        name: '/shared'
      }
    ]);
  });

  it('有客户端 roots 时合并 extraAllowedRoots，并在 roots 变化时更新签名', () => {
    const state = new ForwardedRootsState('/workspace', [], ['/uploads']);
    const initialSignature = state.signature();

    state.set([
      {
        uri: 'file:///code/playwright-pool',
        name: 'playwright-pool'
      }
    ]);

    expect(state.list()).toEqual<Root[]>([
      {
        uri: 'file:///code/playwright-pool',
        name: 'playwright-pool'
      },
      {
        uri: pathToFileURL('/uploads').href,
        name: '/uploads'
      }
    ]);
    expect(state.signature()).not.toBe(initialSignature);
  });
});
