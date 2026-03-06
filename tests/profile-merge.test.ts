import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildGoldenProfile, copyMissingOriginDirs, mergeCookies } from '../src/profile-merge.js';

const execFile = promisify(execFileCallback);

describe('profile merge', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'playwright-pool-merge-'));
  });

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true });
  });

  it('合并 Cookies 时会保留新域名，并用较新的 last_update 覆盖旧值', async () => {
    const targetDb = join(rootDir, 'target.sqlite');
    const overlayDb = join(rootDir, 'overlay.sqlite');

    await createCookieDb(targetDb, [
      {
        host: '.example.com',
        name: 'sid',
        value: 'base',
        encryptedValueHex: '62617365',
        lastUpdateUtc: 100
      }
    ]);
    await createCookieDb(overlayDb, [
      {
        host: '.example.com',
        name: 'sid',
        value: 'overlay',
        encryptedValueHex: '6f7665726c6179',
        lastUpdateUtc: 200
      },
      {
        host: '.new.com',
        name: 'token',
        value: 'new-domain',
        encryptedValueHex: '6e65772d646f6d61696e',
        lastUpdateUtc: 150
      }
    ]);

    await mergeCookies(targetDb, overlayDb);

    const result = await queryLines(
      targetDb,
      "select host_key || '|' || name || '|' || value || '|' || hex(encrypted_value) || '|' || last_update_utc from cookies order by host_key, name;"
    );

    expect(result).toEqual([
      '.example.com|sid|overlay|6F7665726C6179|200',
      '.new.com|token|new-domain|6E65772D646F6D61696E|150'
    ]);
  });

  it('只复制 overlay 中缺失的 IndexedDB 目录，不覆盖母版已有目录', async () => {
    const targetRoot = join(rootDir, 'target');
    const overlayRoot = join(rootDir, 'overlay');

    await mkdir(join(targetRoot, 'existing.indexeddb.leveldb'), { recursive: true });
    await writeFile(join(targetRoot, 'existing.indexeddb.leveldb', 'marker.txt'), 'target', 'utf8');

    await mkdir(join(overlayRoot, 'existing.indexeddb.leveldb'), { recursive: true });
    await writeFile(join(overlayRoot, 'existing.indexeddb.leveldb', 'marker.txt'), 'overlay', 'utf8');
    await mkdir(join(overlayRoot, 'new.indexeddb.leveldb'), { recursive: true });
    await writeFile(join(overlayRoot, 'new.indexeddb.leveldb', 'marker.txt'), 'new', 'utf8');

    await copyMissingOriginDirs(targetRoot, overlayRoot);

    await expect(readFile(join(targetRoot, 'existing.indexeddb.leveldb', 'marker.txt'), 'utf8')).resolves.toBe('target');
    await expect(readFile(join(targetRoot, 'new.indexeddb.leveldb', 'marker.txt'), 'utf8')).resolves.toBe('new');
  });

  it('构建 golden profile 时会复制母版、合并 Cookies，并清理锁文件', async () => {
    const baseDir = join(rootDir, 'base');
    const overlayDir = join(rootDir, 'overlay');
    const targetDir = join(rootDir, 'target');

    await mkdir(join(baseDir, 'Default', 'IndexedDB', 'existing.indexeddb.leveldb'), { recursive: true });
    await mkdir(join(baseDir, 'Default', 'Sessions'), { recursive: true });
    await writeFile(join(baseDir, 'Default', 'IndexedDB', 'existing.indexeddb.leveldb', 'marker.txt'), 'base', 'utf8');
    await writeFile(join(baseDir, 'Default', 'Sessions', 'Session_1'), 'session', 'utf8');
    await writeFile(join(baseDir, 'SingletonLock'), 'lock', 'utf8');
    await createCookieDb(join(baseDir, 'Default', 'Cookies'), [
      {
        host: '.base.com',
        name: 'base',
        value: 'base',
        encryptedValueHex: '62617365',
        lastUpdateUtc: 100
      }
    ]);

    await mkdir(join(overlayDir, 'Default', 'IndexedDB', 'new.indexeddb.leveldb'), { recursive: true });
    await writeFile(join(overlayDir, 'Default', 'IndexedDB', 'new.indexeddb.leveldb', 'marker.txt'), 'overlay', 'utf8');
    await createCookieDb(join(overlayDir, 'Default', 'Cookies'), [
      {
        host: '.overlay.com',
        name: 'token',
        value: 'overlay',
        encryptedValueHex: '6f7665726c6179',
        lastUpdateUtc: 200
      }
    ]);

    await buildGoldenProfile({
      baseDir,
      overlayDirs: [overlayDir],
      targetDir
    });

    const cookies = await queryLines(
      join(targetDir, 'Default', 'Cookies'),
      "select host_key || '|' || name from cookies order by host_key, name;"
    );
    expect(cookies).toEqual(['.base.com|base', '.overlay.com|token']);
    await expect(readFile(join(targetDir, 'Default', 'IndexedDB', 'new.indexeddb.leveldb', 'marker.txt'), 'utf8')).resolves.toBe('overlay');
    await expect(readFile(join(targetDir, 'Default', 'Sessions', 'Session_1'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(targetDir, 'SingletonLock'), 'utf8')).rejects.toThrow();
  });
});

async function createCookieDb(dbPath: string, rows: Array<{
  host: string;
  name: string;
  value: string;
  encryptedValueHex: string;
  lastUpdateUtc: number;
}>): Promise<void> {
  await mkdir(dirname(dbPath), { recursive: true });
  const statements = [
    'create table cookies(',
    'creation_utc integer not null,',
    'host_key text not null,',
    'top_frame_site_key text not null,',
    'name text not null,',
    'value text not null,',
    'encrypted_value blob not null,',
    'path text not null,',
    'expires_utc integer not null,',
    'is_secure integer not null,',
    'is_httponly integer not null,',
    'last_access_utc integer not null,',
    'has_expires integer not null,',
    'is_persistent integer not null,',
    'priority integer not null,',
    'samesite integer not null,',
    'source_scheme integer not null,',
    'source_port integer not null,',
    'last_update_utc integer not null,',
    'source_type integer not null,',
    'has_cross_site_ancestor integer not null',
    ');',
    'create unique index cookies_unique_index on cookies(host_key, top_frame_site_key, has_cross_site_ancestor, name, path, source_scheme, source_port);'
  ];

  for (const row of rows) {
    statements.push(
      `insert into cookies values (1, '${row.host}', '', '${row.name}', '${row.value}', X'${row.encryptedValueHex}', '/', 999, 0, 0, 1, 1, 1, 1, 0, 0, 443, ${row.lastUpdateUtc}, 0, 0);`
    );
  }

  await execFile('sqlite3', [dbPath, statements.join('\n')]);
}

async function queryLines(dbPath: string, sql: string): Promise<string[]> {
  const result = await execFile('sqlite3', [dbPath, sql]);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
