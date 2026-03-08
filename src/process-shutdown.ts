import { isBrokenPipeError } from './safe-stderr.js';

export function createSingleExitHandler(
  onExit: (exitCode: number, reason: string) => void
): (exitCode: number, reason: string) => boolean {
  let exiting = false;

  return (exitCode: number, reason: string) => {
    if (exiting) {
      return false;
    }

    exiting = true;
    onExit(exitCode, reason);
    return true;
  };
}

export function formatProcessError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

export function createFatalProcessHandler(options: {
  reason: string;
  requestExit: (exitCode: number, reason: string) => unknown;
  writeDiagnostic?: (message: string) => void;
  formatError?: (error: unknown) => string;
}): (error: unknown) => void {
  const writeDiagnostic = options.writeDiagnostic ?? (() => undefined);
  const formatError = options.formatError ?? formatProcessError;

  return (error: unknown) => {
    if (!isBrokenPipeError(error)) {
      try {
        writeDiagnostic(`${formatError(error)}\n`);
      } catch (writeError) {
        if (!isBrokenPipeError(writeError)) {
          throw writeError;
        }
      }
    }

    options.requestExit(1, options.reason);
  };
}
