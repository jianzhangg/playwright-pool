import { access } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

import {
  detectBrowserExecutablePath,
  detectBrowserProfileDir,
  resolveDefaultRuntimeRoot,
  type SupportedBrowser
} from './profile-source.js';

type BrowserChannel = 'chrome' | 'msedge';

export type InitWizardIO = {
  readLine: (prompt: string) => Promise<string>;
  writeLine: (message: string) => void;
};

export type InitWizardResult = {
  browser: SupportedBrowser;
  browserChannel: BrowserChannel;
  browserExecutablePath: string | null;
  configPath: string;
  runtimeRoot: string;
  sourceProfileDir: string;
  size: number;
};

type InitWizardOptions = {
  initialConfigPath?: string;
};

type InitWizardDependencies = {
  detectBrowserProfileDir?: (browser: SupportedBrowser) => Promise<string | null>;
  detectBrowserExecutablePath?: (browser: SupportedBrowser) => Promise<string | null>;
  resolveDefaultRuntimeRoot?: () => string;
  pathExists?: (candidate: string) => Promise<boolean>;
};

type Choice<TValue extends string> = {
  key: string;
  label: string;
  value: TValue;
};

const BROWSER_CHOICES: Array<Choice<SupportedBrowser> & { channel: BrowserChannel }> = [
  {
    key: '1',
    label: 'Google Chrome',
    value: 'chrome',
    channel: 'chrome'
  },
  {
    key: '2',
    label: 'Microsoft Edge',
    value: 'edge',
    channel: 'msedge'
  }
];

const CONFIRM_CHOICES: Array<Choice<'yes' | 'no'>> = [
  {
    key: '1',
    label: '确认',
    value: 'yes'
  },
  {
    key: '2',
    label: '取消',
    value: 'no'
  }
];

const PROFILE_SOURCE_CHOICES: Array<Choice<'detected' | 'manual'>> = [
  {
    key: '1',
    label: '使用这个目录',
    value: 'detected'
  },
  {
    key: '2',
    label: '自己输入其他目录',
    value: 'manual'
  }
];

export async function runInitWizard(
  io: InitWizardIO,
  options: InitWizardOptions = {},
  dependencies: InitWizardDependencies = {}
): Promise<InitWizardResult | null> {
  const detectProfileDir = dependencies.detectBrowserProfileDir ?? ((browser) => detectBrowserProfileDir(browser));
  const detectExecutablePath = dependencies.detectBrowserExecutablePath ?? ((browser) => detectBrowserExecutablePath(browser));
  const resolveRuntimeRoot = dependencies.resolveDefaultRuntimeRoot ?? (() => resolveDefaultRuntimeRoot());
  const pathExists = dependencies.pathExists ?? defaultPathExists;

  io.writeLine('playwright_pool 初始化向导');
  const browser = await promptChoice(io, '请选择浏览器：', BROWSER_CHOICES);
  const browserConfig = BROWSER_CHOICES.find((choice) => choice.value === browser);
  if (!browserConfig) {
    throw new Error(`不支持的浏览器: ${browser}`);
  }

  const detectedExecutablePath = await detectExecutablePath(browser);
  const browserExecutablePath = detectedExecutablePath ? path.resolve(detectedExecutablePath) : null;
  if (browserExecutablePath) {
    io.writeLine(`探测到浏览器可执行文件：${browserExecutablePath}`);
  } else {
    io.writeLine('未探测到浏览器可执行文件，后续仍会继续初始化。');
  }

  const detectedProfileDir = await detectProfileDir(browser);
  const sourceProfileDir = await resolveSourceProfileDir(io, detectedProfileDir, pathExists);
  const configFileName = options.initialConfigPath ? path.basename(options.initialConfigPath) : 'config.toml';
  const defaultRuntimeRoot = path.resolve(
    options.initialConfigPath ? path.dirname(path.resolve(options.initialConfigPath)) : resolveRuntimeRoot()
  );
  const runtimeRoot = path.resolve(
    (await io.readLine(`运行目录（直接回车使用默认值） [${defaultRuntimeRoot}]：`)).trim() || defaultRuntimeRoot
  );
  const size = await promptPositiveInteger(io, '浏览器副本数量（直接回车使用默认值） [10]：', 10);
  const configPath = path.join(runtimeRoot, configFileName);

  io.writeLine('');
  io.writeLine('请确认以下初始化配置：');
  io.writeLine(`浏览器：${browserConfig.label}`);
  io.writeLine(`浏览器可执行文件：${browserExecutablePath ?? '未探测到'}`);
  io.writeLine(`浏览器数据目录：${sourceProfileDir}`);
  io.writeLine(`运行目录：${runtimeRoot}`);
  io.writeLine(`配置文件：${configPath}`);
  io.writeLine(`浏览器副本数量：${size}`);
  const confirmed = await promptChoice(io, '确认开始初始化吗？', CONFIRM_CHOICES);
  if (confirmed !== 'yes') {
    io.writeLine('已取消初始化。');
    return null;
  }

  return {
    browser,
    browserChannel: browserConfig.channel,
    browserExecutablePath,
    configPath,
    runtimeRoot,
    sourceProfileDir,
    size
  };
}

export function createConsoleInitWizardIO(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): InitWizardIO & { close: () => void } {
  const rl = readline.createInterface({
    input,
    output
  });

  return {
    readLine: (prompt: string) => new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    }),
    writeLine: (message: string) => {
      output.write(`${message}\n`);
    },
    close: () => {
      rl.close();
    }
  };
}

async function resolveSourceProfileDir(
  io: InitWizardIO,
  detectedProfileDir: string | null,
  pathExists: (candidate: string) => Promise<boolean>
): Promise<string> {
  if (detectedProfileDir) {
    const normalizedDetectedPath = path.resolve(detectedProfileDir);
    io.writeLine(`探测到浏览器数据目录：${normalizedDetectedPath}`);
    const profileSource = await promptChoice(io, '请选择浏览器数据目录来源：', PROFILE_SOURCE_CHOICES);
    if (profileSource === 'detected') {
      return normalizedDetectedPath;
    }
  } else {
    io.writeLine('未探测到浏览器数据目录，请手动输入。');
  }

  while (true) {
    const input = (await io.readLine('请输入浏览器数据目录：')).trim();
    const candidate = path.resolve(input);
    if (!input) {
      io.writeLine('浏览器数据目录不能为空，请重新输入。');
      continue;
    }
    if (!await pathExists(candidate)) {
      io.writeLine(`路径不存在：${candidate}`);
      continue;
    }
    return candidate;
  }
}

async function promptChoice<TValue extends string>(
  io: InitWizardIO,
  title: string,
  choices: Array<Choice<TValue>>
): Promise<TValue> {
  io.writeLine(title);
  for (const choice of choices) {
    io.writeLine(`${choice.key}. ${choice.label}`);
  }

  while (true) {
    const input = (await io.readLine('请输入编号：')).trim();
    const selected = choices.find((choice) => choice.key === input);
    if (selected) {
      return selected.value;
    }
    io.writeLine('输入无效，请重新输入列表里的编号。');
  }
}

async function promptPositiveInteger(io: InitWizardIO, prompt: string, defaultValue: number): Promise<number> {
  while (true) {
    const input = (await io.readLine(prompt)).trim();
    if (!input) {
      return defaultValue;
    }

    const parsed = Number(input);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }

    io.writeLine('浏览器副本数量必须是正整数，请重新输入。');
  }
}

async function defaultPathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}
