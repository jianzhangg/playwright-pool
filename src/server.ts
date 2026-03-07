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
import { initializePlaywrightPool } from './init.js';
import { LeaseManager } from './lease-manager.js';
import { buildSlotPlaywrightConfig, resolveDefaultConfigPath } from './playwright-config.js';
import { PoolService } from './pool-service.js';
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

async function main(): Promise<void> {
  const { command, args } = parseCliInput(process.argv.slice(2));
  if (command === 'init') {
    const result = await initializePlaywrightPool({
      configPath: args.config,
      force: args.force === 'true',
      size: args.size ? Number(args.size) : undefined
    });

    process.stdout.write(
      [
        'playwright_pool 初始化完成',
        `配置文件: ${result.configPath}`,
        `运行目录: ${result.runtimeRoot}`,
        `Chrome 可执行文件: ${result.chromeExecutablePath}`,
        `源 profile: ${result.sourceProfileDir}`,
        `slot 数量: ${result.size}`
      ].join('\n') + '\n'
    );
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

  // 这里调用一次是为了尽早暴露配置错误，并确保默认 slot 覆写逻辑可用。
  buildSlotPlaywrightConfig(config, 1);

  const leaseManager = new LeaseManager(config.pool, configPath);
  const slotRuntime = new SlotRuntime(config, configPath);
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
    }
  });

  const server = new Server(
    {
      name: 'playwright_pool',
      version: '0.1.6'
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
  const shutdown = createCleanupOnce(async () => {
    stopWatchingParent();
    stopWatchingLauncher();
    await poolService.shutdown().catch(() => undefined);
    await slotRuntime.closeAll().catch(() => undefined);
    await server.close().catch(() => undefined);
  });

  const shutdownAndExit = (exitCode: number, reason: string) => {
    process.stderr.write(`[playwright_pool] ${reason}\n`);
    void shutdown().finally(() => process.exit(exitCode));
  };

  transport.onclose = () => {
    void shutdown();
  };
  process.stdin.on('end', () => {
    shutdownAndExit(0, 'stdin end，准备回收所有 slot');
  });
  process.stdin.on('close', () => {
    shutdownAndExit(0, 'stdin close，准备回收所有 slot');
  });
  process.on('SIGINT', () => {
    shutdownAndExit(0, '收到 SIGINT，准备回收所有 slot');
  });
  process.on('SIGTERM', () => {
    shutdownAndExit(0, '收到 SIGTERM，准备回收所有 slot');
  });
  process.on('uncaughtException', (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    shutdownAndExit(1, '发生 uncaughtException，准备回收所有 slot');
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`${String(reason)}\n`);
    shutdownAndExit(1, '发生 unhandledRejection，准备回收所有 slot');
  });

  stopWatchingParent = startParentProcessWatcher({
    parentPid: process.ppid,
    onParentExit: async () => {
      process.stderr.write('[playwright_pool] 检测到直接父进程失联，准备回收所有 slot\n');
      await shutdown();
      process.exit(0);
    }
  });
  stopWatchingLauncher = startDetachedLauncherWatcher({
    currentPid: process.pid,
    onDetached: async () => {
      process.stderr.write('[playwright_pool] 检测到 npx/npm 启动链已脱离父进程，准备回收所有 slot\n');
      await shutdown();
      process.exit(0);
    }
  });

  await server.connect(transport);
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
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
