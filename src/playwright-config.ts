import path from 'node:path';

import { buildSlotPaths } from './config.js';
import { resolveDefaultRuntimeRoot } from './profile-source.js';
import type { PlaywrightPoolConfig } from './types.js';

function ensureObject<T extends object>(value: unknown): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as T;
  }
  return {} as T;
}

export function buildSlotPlaywrightConfig(
  config: PlaywrightPoolConfig,
  slotId: number,
  platform: NodeJS.Platform = process.platform
): Record<string, unknown> {
  const slotPaths = buildSlotPaths(config.pool, slotId);
  const nextConfig = applyDefaultChromiumSandbox(
    structuredClone(config.playwright) as Record<string, unknown>,
    platform
  );
  const browser = ensureObject<Record<string, unknown>>(nextConfig.browser);

  browser.userDataDir = slotPaths.profileDir;
  nextConfig.browser = browser;
  nextConfig.outputDir = slotPaths.outputDir;

  return nextConfig;
}

export function applyDefaultChromiumSandbox(
  config: Record<string, unknown>,
  platform: NodeJS.Platform = process.platform
): Record<string, unknown> {
  const browser = ensureObject<Record<string, unknown>>(config.browser);
  const launchOptions = ensureObject<Record<string, unknown>>(browser.launchOptions);

  if (browser.browserName === 'chromium' && launchOptions.chromiumSandbox === undefined) {
    launchOptions.chromiumSandbox = platform === 'linux'
      ? launchOptions.channel !== 'chromium'
      : true;
  }

  browser.launchOptions = launchOptions;
  config.browser = browser;
  return config;
}

export function resolveDefaultConfigPath(homeDir?: string): string {
  return path.resolve(resolveDefaultRuntimeRoot(homeDir), 'config.toml');
}
