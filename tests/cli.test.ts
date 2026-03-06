import { describe, expect, it } from 'vitest';

import { parseCliInput } from '../src/cli.js';

describe('parseCliInput', () => {
  it('能识别位置命令和后续参数', () => {
    expect(
      parseCliInput(['init', '--force', '--config', '/tmp/config.toml'])
    ).toEqual({
      command: 'init',
      args: {
        force: 'true',
        config: '/tmp/config.toml'
      }
    });
  });

  it('只有参数时不强制要求命令', () => {
    expect(
      parseCliInput(['--config', '/tmp/config.toml'])
    ).toEqual({
      command: undefined,
      args: {
        config: '/tmp/config.toml'
      }
    });
  });
});
