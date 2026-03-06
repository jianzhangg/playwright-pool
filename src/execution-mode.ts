import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function isExecutedAsCli(importMetaUrl: string, argvEntry = process.argv[1]): boolean {
  if (!argvEntry) {
    return false;
  }

  return path.resolve(argvEntry) === path.resolve(fileURLToPath(importMetaUrl));
}
