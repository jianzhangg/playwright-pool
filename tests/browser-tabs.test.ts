import { describe, expect, it } from 'vitest';

import { extractTabIndices } from '../src/browser-tabs.js';

describe('extractTabIndices', () => {
  it('从 browser_tabs 文本结果中去重并按倒序提取 tab 索引', () => {
    const indices = extractTabIndices({
      content: [
        {
          type: 'text',
          text: [
            '### Result',
            '- 0: [](about:blank)',
            '- 2: [A](https://a.example)',
            '### Open tabs',
            '- 0: [](about:blank)',
            '- 1: [B](https://b.example)',
            '- 2: [A](https://a.example)'
          ].join('\n')
        }
      ]
    });

    expect(indices).toEqual([2, 1, 0]);
  });
});
