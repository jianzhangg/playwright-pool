import path from 'node:path';

import { parseCliArgs } from './cli.js';
import { isExecutedAsCli } from './execution-mode.js';
import { buildGoldenProfile } from './profile-merge.js';
import { ensureProfileDirClosed } from './profile-usage.js';

function parseOverlayDirs(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const baseDir = path.resolve(args.base ?? '');
  const overlayDirs = parseOverlayDirs(args.overlays);
  const targetDir = path.resolve(args.target ?? '');

  if (!args.base || !args.target) {
    throw new Error('build-golden-profile 缺少必须参数 --base 和 --target');
  }

  if (overlayDirs.length === 0) {
    throw new Error('build-golden-profile 至少需要一个 --overlays 源目录');
  }

  await ensureProfileDirClosed(baseDir);
  for (const overlayDir of overlayDirs) {
    await ensureProfileDirClosed(overlayDir);
  }

  await buildGoldenProfile({
    baseDir,
    overlayDirs,
    targetDir
  });
}

if (isExecutedAsCli(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
