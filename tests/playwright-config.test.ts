import { describe, expect, it } from 'vitest';

import { applyDefaultChromiumSandbox, buildSlotPlaywrightConfig } from '../src/playwright-config.js';
import type { PlaywrightPoolConfig } from '../src/types.js';

function createConfig(): PlaywrightPoolConfig {
  return {
    pool: {
      size: 3,
      sourceProfileDir: '/tmp/pw/source',
      profileDirTemplate: '/tmp/pw/profiles/{id}',
      outputDirTemplate: '/tmp/pw/output/{id}',
      leaseDir: '/tmp/pw/leases',
      logsDir: '/tmp/pw/logs',
      heartbeatSeconds: 5,
      staleLeaseSeconds: 30,
      sessionKeyEnv: 'CODEX_THREAD_ID'
    },
    playwright: {
      browser: {
        browserName: 'chromium',
        launchOptions: {
          channel: 'chrome',
          headless: false
        }
      }
    }
  };
}

describe('playwright sandbox defaults', () => {
  it('在 darwin 上未显式配置 chromiumSandbox 时默认开启 sandbox', () => {
    const result = applyDefaultChromiumSandbox(
      {
        browser: {
          browserName: 'chromium',
          launchOptions: {
            channel: 'chrome',
            headless: false
          }
        }
      },
      'darwin'
    ) as {
      browser: {
        launchOptions: {
          chromiumSandbox?: boolean;
        };
      };
    };

    expect(result.browser.launchOptions.chromiumSandbox).toBe(true);
  });

  it('在 linux 上 channel=chromium 时默认关闭 sandbox', () => {
    const result = applyDefaultChromiumSandbox(
      {
        browser: {
          browserName: 'chromium',
          launchOptions: {
            channel: 'chromium'
          }
        }
      },
      'linux'
    ) as {
      browser: {
        launchOptions: {
          chromiumSandbox?: boolean;
        };
      };
    };

    expect(result.browser.launchOptions.chromiumSandbox).toBe(false);
  });

  it('显式配置 chromiumSandbox 时保持原值不变', () => {
    const result = applyDefaultChromiumSandbox(
      {
        browser: {
          browserName: 'chromium',
          launchOptions: {
            channel: 'chrome',
            chromiumSandbox: false
          }
        }
      },
      'darwin'
    ) as {
      browser: {
        launchOptions: {
          chromiumSandbox?: boolean;
        };
      };
    };

    expect(result.browser.launchOptions.chromiumSandbox).toBe(false);
  });

  it('buildSlotPlaywrightConfig 会把 slot 配置和 sandbox 默认值一起补齐', () => {
    const result = buildSlotPlaywrightConfig(createConfig(), 2, 'darwin') as {
      browser: {
        userDataDir: string;
        launchOptions: {
          chromiumSandbox?: boolean;
          channel?: string;
        };
      };
      outputDir: string;
    };

    expect(result.browser.userDataDir).toBe('/tmp/pw/profiles/2');
    expect(result.outputDir).toBe('/tmp/pw/output/2');
    expect(result.browser.launchOptions.channel).toBe('chrome');
    expect(result.browser.launchOptions.chromiumSandbox).toBe(true);
  });
});
