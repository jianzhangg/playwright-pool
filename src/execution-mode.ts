import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isExecutedAsCli(importMetaUrl: string, argvEntry = process.argv[1]): boolean {
  if (!argvEntry) {
    return false;
  }

  return normalizeExecutionPath(argvEntry) === normalizeExecutionPath(fileURLToPath(importMetaUrl));
}

function normalizeExecutionPath(targetPath: string): string {
  try {
    return realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}
