import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { inferBrowserProcessName } from './profile-source.js';

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

type ExecFileFn = (file: string, args: string[]) => Promise<ExecFileResult>;

type EnsureProfileDirClosedOptions = {
  platform?: NodeJS.Platform;
  execFile?: ExecFileFn;
};

const execFile = promisify(execFileCallback) as ExecFileFn;

export async function ensureProfileDirClosed(
  profileDir: string,
  options: EnsureProfileDirClosedOptions = {}
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const execFileFn = options.execFile ?? execFile;

  if (platform === 'win32') {
    await ensureWindowsBrowserClosed(profileDir, execFileFn);
    return;
  }

  await ensurePosixProfileDirClosed(profileDir, execFileFn);
}

async function ensureWindowsBrowserClosed(profileDir: string, execFileFn: ExecFileFn): Promise<void> {
  const browserProcessName = inferBrowserProcessName(profileDir);
  const imageName = inferWindowsExecutableName(browserProcessName, profileDir);
  const result = await execFileFn('tasklist', ['/FI', `IMAGENAME eq ${imageName}`]);
  if (result.stdout.toLowerCase().includes(imageName.toLowerCase())) {
    throw new Error(`检测到 ${browserProcessName} 仍在使用中，请先关闭后再继续: ${profileDir}`);
  }
}

async function ensurePosixProfileDirClosed(profileDir: string, execFileFn: ExecFileFn): Promise<void> {
  try {
    const result = await execFileFn('pgrep', ['-f', profileDir]);
    if (result.stdout.trim()) {
      throw new Error(`检测到 profile 仍在使用中，请先释放后再继续: ${profileDir}`);
    }
  } catch (error) {
    const errorLike = error as NodeJS.ErrnoException & { stderr?: string; code?: string | number };
    const exitCode = Number(errorLike.code);
    if (exitCode === 1 || errorLike.stderr === '') {
      return;
    }
    throw error;
  }
}

function inferWindowsExecutableName(browserProcessName: string, profileDir: string): string {
  switch (browserProcessName) {
    case 'Google Chrome':
      return 'chrome.exe';
    case 'Microsoft Edge':
      return 'msedge.exe';
    default: {
      const baseName = path.basename(profileDir);
      return baseName.toLowerCase().endsWith('.exe') ? baseName : `${baseName}.exe`;
    }
  }
}