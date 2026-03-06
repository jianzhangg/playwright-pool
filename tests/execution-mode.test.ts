import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isExecutedAsCli } from '../src/execution-mode.js';

describe('execution mode', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((dirPath) => rm(dirPath, { force: true, recursive: true })));
  });

  it('直接用入口文件启动时返回 true', () => {
    const entryPath = '/tmp/playwright-pool/dist/src/server.js';
    const importMetaUrl = `file://${entryPath}`;

    expect(isExecutedAsCli(importMetaUrl, entryPath)).toBe(true);
  });

  it('通过 npm .bin 符号链接启动时也返回 true', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'playwright-pool-cli-'));
    cleanupDirs.push(tempRoot);

    const actualEntry = path.join(tempRoot, 'dist/src/server.js');
    const binDir = path.join(tempRoot, 'node_modules/.bin');
    const linkedEntry = path.join(binDir, 'playwright-pool');

    await mkdir(path.dirname(actualEntry), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await writeFile(actualEntry, '#!/usr/bin/env node\n', 'utf8');
    await symlink(actualEntry, linkedEntry);

    expect(isExecutedAsCli(`file://${actualEntry}`, linkedEntry)).toBe(true);
  });

  it('无关路径不会被误判为 CLI 启动', () => {
    expect(isExecutedAsCli('file:///tmp/playwright-pool/dist/src/server.js', '/tmp/other-tool')).toBe(false);
  });
});
