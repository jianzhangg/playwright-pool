import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export async function ensureProfileDirClosed(profileDir: string): Promise<void> {
  try {
    const result = await execFile('pgrep', ['-f', profileDir]);
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
