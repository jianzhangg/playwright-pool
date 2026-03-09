import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { parseCliArgs } from './cli.js';
import { buildSlotPaths, loadPoolConfig } from './config.js';
import { isExecutedAsCli } from './execution-mode.js';
import { removeDirRobustly } from './fs-utils.js';
import { removeLockFiles, removeSessionRestoreArtifacts } from './profile-merge.js';
import { resolveDefaultConfigPath } from './playwright-config.js';
import { ensureProfileDirClosed } from './profile-usage.js';
import type { PlaywrightPoolConfig } from './types.js';

type PrepareProfilesOptions = {
  onProgress?: (message: string) => void;
  skipSourceDirClosedCheck?: boolean;
};

export async function prepareProfiles(
  config: PlaywrightPoolConfig,
  sourceDirOverride?: string,
  options: PrepareProfilesOptions = {}
): Promise<void> {
  const sourceDir = path.resolve(sourceDirOverride ?? config.pool.sourceProfileDir ?? '');
  if (!sourceDir || sourceDir === path.resolve('')) {
    throw new Error('prepare-profiles 缺少 sourceProfileDir，请先执行 init 或在配置中显式设置 pool.sourceProfileDir');
  }

  if (!options.skipSourceDirClosedCheck) {
    await ensureProfileDirClosed(sourceDir);
  }
  await Promise.all([
    mkdir(config.pool.logsDir, { recursive: true }),
    mkdir(config.pool.leaseDir, { recursive: true })
  ]);

  for (let slotId = 1; slotId <= config.pool.size; slotId += 1) {
    options.onProgress?.(`正在准备浏览器副本 ${slotId}/${config.pool.size}`);
    const slotPaths = buildSlotPaths(config.pool, slotId);
    await removeDirRobustly(slotPaths.profileDir);
    await mkdir(path.dirname(slotPaths.profileDir), { recursive: true });
    await cp(sourceDir, slotPaths.profileDir, {
      force: true,
      recursive: true
    });
    await mkdir(slotPaths.outputDir, { recursive: true });

    await removeLockFiles(slotPaths.profileDir);
    await removeSessionRestoreArtifacts(slotPaths.profileDir);
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config ?? resolveDefaultConfigPath());
  const config = await loadPoolConfig(configPath);
  await prepareProfiles(config, args.source);
}

if (isExecutedAsCli(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
