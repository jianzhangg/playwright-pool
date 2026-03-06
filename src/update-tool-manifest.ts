import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseCliArgs } from './cli.js';
import { loadPoolConfig } from './config.js';
import { isExecutedAsCli } from './execution-mode.js';
import { resolveDefaultConfigPath } from './playwright-config.js';
import { SlotRuntime } from './slot-runtime.js';
import { resolveDefaultToolManifestPath, saveToolManifest } from './tool-manifest.js';
import type { PlaywrightPoolConfig } from './types.js';

function buildManifestConfig(config: PlaywrightPoolConfig): PlaywrightPoolConfig {
  const cloned = structuredClone(config) as PlaywrightPoolConfig;
  const browser = (cloned.playwright.browser ?? {}) as Record<string, unknown>;
  const launchOptions = ((browser.launchOptions as Record<string, unknown> | undefined) ?? {});

  launchOptions.headless = true;
  browser.launchOptions = launchOptions;
  cloned.playwright.browser = browser;

  return cloned;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config ?? resolveDefaultConfigPath());
  const outputPath = path.resolve(args.output ?? resolveDefaultToolManifestPath());
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'playwright-pool-manifest-'));
  const config = buildManifestConfig(await loadPoolConfig(configPath));
  config.pool.profileDirTemplate = path.join(tempRoot, 'profiles/{id}');
  config.pool.outputDirTemplate = path.join(tempRoot, 'output/{id}');
  config.pool.leaseDir = path.join(tempRoot, 'leases');
  config.pool.logsDir = path.join(tempRoot, 'logs');
  const slotRuntime = new SlotRuntime(config, configPath);

  try {
    const tools = await slotRuntime.discoverTools();
    await saveToolManifest(outputPath, tools);
  } finally {
    await slotRuntime.closeAll().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

if (isExecutedAsCli(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
