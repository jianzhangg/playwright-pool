import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadPoolConfig } from './config.js';
import { removeDirRobustly } from './fs-utils.js';
import { prepareProfiles } from './prepare-profiles.js';
import { resolveDefaultConfigPath } from './playwright-config.js';
import { ensureProfileDirClosed } from './profile-usage.js';
import type { SupportedBrowser } from './profile-source.js';

type InitOptions = {
  browser: SupportedBrowser;
  browserChannel?: 'chrome' | 'msedge';
  browserExecutablePath?: string | null;
  configPath?: string;
  force?: boolean;
  onProgress?: (message: string) => void;
  size?: number;
  sourceProfileDir: string;
};

type InitDependencies = {
  ensureProfileDirClosed?: typeof ensureProfileDirClosed;
  mkdir?: typeof mkdir;
  loadPoolConfig?: typeof loadPoolConfig;
  prepareProfiles?: typeof prepareProfiles;
  pathExists?: (targetPath: string) => Promise<boolean>;
  removeDirRobustly?: typeof removeDirRobustly;
  removeFile?: (targetPath: string) => Promise<void>;
  writeFile?: typeof writeFile;
};

type InitResult = {
  browser: SupportedBrowser;
  browserExecutablePath: string | null;
  configPath: string;
  runtimeRoot: string;
  sourceProfileDir: string;
  size: number;
};

const DEFAULT_CHANNEL_BY_BROWSER: Record<SupportedBrowser, 'chrome' | 'msedge'> = {
  chrome: 'chrome',
  edge: 'msedge'
};

export function renderDefaultConfig(options: {
  runtimeRoot: string;
  sourceProfileDir: string;
  size: number;
  browserChannel?: 'chrome' | 'msedge';
}): string {
  const {
    runtimeRoot,
    sourceProfileDir,
    size,
    browserChannel = 'chrome'
  } = options;

  return [
    '[pool]',
    `size = ${size}`,
    `sourceProfileDir = "${sourceProfileDir}"`,
    `profileDirTemplate = "${path.join(runtimeRoot, 'profiles/{id}')}"`,
    `outputDirTemplate = "${path.join(runtimeRoot, 'output/{id}')}"`,
    `leaseDir = "${path.join(runtimeRoot, 'leases')}"`,
    `logsDir = "${path.join(runtimeRoot, 'logs')}"`,
    'heartbeatSeconds = 10',
    'staleLeaseSeconds = 120',
    'sessionKeyEnv = "CODEX_THREAD_ID"',
    '',
    '[playwright.browser]',
    'browserName = "chromium"',
    '',
    '[playwright.browser.launchOptions]',
    `channel = "${browserChannel}"`,
    'headless = false',
    ''
  ].join('\n');
}

export async function initializePlaywrightPool(
  options: InitOptions,
  dependencies: InitDependencies = {}
): Promise<InitResult> {
  const configPath = path.resolve(options.configPath ?? resolveDefaultConfigPath());
  const runtimeRoot = path.dirname(configPath);
  const size = options.size ?? 10;
  const sourceProfileDir = path.resolve(options.sourceProfileDir);
  if (!sourceProfileDir || sourceProfileDir === path.resolve('')) {
    throw new Error('初始化缺少 sourceProfileDir，请先通过向导确认或手动传入 profile 路径');
  }

  const reportProgress = options.onProgress ?? (() => undefined);
  const ensureProfileDirClosedFn = dependencies.ensureProfileDirClosed ?? ensureProfileDirClosed;
  const mkdirFn = dependencies.mkdir ?? mkdir;
  const loadPoolConfigFn = dependencies.loadPoolConfig ?? loadPoolConfig;
  const pathExistsFn = dependencies.pathExists ?? defaultPathExists;
  const prepareProfilesFn = dependencies.prepareProfiles ?? prepareProfiles;
  const removeDirRobustlyFn = dependencies.removeDirRobustly ?? removeDirRobustly;
  const removeFileFn = dependencies.removeFile ?? defaultRemoveFile;
  const writeFileFn = dependencies.writeFile ?? writeFile;
  const browserChannel = options.browserChannel ?? DEFAULT_CHANNEL_BY_BROWSER[options.browser];
  const browserExecutablePath = options.browserExecutablePath ?? null;
  const runtimeRootExisted = await pathExistsFn(runtimeRoot);
  const configPathExisted = await pathExistsFn(configPath);

  reportProgress('第 1 步/4：检查浏览器是否已完全关闭');
  try {
    await ensureProfileDirClosedFn(sourceProfileDir);
  } catch (error) {
    throw createUserFacingError(
      [
        '请先完全关闭浏览器后再继续初始化。',
        `浏览器数据目录：${sourceProfileDir}`,
        '当前还没有写入初始化文件。'
      ].join('\n')
    );
  }

  let wroteConfig = false;
  try {
    reportProgress('第 2 步/4：写入初始化配置');
    await mkdirFn(runtimeRoot, { recursive: true });
    await writeFileFn(
      configPath,
      renderDefaultConfig({
        runtimeRoot,
        sourceProfileDir,
        size,
        browserChannel
      }),
      {
        encoding: 'utf8',
        flag: options.force ? 'w' : 'wx'
      }
    );
    wroteConfig = true;

    const config = await loadPoolConfigFn(configPath);
    reportProgress('第 3 步/4：准备浏览器副本');
    await prepareProfilesFn(config, sourceProfileDir, {
      onProgress: reportProgress,
      skipSourceDirClosedCheck: true
    });
    reportProgress('第 4 步/4：初始化完成');
  } catch (error) {
    const cleanupMessages: string[] = [];
    if (!runtimeRootExisted) {
      try {
        await removeDirRobustlyFn(runtimeRoot);
        cleanupMessages.push('已清理本次新建文件。');
      } catch {
        cleanupMessages.push('可能保留部分中间文件，请删除运行目录后重试。');
      }
    } else if (wroteConfig && !configPathExisted) {
      try {
        await removeFileFn(configPath);
        cleanupMessages.push('已删除本次新建的配置文件。');
      } catch {
        cleanupMessages.push('配置文件可能已写入，请确认后手动删除。');
      }
    }

    throw createUserFacingError(
      ['初始化失败。', formatErrorMessage(error), ...cleanupMessages].filter(Boolean).join('\n')
    );
  }

  return {
    browser: options.browser,
    browserExecutablePath,
    configPath,
    runtimeRoot,
    sourceProfileDir,
    size
  };
}

function createUserFacingError(message: string): Error {
  const error = new Error(message);
  error.name = 'UserFacingError';
  error.stack = undefined;
  return error;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function defaultRemoveFile(targetPath: string): Promise<void> {
  await rm(targetPath, { force: true });
}
