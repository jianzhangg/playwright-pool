import { execFile as execFileCallback } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export async function removeDirRobustly(targetDir: string): Promise<void> {
  try {
    await rm(targetDir, { force: true, recursive: true });
    return;
  } catch (error) {
    const errorLike = error as NodeJS.ErrnoException;
    if (!['ENOTEMPTY', 'EPERM', 'EBUSY'].includes(errorLike.code ?? '')) {
      throw error;
    }
  }

  await execFile('rm', ['-rf', targetDir]);
}
