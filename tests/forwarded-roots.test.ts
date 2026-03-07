import { describe, expect, it } from 'vitest';

import type { Root } from '@modelcontextprotocol/sdk/types.js';

import { ForwardedRootsState } from '../src/forwarded-roots.js';

describe('ForwardedRootsState', () => {
  it('没有外部 roots 时会回退到指定目录', () => {
    const state = new ForwardedRootsState('C:\\workspace');

    expect(state.list()).toEqual<Root[]>([
      {
        uri: 'file:///C:/workspace',
        name: 'C:\\workspace'
      }
    ]);
  });

  it('有外部 roots 时优先使用外部 roots，并在 roots 变化时更新签名', () => {
    const state = new ForwardedRootsState('C:\\workspace');
    const initialSignature = state.signature();

    state.set([
      {
        uri: 'file:///C:/code/playwright-pool',
        name: 'playwright-pool'
      }
    ]);

    expect(state.list()).toEqual<Root[]>([
      {
        uri: 'file:///C:/code/playwright-pool',
        name: 'playwright-pool'
      }
    ]);
    expect(state.signature()).not.toBe(initialSignature);
  });
});
