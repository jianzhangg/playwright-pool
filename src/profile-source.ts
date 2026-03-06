import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SOURCE_TO_PROCESS_NAME: Array<[pattern: string, processName: string]> = [
  ['/Microsoft Edge', 'Microsoft Edge'],
  ['/Google/Chrome', 'Google Chrome']
];

type DetectPathOptions = {
  homeDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathExists?: (candidate: string) => Promise<boolean>;
};

export function inferBrowserProcessName(sourceDir: string): string {
  const matched = SOURCE_TO_PROCESS_NAME.find(([pattern]) => sourceDir.includes(pattern));
  if (matched) {
    return matched[1];
  }

  return path.basename(sourceDir);
}

export function resolveDocumentsDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, 'Documents');
}

export function resolveDefaultRuntimeRoot(homeDir: string = os.homedir()): string {
  return path.join(resolveDocumentsDir(homeDir), 'playwright-pool');
}

export function listChromeProfileCandidates(
  homeDir: string = os.homedir(),
  platform: NodeJS.Platform = process.platform
): string[] {
  switch (platform) {
    case 'darwin':
      return [
        path.join(homeDir, 'Library/Application Support/Google/Chrome')
      ];
    case 'win32':
      return [
        path.join(homeDir, 'AppData/Local/Google/Chrome/User Data')
      ];
    default:
      return [
        path.join(homeDir, '.config/google-chrome'),
        path.join(homeDir, '.config/google-chrome-stable')
      ];
  }
}

export function listChromeExecutableCandidates(options: Omit<DetectPathOptions, 'pathExists'> = {}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  switch (platform) {
    case 'darwin':
      return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    case 'win32':
      return [
        path.join(env['PROGRAMFILES'] ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
        path.join(env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
        path.join(env.LOCALAPPDATA ?? path.join(options.homeDir ?? os.homedir(), 'AppData/Local'), 'Google/Chrome/Application/chrome.exe')
      ];
    default:
      return [
        '/opt/google/chrome/chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
      ];
  }
}

export async function detectChromeProfileDir(options: DetectPathOptions = {}): Promise<string | null> {
  return detectFirstExistingPath(
    listChromeProfileCandidates(options.homeDir, options.platform),
    options.pathExists
  );
}

export async function detectChromeExecutablePath(options: DetectPathOptions = {}): Promise<string | null> {
  return detectFirstExistingPath(
    listChromeExecutableCandidates(options),
    options.pathExists
  );
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
