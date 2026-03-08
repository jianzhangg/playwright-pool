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
import { createFatalProcessHandler, createSingleExitHandler } from './process-shutdown.js';
import { safeStderrWrite } from './safe-stderr.js';
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
      safeStderrWrite(`[slot ${slotId}] 回收仍归当前父进程所有的 lease 与 Chrome\n`);
      await killProfileProcesses(slotPaths.profileDir);
    }
    await server.close().catch(() => undefined);
  });

  const requestCleanupAndExit = createSingleExitHandler((exitCode: number, reason: string) => {
    safeStderrWrite(`[slot ${slotId}] ${reason}\n`);
    void runCleanup().finally(() => process.exit(exitCode));
  });

  const handleUncaughtException = createFatalProcessHandler({
    reason: '发生 uncaughtException，准备退出',
    requestExit: requestCleanupAndExit,
    writeDiagnostic: (message) => {
      safeStderrWrite(message);
    }
  });
  const handleUnhandledRejection = createFatalProcessHandler({
    reason: '发生 unhandledRejection，准备退出',
    requestExit: requestCleanupAndExit,
    writeDiagnostic: (message) => {
      safeStderrWrite(message);
    }
  });

  transport.onclose = () => {
    requestCleanupAndExit(0, 'transport 关闭，准备退出');
  };
  process.stdin.on('end', () => {
    requestCleanupAndExit(0, 'stdin end，准备退出');
  });
  process.stdin.on('close', () => {
    requestCleanupAndExit(0, 'stdin close，准备退出');
  });
  process.on('SIGINT', () => {
    requestCleanupAndExit(0, '收到 SIGINT，准备退出');
  });
  process.on('SIGTERM', () => {
    requestCleanupAndExit(0, '收到 SIGTERM，准备退出');
  });
  process.on('uncaughtException', (error) => {
    handleUncaughtException(error);
  });
  process.on('unhandledRejection', (reason) => {
    handleUnhandledRejection(reason);
  });
  stopWatchingParent = startParentProcessWatcher({
    parentPid,
    onParentExit: () => {
      requestCleanupAndExit(0, '检测到父进程失联，准备退出');
    }
  });

  await server.connect(transport);
}

if (isExecutedAsCli(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    safeStderrWrite(`${message}\n`);
    process.exitCode = 1;
  });
}
