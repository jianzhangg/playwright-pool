import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadPoolConfig } from './config.js';
import { prepareProfiles } from './prepare-profiles.js';
import { resolveDefaultConfigPath } from './playwright-config.js';
import {
  detectChromeExecutablePath,
  detectChromeProfileDir,
  resolveDefaultRuntimeRoot
} from './profile-source.js';

type InitOptions = {
  configPath?: string;
  force?: boolean;
  size?: number;
};

type InitResult = {
  configPath: string;
  runtimeRoot: string;
  sourceProfileDir: string;
  chromeExecutablePath: string;
  size: number;
};

export function renderDefaultConfig(options: {
  runtimeRoot: string;
  sourceProfileDir: string;
  size: number;
}): string {
  const { runtimeRoot, sourceProfileDir, size } = options;

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
    'channel = "chrome"',
    'headless = false',
    ''
  ].join('\n');
}

export async function initializePlaywrightPool(options: InitOptions = {}): Promise<InitResult> {
  const configPath = path.resolve(options.configPath ?? resolveDefaultConfigPath());
  const runtimeRoot = path.dirname(configPath);
  const size = options.size ?? 10;
  const chromeExecutablePath = await detectChromeExecutablePath();
  if (!chromeExecutablePath) {
    throw new Error('未检测到本机 Google Chrome，请先安装 Chrome 后再执行 init');
  }

  const sourceProfileDir = await detectChromeProfileDir();
  if (!sourceProfileDir) {
    throw new Error('未检测到本机 Google Chrome 默认 profile 目录，请登录 Chrome 后重试或手动配置 sourceProfileDir');
  }

  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    configPath,
    renderDefaultConfig({
      runtimeRoot,
      sourceProfileDir,
      size
    }),
    {
      encoding: 'utf8',
      flag: options.force ? 'w' : 'wx'
    }
  );

  const config = await loadPoolConfig(configPath);
  await prepareProfiles(config, sourceProfileDir);

  return {
    configPath,
    runtimeRoot,
    sourceProfileDir,
    chromeExecutablePath,
    size
  };
}
