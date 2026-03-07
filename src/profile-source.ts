import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type SupportedBrowser = 'chrome' | 'edge';

type DetectPathOptions = {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (candidate: string) => Promise<boolean>;
};

export type ResolveRuntimeRootOptions = {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  resolveWindowsDocumentsPath?: (env: NodeJS.ProcessEnv) => string | null;
};

type BrowserMetadata = {
  channel: 'chrome' | 'msedge';
  displayName: string;
  executableName: string;
  macAppName: string;
  processName: string;
  windowsVendorPath: string;
  macProfileSuffix: string;
  linuxProfileCandidates: string[];
  linuxExecutableCandidates: string[];
};

const SOURCE_TO_PROCESS_NAME: Array<[pattern: string, processName: string]> = [
  ['/Microsoft Edge', 'Microsoft Edge'],
  ['/Microsoft/Edge', 'Microsoft Edge'],
  ['/Google/Chrome', 'Google Chrome']
];

const BROWSER_METADATA: Record<SupportedBrowser, BrowserMetadata> = {
  chrome: {
    channel: 'chrome',
    displayName: 'Google Chrome',
    executableName: 'chrome.exe',
    macAppName: 'Google Chrome',
    processName: 'Google Chrome',
    windowsVendorPath: 'Google/Chrome',
    macProfileSuffix: 'Library/Application Support/Google/Chrome',
    linuxProfileCandidates: ['.config/google-chrome', '.config/google-chrome-stable'],
    linuxExecutableCandidates: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']
  },
  edge: {
    channel: 'msedge',
    displayName: 'Microsoft Edge',
    executableName: 'msedge.exe',
    macAppName: 'Microsoft Edge',
    processName: 'Microsoft Edge',
    windowsVendorPath: 'Microsoft/Edge',
    macProfileSuffix: 'Library/Application Support/Microsoft Edge',
    linuxProfileCandidates: ['.config/microsoft-edge', '.config/microsoft-edge-stable'],
    linuxExecutableCandidates: ['/opt/microsoft/msedge/msedge', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable']
  }
};

function resolvePathApi(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
  return platform === 'win32' ? path.win32 : path.posix;
}

function joinForPlatform(platform: NodeJS.Platform, ...segments: string[]): string {
  return resolvePathApi(platform).join(...segments);
}

function resolveRuntimeOptions(
  homeDirOrOptions?: string | ResolveRuntimeRootOptions,
  maybePlatform?: NodeJS.Platform
): ResolveRuntimeRootOptions {
  if (typeof homeDirOrOptions === 'string' || homeDirOrOptions === undefined) {
    return {
      homeDir: homeDirOrOptions,
      platform: maybePlatform
    };
  }

  return homeDirOrOptions;
}

function resolveBrowserMetadata(browser: SupportedBrowser): BrowserMetadata {
  return BROWSER_METADATA[browser];
}

function normalizeSourceDir(sourceDir: string): string {
  return sourceDir.replace(/\\/g, '/');
}

export function inferBrowserProcessName(sourceDir: string): string {
  const normalized = normalizeSourceDir(sourceDir);
  const matched = SOURCE_TO_PROCESS_NAME.find(([pattern]) => normalized.includes(pattern));
  if (matched) {
    return matched[1];
  }

  return path.basename(sourceDir);
}

export function resolveDocumentsDir(
  homeDirOrOptions?: string | ResolveRuntimeRootOptions,
  maybePlatform?: NodeJS.Platform
): string {
  const options = resolveRuntimeOptions(homeDirOrOptions, maybePlatform);
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;

  if (platform === 'win32') {
    const resolvedDocuments = (options.resolveWindowsDocumentsPath ?? defaultResolveWindowsDocumentsPath)(env);
    if (resolvedDocuments) {
      return resolvedDocuments;
    }

    return joinForPlatform('win32', env.USERPROFILE ?? homeDir, 'Documents');
  }

  return joinForPlatform(platform, homeDir, 'Documents');
}

export function resolveDefaultRuntimeRoot(
  homeDirOrOptions?: string | ResolveRuntimeRootOptions,
  maybePlatform?: NodeJS.Platform
): string {
  const options = resolveRuntimeOptions(homeDirOrOptions, maybePlatform);
  const platform = options.platform ?? process.platform;
  return joinForPlatform(platform, resolveDocumentsDir(options), 'playwright-pool');
}

export function listBrowserProfileCandidates(
  browser: SupportedBrowser,
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform
): string[] {
  const metadata = resolveBrowserMetadata(browser);

  switch (platform) {
    case 'darwin':
      return [joinForPlatform(platform, homeDir, metadata.macProfileSuffix)];
    case 'win32':
      return [joinForPlatform(platform, homeDir, `AppData/Local/${metadata.windowsVendorPath}/User Data`)];
    default:
      return metadata.linuxProfileCandidates.map((candidate) => joinForPlatform(platform, homeDir, candidate));
  }
}

export function listChromeProfileCandidates(
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform
): string[] {
  return listBrowserProfileCandidates('chrome', homeDir, platform);
}

export function listBrowserExecutableCandidates(
  browser: SupportedBrowser,
  options: Omit<DetectPathOptions, 'pathExists'> = {}
): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const metadata = resolveBrowserMetadata(browser);

  switch (platform) {
    case 'darwin':
      return [`/Applications/${metadata.macAppName}.app/Contents/MacOS/${metadata.macAppName}`];
    case 'win32':
      return [
        joinForPlatform(platform, env.PROGRAMFILES ?? 'C:/Program Files', `${metadata.windowsVendorPath}/Application/${metadata.executableName}`),
        joinForPlatform(platform, env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', `${metadata.windowsVendorPath}/Application/${metadata.executableName}`),
        joinForPlatform(platform, env.LOCALAPPDATA ?? joinForPlatform(platform, homeDir, 'AppData/Local'), `${metadata.windowsVendorPath}/Application/${metadata.executableName}`)
      ];
    default:
      return metadata.linuxExecutableCandidates;
  }
}

export function listChromeExecutableCandidates(options: Omit<DetectPathOptions, 'pathExists'> = {}): string[] {
  return listBrowserExecutableCandidates('chrome', options);
}

export async function detectBrowserProfileDir(
  browser: SupportedBrowser,
  options: DetectPathOptions = {}
): Promise<string | null> {
  return detectFirstExistingPath(
    listBrowserProfileCandidates(browser, options.homeDir, options.platform),
    options.pathExists
  );
}

export async function detectChromeProfileDir(options: DetectPathOptions = {}): Promise<string | null> {
  return detectBrowserProfileDir('chrome', options);
}

export async function detectBrowserExecutablePath(
  browser: SupportedBrowser,
  options: DetectPathOptions = {}
): Promise<string | null> {
  return detectFirstExistingPath(
    listBrowserExecutableCandidates(browser, options),
    options.pathExists
  );
}

export async function detectChromeExecutablePath(options: DetectPathOptions = {}): Promise<string | null> {
  return detectBrowserExecutablePath('chrome', options);
}

function defaultResolveWindowsDocumentsPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const keys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders'
  ];

  for (const key of keys) {
    const rawValue = queryWindowsRegistryValue(key, 'Personal');
    const expanded = expandWindowsEnvironmentVariables(rawValue, env);
    if (expanded) {
      return expanded;
    }
  }

  return null;
}

function queryWindowsRegistryValue(key: string, valueName: string): string | null {
  const result = spawnSync('reg.exe', ['query', key, '/v', valueName], {
    encoding: 'utf8',
    windowsHide: true
  });

  if (result.status !== 0) {
    return null;
  }

  const line = result.stdout
    .split(/\r?\n/)
    .find((entry) => entry.includes(valueName) && entry.includes('REG_'));
  const match = line?.match(/\sREG_\w+\s+(.*)$/);
  return match?.[1]?.trim() ?? null;
}

function expandWindowsEnvironmentVariables(rawPath: string | null, env: NodeJS.ProcessEnv): string | null {
  if (!rawPath) {
    return null;
  }

  return rawPath.replace(/%([^%]+)%/g, (_, name: string) => env[name] ?? `%${name}%`);
}

async function detectFirstExistingPath(
  candidates: string[],
  pathExists: (candidate: string) => Promise<boolean> = defaultPathExists
): Promise<string | null> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function defaultPathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}
