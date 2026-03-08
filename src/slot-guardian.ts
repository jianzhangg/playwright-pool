import process from 'node:process';

type CleanupFunction = () => Promise<void> | void;

export type ProcessInfo = {
  pid: number;
  ppid: number;
  command: string;
};

type ParentWatcherOptions = {
  parentPid: number;
  onParentExit: CleanupFunction;
  intervalMs?: number;
  isProcessAlive?: (pid: number) => boolean;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export function createCleanupOnce(cleanup: CleanupFunction): () => Promise<void> {
  let cleanupPromise: Promise<void> | null = null;

  return async () => {
    if (!cleanupPromise) {
      cleanupPromise = Promise.resolve().then(async () => {
        await cleanup();
      });
    }

    await cleanupPromise;
  };
}

export function startParentProcessWatcher(options: ParentWatcherOptions): () => void {
  const {
    parentPid,
    onParentExit,
    intervalMs = 1000,
    isProcessAlive = defaultIsProcessAlive,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = options;

  if (!Number.isInteger(parentPid) || parentPid <= 1) {
    return () => undefined;
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (timer) {
      clearIntervalFn(timer);
    }
  };

  const checkParent = () => {
    if (stopped) {
      return;
    }

    if (isProcessAlive(parentPid)) {
      return;
    }

    stop();
    void onParentExit();
  };

  timer = setIntervalFn(checkParent, intervalMs) as NodeJS.Timeout;
  timer.unref?.();

  return stop;
}

type LauncherWatcherOptions = {
  currentPid: number;
  onDetached: CleanupFunction;
  intervalMs?: number;
  loadLineage?: (pid: number) => Promise<ProcessInfo[]>;
  launcherMatcher?: (processInfo: ProcessInfo) => boolean;
  platform?: NodeJS.Platform;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
};

export function isDetachedLauncherChain(
  lineage: ProcessInfo[],
  launcherMatcher: (processInfo: ProcessInfo) => boolean = defaultLauncherMatcher,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (lineage.length === 0) {
    return false;
  }

  if (platform === 'win32') {
    const ancestors = lineage.slice(1);
    let sawLauncher = false;

    for (const processInfo of ancestors) {
      if (launcherMatcher(processInfo)) {
        sawLauncher = true;
        continue;
      }

      return false;
    }

    return sawLauncher;
  }

  return lineage.some((processInfo, index) => {
    if (index === 0) {
      return false;
    }

    return processInfo.ppid === 1 && launcherMatcher(processInfo);
  });
}

export function startDetachedLauncherWatcher(options: LauncherWatcherOptions): () => void {
  const {
    currentPid,
    onDetached,
    intervalMs = 1000,
    launcherMatcher = defaultLauncherMatcher,
    platform = process.platform,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = options;
  const loadLineage = options.loadLineage ?? ((pid: number) => loadProcessLineage(pid, platform));

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let checking = false;

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (timer) {
      clearIntervalFn(timer);
    }
  };

  const checkDetached = async () => {
    if (stopped || checking) {
      return;
    }

    checking = true;
    try {
      const lineage = await loadLineage(currentPid);
      if (!isDetachedLauncherChain(lineage, launcherMatcher, platform)) {
        return;
      }

      stop();
      await onDetached();
    } finally {
      checking = false;
    }
  };

  timer = setIntervalFn(() => {
    void checkDetached();
  }, intervalMs);
  timer.unref?.();

  return stop;
}

export async function loadProcessLineage(
  pid: number,
  platform: NodeJS.Platform = process.platform
): Promise<ProcessInfo[]> {
  const lineage: ProcessInfo[] = [];
  const visited = new Set<number>();
  let currentPid = pid;

  while (Number.isInteger(currentPid) && currentPid > 1 && !visited.has(currentPid)) {
    visited.add(currentPid);
    const processInfo = await readProcessInfo(currentPid, platform);
    if (!processInfo) {
      break;
    }

    lineage.push(processInfo);
    currentPid = processInfo.ppid;
  }

  return lineage;
}

export function parsePsOutput(output: string): ProcessInfo | null {
  const line = output.trim();
  if (!line) {
    return null;
  }

  const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) {
    throw new Error(`无法解析 ps 输出: ${output}`);
  }

  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    command: match[3] ?? ''
  };
}

function parseWindowsProcessOutput(output: string): ProcessInfo | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as {
    ProcessId?: number;
    ParentProcessId?: number;
    CommandLine?: string | null;
  };

  if (!Number.isInteger(parsed.ProcessId) || !Number.isInteger(parsed.ParentProcessId)) {
    return null;
  }

  return {
    pid: Number(parsed.ProcessId),
    ppid: Number(parsed.ParentProcessId),
    command: parsed.CommandLine ?? ''
  };
}

async function readProcessInfo(
  pid: number,
  platform: NodeJS.Platform = process.platform
): Promise<ProcessInfo | null> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  if (platform === 'win32') {
    const script = [
      `$process = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue`,
      'if ($null -eq $process) { return }',
      '$process | Select-Object ProcessId, ParentProcessId, CommandLine | ConvertTo-Json -Compress'
    ].join('; ');
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script]);
    return parseWindowsProcessOutput(stdout);
  }

  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'pid=,ppid=,command=', '-p', String(pid)]);
    return parsePsOutput(stdout);
  } catch (error) {
    const errorLike = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const output = `${errorLike.stdout ?? ''}${errorLike.stderr ?? ''}`;
    if ((errorLike as { code?: string | number }).code === 1 && output.includes('no matching')) {
      return null;
    }
    throw error;
  }
}

function defaultLauncherMatcher(processInfo: ProcessInfo): boolean {
  return (
    /\bnpx(?:\.exe)?\b/i.test(processInfo.command) ||
    /\bnpx-cli\.js\b/i.test(processInfo.command) ||
    /\bnpm exec\b/i.test(processInfo.command) ||
    /\bnpm-cli\.js\b/i.test(processInfo.command) ||
    /\bvolta(?:-shim)?\b/i.test(processInfo.command) ||
    /\bcmd(?:\.exe)?\b.*\b(?:npx|playwright-pool)\b/i.test(processInfo.command)
  );
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const errorLike = error as NodeJS.ErrnoException;
    if (errorLike.code === 'ESRCH') {
      return false;
    }
    if (errorLike.code === 'EPERM') {
      return true;
    }
    throw error;
  }
}
