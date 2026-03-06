#!/usr/bin/env node

import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';

import { parseCliInput } from './cli.js';
import { loadPoolConfig } from './config.js';
import { isExecutedAsCli } from './execution-mode.js';
import { initializePlaywrightPool } from './init.js';
import { LeaseManager } from './lease-manager.js';
import { buildSlotPlaywrightConfig, resolveDefaultConfigPath } from './playwright-config.js';
import { PoolService } from './pool-service.js';
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
      callTool: (slotId, toolName, toolArgs) => slotRuntime.callTool(slotId, toolName, toolArgs),
      listStatuses: () => slotRuntime.listStatuses()
    }
  });

  const server = new Server(
    {
      name: 'playwright_pool',
      version: '0.1.0'
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
    const result = await poolService.callTool(
      {
        name: request.params.name,
        arguments: (request.params.arguments ?? {}) as Record<string, unknown>
      },
      process.env
    );
    return result as ToolCallResult;
  });

  const transport = new StdioServerTransport();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await poolService.shutdown().catch(() => undefined);
    await slotRuntime.closeAll().catch(() => undefined);
    await server.close().catch(() => undefined);
  };

  transport.onclose = () => {
    void shutdown();
  };
  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('uncaughtException', (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    void shutdown().finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`${String(reason)}\n`);
    void shutdown().finally(() => process.exit(1));
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
