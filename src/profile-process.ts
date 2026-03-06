import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export async function killProfileProcesses(profileDir: string): Promise<void> {
  try {
    await execFile('pkill', ['-f', profileDir]);
  } catch (error) {
    const errorLike = error as NodeJS.ErrnoException & { stderr?: string; code?: string | number };
    if (Number(errorLike.code) === 1 || errorLike.stderr === '') {
      return;
    }
    return;
  }
}
