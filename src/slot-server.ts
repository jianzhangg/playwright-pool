import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { createConnection } from '@playwright/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { parseCliArgs } from './cli.js';
import { buildSlotPaths, loadPoolConfig } from './config.js';
import { isExecutedAsCli } from './execution-mode.js';
import { buildSlotPlaywrightConfig, resolveDefaultConfigPath } from './playwright-config.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config ?? resolveDefaultConfigPath());
  const slotId = Number(args.slot);

  if (!Number.isInteger(slotId) || slotId <= 0) {
    throw new Error('slot-server 缺少合法的 --slot 参数');
  }

  const config = await loadPoolConfig(configPath);
  const slotPaths = buildSlotPaths(config.pool, slotId);
  await Promise.all([
    mkdir(slotPaths.profileDir, { recursive: true }),
    mkdir(slotPaths.outputDir, { recursive: true })
  ]);

  const server = await createConnection(buildSlotPlaywrightConfig(config, slotId));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isExecutedAsCli(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
