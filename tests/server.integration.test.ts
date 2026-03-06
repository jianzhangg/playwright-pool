import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CompatibilityCallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('server integration', () => {
  let rootDir: string;
  let configPath: string;
  let client: Client | null;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'playwright-pool-int-'));
    configPath = join(rootDir, 'playwright-pool.local.toml');
    client = null;

    await writeFile(
      configPath,
      [
        '[pool]',
        'size = 2',
        `profileDirTemplate = "${join(rootDir, 'profiles/{id}')}"`,
        `outputDirTemplate = "${join(rootDir, 'output/{id}')}"`,
        `leaseDir = "${join(rootDir, 'leases')}"`,
        `logsDir = "${join(rootDir, 'logs')}"`,
        'heartbeatSeconds = 5',
        'staleLeaseSeconds = 30',
        'sessionKeyEnv = "CODEX_THREAD_ID"',
        '',
        '[playwright.browser]',
        'browserName = "chromium"'
      ].join('\n'),
      'utf8'
    );
  });

  afterEach(async () => {
    await client?.close().catch(() => undefined);
    await rm(rootDir, { force: true, recursive: true });
  });

  it('通过 stdio 暴露官方工具，并支持查询 pool_status', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.resolve(process.cwd(), 'src/server.ts'), '--config', configPath],
      cwd: process.cwd(),
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      ),
      stderr: 'pipe'
    });
    client = new Client(
      {
        name: 'playwright-pool-integration-test',
        version: '0.1.0'
      },
      {
        capabilities: {}
      }
    );

    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'pool_status')).toBe(true);
    expect(tools.tools.some((tool) => tool.name.startsWith('browser_'))).toBe(true);

    const result = (await client.callTool(
      {
        name: 'pool_status',
        arguments: {}
      },
      CompatibilityCallToolResultSchema
    )) as {
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
    };

    expect(result.structuredContent).toMatchObject({
      leases: []
    });
    expect((result.content[0] as { text: string }).text).toContain('当前没有活跃租约');
  });
});
