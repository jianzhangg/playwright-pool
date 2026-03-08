import { execFile as execFileCallback } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export type WindowsProcessInfo = {
  pid: number;
  name: string;
  commandLine: string | null;
};

type ExecFileLike = (
  file: string,
  args: string[]
) => Promise<{
  stdout: string;
  stderr: string;
}>;

export async function killProfileProcesses(
  profileDir: string,
  dependencies: {
    platform?: NodeJS.Platform;
    execFileAsync?: ExecFileLike;
  } = {}
): Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  const execFileAsync = dependencies.execFileAsync ?? (execFile as ExecFileLike);

  if (platform === 'win32') {
    await killWindowsProfileProcesses(profileDir, execFileAsync);
    return;
  }

  try {
    await execFileAsync('pkill', ['-f', profileDir]);
  } catch (error) {
    const errorLike = error as NodeJS.ErrnoException & { stderr?: string; code?: string | number };
    if (Number(errorLike.code) === 1 || errorLike.stderr === '') {
      return;
    }
  }
}

export function selectWindowsProfileBrowserPids(profileDir: string, processes: WindowsProcessInfo[]): number[] {
  const normalizedProfileDir = normalizeForMatch(profileDir);

  return processes
    .filter((processInfo) => /^(msedge|chrome)\.exe$/i.test(processInfo.name))
    .filter((processInfo) => typeof processInfo.commandLine === 'string')
    .filter((processInfo) => normalizeForMatch(processInfo.commandLine ?? '').includes(normalizedProfileDir))
    .map((processInfo) => processInfo.pid);
}

export function parseWindowsProcessList(output: string): WindowsProcessInfo[] {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as
    | { ProcessId?: number; Name?: string; CommandLine?: string | null }
    | Array<{ ProcessId?: number; Name?: string; CommandLine?: string | null }>;
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items
    .map((item) => ({
      pid: Number(item.ProcessId),
      name: String(item.Name ?? ''),
      commandLine: typeof item.CommandLine === 'string' ? item.CommandLine : null
    }))
    .filter((item) => Number.isInteger(item.pid) && item.pid > 0 && item.name.length > 0);
}

async function killWindowsProfileProcesses(profileDir: string, execFileAsync: ExecFileLike): Promise<void> {
  const processes = await loadWindowsBrowserProcesses(execFileAsync).catch(() => []);
  const pids = selectWindowsProfileBrowserPids(profileDir, processes);
  if (pids.length === 0) {
    return;
  }

  await Promise.all(
    pids.map((pid) => execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F']).catch(() => undefined))
  );
}

async function loadWindowsBrowserProcesses(execFileAsync: ExecFileLike): Promise<WindowsProcessInfo[]> {
  const script = [
    "$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -in @('msedge.exe', 'chrome.exe') }",
    "$processes | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress"
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
  return parseWindowsProcessList(stdout);
}

function normalizeForMatch(value: string): string {
  return value.replaceAll('/', '\\').toLowerCase();
}
