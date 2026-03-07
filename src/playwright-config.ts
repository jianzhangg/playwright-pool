import path from 'node:path';

import { buildSlotPaths } from './config.js';
import { resolveDefaultRuntimeRoot, type ResolveRuntimeRootOptions } from './profile-source.js';
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

function resolveRuntimeOptions(homeDirOrOptions?: string | ResolveRuntimeRootOptions): ResolveRuntimeRootOptions {
  if (typeof homeDirOrOptions === 'string' || homeDirOrOptions === undefined) {
    return { homeDir: homeDirOrOptions };
  }

  return homeDirOrOptions;
}

export function resolveDefaultConfigPath(homeDirOrOptions?: string | ResolveRuntimeRootOptions): string {
  const options = resolveRuntimeOptions(homeDirOrOptions);
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return pathApi.resolve(resolveDefaultRuntimeRoot(options), 'config.toml');
}
