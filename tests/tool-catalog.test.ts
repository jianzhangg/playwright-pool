import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRegisteredTools } from '../src/tool-catalog.js';

describe('resolveRegisteredTools', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'playwright-pool-tools-'));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it('存在 manifest 时直接返回缓存工具，不再触发 discoverTools', async () => {
    const manifestPath = join(rootDir, 'tool-manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify([
        {
          name: 'browser_tabs',
          description: 'Manage tabs',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' }
            }
          }
        }
      ]),
      'utf8'
    );

    const discoverTools = vi.fn();
    const tools = await resolveRegisteredTools(manifestPath, {
      discoverTools
    });

    expect(tools.map((tool) => tool.name)).toEqual(['browser_tabs']);
    expect(discoverTools).not.toHaveBeenCalled();
  });

  it('manifest 缺失时抛出明确错误，而不是静默回退到浏览器发现', async () => {
    const discoverTools = vi.fn();

    await expect(
      resolveRegisteredTools(join(rootDir, 'missing.json'), {
        discoverTools
      })
    ).rejects.toThrow(/tool manifest/);
    expect(discoverTools).not.toHaveBeenCalled();
  });
});
