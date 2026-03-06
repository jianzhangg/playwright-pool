import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { createConnection } from '@playwright/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { parseCliArgs } from './cli.js';
import { buildSlotPaths, loadPoolConfig } from './config.js';
import { isExecutedAsCli } from './execution-mode.js';
import { LeaseManager } from './lease-manager.js';
import { buildSlotPlaywrightConfig, resolveDefaultConfigPath } from './playwright-config.js';
import { killProfileProcesses } from './profile-process.js';
import { createCleanupOnce, startParentProcessWatcher } from './slot-guardian.js';

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config ?? resolveDefaultConfigPath());
  const slotId = Number(args.slot);

  if (!Number.isInteger(slotId) || slotId <= 0) {
    throw new Error('slot-server 缺少合法的 --slot 参数');
  }

  const config = await loadPoolConfig(configPath);
  const slotPaths = buildSlotPaths(config.pool, slotId);
  const leaseManager = new LeaseManager(config.pool, configPath);
  const parentPid = process.ppid;
  await Promise.all([
    mkdir(slotPaths.profileDir, { recursive: true }),
    mkdir(slotPaths.outputDir, { recursive: true })
  ]);

  const server = await createConnection(buildSlotPlaywrightConfig(config, slotId));
  const transport = new StdioServerTransport();
  let stopWatchingParent: () => void = () => undefined;
  const runCleanup = createCleanupOnce(async () => {
    stopWatchingParent();
    const released = await leaseManager.releaseIfOwnedBy(slotId, parentPid, configPath);
    if (released) {
      process.stderr.write(`[slot ${slotId}] 回收仍归当前父进程所有的 lease 与 Chrome\n`);
      await killProfileProcesses(slotPaths.profileDir);
    }
    await server.close().catch(() => undefined);
  });

  const cleanupAndExit = (exitCode: number, reason: string) => {
    process.stderr.write(`[slot ${slotId}] ${reason}\n`);
    void runCleanup().finally(() => process.exit(exitCode));
  };

  transport.onclose = () => {
    cleanupAndExit(0, 'transport 关闭，准备退出');
  };
  process.stdin.on('end', () => {
    cleanupAndExit(0, 'stdin end，准备退出');
  });
  process.stdin.on('close', () => {
    cleanupAndExit(0, 'stdin close，准备退出');
  });
  process.on('SIGINT', () => {
    cleanupAndExit(0, '收到 SIGINT，准备退出');
  });
  process.on('SIGTERM', () => {
    cleanupAndExit(0, '收到 SIGTERM，准备退出');
  });
  process.on('uncaughtException', (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    cleanupAndExit(1, '发生 uncaughtException，准备退出');
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`${String(reason)}\n`);
    cleanupAndExit(1, '发生 unhandledRejection，准备退出');
  });
  stopWatchingParent = startParentProcessWatcher({
    parentPid,
    onParentExit: async () => {
      process.stderr.write(`[slot ${slotId}] 检测到父进程失联，准备退出\n`);
      await runCleanup();
      process.exit(0);
    }
  });

  await server.connect(transport);
}

if (isExecutedAsCli(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
