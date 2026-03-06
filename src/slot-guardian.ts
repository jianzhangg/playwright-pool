type CleanupFunction = () => Promise<void> | void;

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
