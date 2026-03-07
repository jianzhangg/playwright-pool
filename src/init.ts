import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadPoolConfig } from './config.js';
import { prepareProfiles } from './prepare-profiles.js';
import { resolveDefaultConfigPath } from './playwright-config.js';
import type { SupportedBrowser } from './profile-source.js';

type InitOptions = {
  browser: SupportedBrowser;
  browserChannel?: 'chrome' | 'msedge';
  browserExecutablePath?: string | null;
  configPath?: string;
  force?: boolean;
  size?: number;
  sourceProfileDir: string;
};

type InitDependencies = {
  mkdir?: typeof mkdir;
  writeFile?: typeof writeFile;
  loadPoolConfig?: typeof loadPoolConfig;
  prepareProfiles?: typeof prepareProfiles;
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

  const mkdirFn = dependencies.mkdir ?? mkdir;
  const writeFileFn = dependencies.writeFile ?? writeFile;
  const loadPoolConfigFn = dependencies.loadPoolConfig ?? loadPoolConfig;
  const prepareProfilesFn = dependencies.prepareProfiles ?? prepareProfiles;
  const browserChannel = options.browserChannel ?? DEFAULT_CHANNEL_BY_BROWSER[options.browser];
  const browserExecutablePath = options.browserExecutablePath ?? null;

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

  const config = await loadPoolConfigFn(configPath);
  await prepareProfilesFn(config, sourceProfileDir);

  return {
    browser: options.browser,
    browserExecutablePath,
    configPath,
    runtimeRoot,
    sourceProfileDir,
    size
  };
}
