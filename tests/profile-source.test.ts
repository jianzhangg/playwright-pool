import { describe, expect, it } from 'vitest';

import { inferBrowserProcessName } from '../src/profile-source.js';

describe('inferBrowserProcessName', () => {
  it('微软 Edge 的用户目录会映射到 Microsoft Edge 进程名', () => {
    expect(
      inferBrowserProcessName('/Users/alice/Library/Application Support/Microsoft Edge')
    ).toBe('Microsoft Edge');
  });

  it('Google Chrome 的用户目录会映射到 Google Chrome 进程名', () => {
    expect(
      inferBrowserProcessName('/Users/alice/Library/Application Support/Google/Chrome')
    ).toBe('Google Chrome');
  });

  it('未知目录退化为目录名，方便手动传入自定义 profile 源', () => {
    expect(inferBrowserProcessName('/tmp/custom-browser-profile')).toBe('custom-browser-profile');
  });
});
