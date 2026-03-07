import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import TOML from 'toml';

import type { PlaywrightPoolConfig, PoolConfig, PoolSlotPaths } from './types.js';

type RawConfig = {
  pool?: Partial<PoolConfig>;
  playwright?: Record<string, unknown>;
};

function assertString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`配置项 ${fieldName} 必填，且必须是非空字符串`);
  }
  return value;
}

function assertNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    throw new Error(`配置项 ${fieldName} 必填，且必须是正数`);
  }
  return value;
}

function normalizePath(rawPath: string): string {
  if (rawPath.startsWith('~/')) {
    return path.join(process.env.HOME ?? '', rawPath.slice(2));
  }
  return rawPath;
}

function resolvePathApi(samplePath: string): typeof path.posix | typeof path.win32 {
  return /^[A-Za-z]:[\\/]/.test(samplePath) || samplePath.includes('\\') ? path.win32 : path.posix;
}

function joinPreservingPathStyle(basePath: string, ...segments: string[]): string {
  return resolvePathApi(basePath).join(basePath, ...segments);
}

export function buildSlotPaths(poolConfig: PoolConfig, slotId: number): PoolSlotPaths {
  const slotText = String(slotId);
  const profileDir = normalizePath(poolConfig.profileDirTemplate).replaceAll('{id}', slotText);
  const outputDir = normalizePath(poolConfig.outputDirTemplate).replaceAll('{id}', slotText);
  const leaseDir = normalizePath(poolConfig.leaseDir);
  const logsDir = normalizePath(poolConfig.logsDir);

  return {
    profileDir,
    outputDir,
    logFile: joinPreservingPathStyle(logsDir, `slot-${slotText}.log`),
    leaseFile: joinPreservingPathStyle(leaseDir, `slot-${slotText}.json`),
    lockDir: joinPreservingPathStyle(leaseDir, `slot-${slotText}.lock`)
  };
}

function parsePoolConfig(rawPool: Partial<PoolConfig> | undefined): PoolConfig {
  const leaseDir = normalizePath(assertString(rawPool?.leaseDir, 'pool.leaseDir'));
  return {
    size: assertNumber(rawPool?.size, 'pool.size'),
    sourceProfileDir:
      rawPool?.sourceProfileDir === undefined ? undefined : normalizePath(assertString(rawPool.sourceProfileDir, 'pool.sourceProfileDir')),
    profileDirTemplate: normalizePath(assertString(rawPool?.profileDirTemplate, 'pool.profileDirTemplate')),
    outputDirTemplate: normalizePath(assertString(rawPool?.outputDirTemplate, 'pool.outputDirTemplate')),
    leaseDir,
    logsDir: normalizePath(assertString(rawPool?.logsDir ?? joinPreservingPathStyle(leaseDir, '..', 'logs'), 'pool.logsDir')),
    heartbeatSeconds: rawPool?.heartbeatSeconds === undefined ? 10 : assertNumber(rawPool.heartbeatSeconds, 'pool.heartbeatSeconds'),
    staleLeaseSeconds: rawPool?.staleLeaseSeconds === undefined ? 60 : assertNumber(rawPool.staleLeaseSeconds, 'pool.staleLeaseSeconds'),
    sessionKeyEnv: assertString(rawPool?.sessionKeyEnv ?? 'CODEX_THREAD_ID', 'pool.sessionKeyEnv')
  };
}

export async function loadPoolConfig(configPath: string | URL): Promise<PlaywrightPoolConfig> {
  const absolutePath = configPath instanceof URL ? configPath : path.resolve(configPath);
  const fileContent = await readFile(absolutePath, 'utf8');
  const parsed = TOML.parse(fileContent) as RawConfig;
  const pool = parsePoolConfig(parsed.pool);

  await Promise.all([
    mkdir(pool.leaseDir, { recursive: true }),
    mkdir(pool.logsDir, { recursive: true })
  ]);

  return {
    pool,
    playwright: parsed.playwright ?? {}
  };
}
