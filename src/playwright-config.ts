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

export function buildSlotPlaywrightConfig(config: PlaywrightPoolConfig, slotId: number): Record<string, unknown> {
  const slotPaths = buildSlotPaths(config.pool, slotId);
  const nextConfig = structuredClone(config.playwright) as Record<string, unknown>;
  const browser = ensureObject<Record<string, unknown>>(nextConfig.browser);

  browser.userDataDir = slotPaths.profileDir;
  nextConfig.browser = browser;
  nextConfig.outputDir = slotPaths.outputDir;

  return nextConfig;
}

export function resolveDefaultConfigPath(homeDir?: string): string {
  return path.resolve(resolveDefaultRuntimeRoot(homeDir), 'config.toml');
}
