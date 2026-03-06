import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveDefaultToolManifestPath(): string {
  const projectRoot = path.basename(path.dirname(CURRENT_DIR)) === 'dist'
    ? path.resolve(CURRENT_DIR, '../..')
    : path.resolve(CURRENT_DIR, '..');
  return path.resolve(projectRoot, 'tool-manifest.json');
}

export async function loadToolManifest(manifestPath: string): Promise<Tool[]> {
  const content = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error(`tool manifest 格式非法: ${manifestPath}`);
  }

  return parsed as Tool[];
}

export async function saveToolManifest(manifestPath: string, tools: Tool[]): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(tools, null, 2)}\n`, 'utf8');
}
