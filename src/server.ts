#!/usr/bin/env node

import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Root,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';

import { parseCliInput } from './cli.js';
import { loadPoolConfig } from './config.js';
import { isExecutedAsCli } from './execution-mode.js';
import { createConsoleInitWizardIO, runInitWizard, type InitWizardIO } from './init-wizard.js';
import { initializePlaywrightPool } from './init.js';
import { LeaseManager } from './lease-manager.js';
import { buildSlotPlaywrightConfig, resolveDefaultConfigPath } from './playwright-config.js';
import { createFatalProcessHandler, createSingleExitHandler } from './process-shutdown.js';
import { PoolService } from './pool-service.js';
import { safeStderrWrite } from './safe-stderr.js';
import { createServerLogger } from './server-logger.js';
import { createCleanupOnce, startDetachedLauncherWatcher, startParentProcessWatcher } from './slot-guardian.js';
import { SlotRuntime } from './slot-runtime.js';
import { resolveRegisteredTools } from './tool-catalog.js';
import { resolveDefaultToolManifestPath } from './tool-manifest.js';
import type { ToolCallResult } from './types.js';

const POOL_STATUS_TOOL: Tool = {
  name: 'pool_status',
  description: '查看当前 Playwright slot 占用、活跃会话和子进程状态',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  }
};

type InitCommandDependencies = {
  createWizardIO?: () => InitWizardIO & { close?: () => void };
  runInitWizard?: typeof runInitWizard;
  initializePlaywrightPool?: typeof initializePlaywrightPool;
  writeOutput?: (message: string) => void;
};

export async function runInitCommand(
  args: Record<string, string>,
  dependencies: InitCommandDependencies = {}
): Promise<void> {
  const createWizardIO = dependencies.createWizardIO ?? (() => createConsoleInitWizardIO());
  const runWizard = dependencies.runInitWizard ?? runInitWizard;
  const initializePool = dependencies.initializePlaywrightPool ?? initializePlaywrightPool;
  const writeOutput = dependencies.writeOutput ?? ((message: string) => {
    process.stdout.write(message);
  });
  const io = createWizardIO();

  try {
    const wizardResult = await runWizard(io, {
      initialConfigPath: args.config
    });
    if (!wizardResult) {
      return;
    }

    io.writeLine('初始化开始后请保持终端打开。复制浏览器数据可能需要几分钟。');
    const result = await initializePool({
      configPath: wizardResult.configPath,
      force: args.force === 'true',
      size: wizardResult.size,
      browser: wizardResult.browser,
      browserChannel: wizardResult.browserChannel,
      sourceProfileDir: wizardResult.sourceProfileDir,
      browserExecutablePath: wizardResult.browserExecutablePath,
      onProgress: (message) => {
        io.writeLine(message);
      }
    });

    writeOutput(
      [
        'playwright_pool 初始化完成',
        `浏览器: ${describeBrowser(result.browser)}`,
        `配置文件: ${result.configPath}`,
        `运行目录: ${result.runtimeRoot}`,
        `浏览器可执行文件: ${result.browserExecutablePath ?? '未探测到'}`,
        `源 profile: ${result.sourceProfileDir}`,
        `slot 数量: ${result.size}`
      ].join('\n') + '\n'
    );
  } finally {
    io.close?.();
  }
}

async function main(): Promise<void> {
  const { command, args } = parseCliInput(process.argv.slice(2));
  if (command === 'init') {
    await runInitCommand(args);
    return;
  }

  if (command && command !== 'start') {
    throw new Error(`不支持的命令: ${command}`);
  }

  const configPath = path.resolve(args.config ?? resolveDefaultConfigPath());
  const config = await loadPoolConfig(configPath).catch((error) => {
    const errorLike = error as NodeJS.ErrnoException;
    if (errorLike.code === 'ENOENT' && !args.config) {
      throw new Error(`默认配置不存在：${configPath}\n请先执行：npx playwright-pool init`);
    }
    throw error;
  });
  const { logger, logFile: serverLogFile } = await createServerLogger(config.pool.logsDir);

  // 这里调用一次是为了尽早暴露配置错误，并确保默认 slot 覆写逻辑可用。
  buildSlotPlaywrightConfig(config, 1);

  logger.info('server_start', {
    version: '0.1.9',
    configPath,
    heartbeatSeconds: config.pool.heartbeatSeconds,
    poolSize: config.pool.size,
    sessionKeyEnv: config.pool.sessionKeyEnv,
    serverLogFile
  });

  const leaseManager = new LeaseManager(config.pool, configPath);
  const slotRuntime = new SlotRuntime(config, configPath, logger);
  const discoveredTools = await resolveRegisteredTools(resolveDefaultToolManifestPath(), slotRuntime);
  const sessionFallbackKey = `playwright-pool:${process.pid}:${randomUUID()}`;
  const poolService = new PoolService({
    sessionKeyEnv: config.pool.sessionKeyEnv,
    sessionFallbackKey,
    heartbeatSeconds: config.pool.heartbeatSeconds,
    leaseManager,
    slotRuntime: {
      callTool: (slotId, toolName, toolArgs, roots) => slotRuntime.callTool(slotId, toolName, toolArgs, roots),
      listStatuses: () => slotRuntime.listStatuses()
    },
    logger
  });

  const server = new Server(
    {
      name: 'playwright_pool',
      version: '0.1.9'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [...discoveredTools, POOL_STATUS_TOOL]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const roots = await listClientRoots(server);
    const result = await poolService.callTool(
      {
        name: request.params.name,
        arguments: (request.params.arguments ?? {}) as Record<string, unknown>
      },
      process.env,
      roots
    );
    return result as ToolCallResult;
  });

  const transport = new StdioServerTransport();
  let stopWatchingParent: () => void = () => undefined;
  let stopWatchingLauncher: () => void = () => undefined;
  let shutdownReason = 'unknown';
  const shutdown = createCleanupOnce(async () => {
    logger.info('server_shutdown_start', {
      reason: shutdownReason
    });
    stopWatchingParent();
    stopWatchingLauncher();
    await poolService.shutdown().catch(() => undefined);
    await slotRuntime.closeAll().catch(() => undefined);
    await server.close().catch(() => undefined);
    logger.info('server_shutdown_complete', {
      reason: shutdownReason
    });
    await logger.close().catch(() => undefined);
  });

  const requestShutdownAndExit = createSingleExitHandler((exitCode: number, reason: string) => {
    shutdownReason = reason;
    logger.info('server_shutdown_requested', {
      exitCode,
      reason
    });
    safeStderrWrite(`[playwright_pool] ${reason}\n`);
    void shutdown().finally(() => process.exit(exitCode));
  });

  const handleUncaughtException = createFatalProcessHandler({
    reason: '发生 uncaughtException，准备回收所有 slot',
    requestExit: requestShutdownAndExit,
    writeDiagnostic: (message) => {
      safeStderrWrite(message);
    }
  });
  const handleUnhandledRejection = createFatalProcessHandler({
    reason: '发生 unhandledRejection，准备回收所有 slot',
    requestExit: requestShutdownAndExit,
    writeDiagnostic: (message) => {
      safeStderrWrite(message);
    }
  });

  transport.onclose = () => {
    if (shutdownReason === 'unknown') {
      shutdownReason = 'transport.onclose';
    }
    logger.info('server_transport_close', {});
    void shutdown();
  };
  process.stdin.on('end', () => {
    requestShutdownAndExit(0, 'stdin end，准备回收所有 slot');
  });
  process.stdin.on('close', () => {
    requestShutdownAndExit(0, 'stdin close，准备回收所有 slot');
  });
  process.on('SIGINT', () => {
    requestShutdownAndExit(0, '收到 SIGINT，准备回收所有 slot');
  });
  process.on('SIGTERM', () => {
    requestShutdownAndExit(0, '收到 SIGTERM，准备回收所有 slot');
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught_exception', {
      error: error instanceof Error ? error.stack ?? error.message : String(error)
    });
    handleUncaughtException(error);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', {
      error: String(reason)
    });
    handleUnhandledRejection(reason);
  });

  stopWatchingParent = startParentProcessWatcher({
    parentPid: process.ppid,
    onParentExit: () => {
      logger.info('direct_parent_exit', {
        parentPid: process.ppid
      });
      requestShutdownAndExit(0, '检测到直接父进程失联，准备回收所有 slot');
    }
  });
  stopWatchingLauncher = startDetachedLauncherWatcher({
    currentPid: process.pid,
    onDetached: () => {
      logger.info('launcher_chain_detached', {});
      requestShutdownAndExit(0, '检测到 npx/npm 启动链已脱离父进程，准备回收所有 slot');
    }
  });

  await server.connect(transport);
  logger.info('server_connected', {
    serverLogFile
  });
}

function describeBrowser(browser: 'chrome' | 'edge'): string {
  return browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome';
}

async function listClientRoots(server: Server): Promise<Root[]> {
  if (!server.getClientCapabilities()?.roots) {
    return [];
  }

  try {
    const result = await server.listRoots();
    return result.roots;
  } catch {
    return [];
  }
}

if (isExecutedAsCli(import.meta.url)) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    safeStderrWrite(`${message}\n`);
    process.exitCode = 1;
  });
}
