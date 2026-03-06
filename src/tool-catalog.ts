import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { loadToolManifest } from './tool-manifest.js';

type ToolDiscoverer = {
  discoverTools(): Promise<Tool[]>;
};

export async function resolveRegisteredTools(manifestPath: string, _runtime: ToolDiscoverer): Promise<Tool[]> {
  try {
    return await loadToolManifest(manifestPath);
  } catch (error) {
    const errorLike = error as NodeJS.ErrnoException;
    if (errorLike.code === 'ENOENT') {
      throw new Error(`tool manifest 不存在，请先生成: ${manifestPath}`);
    }
    throw error;
  }
}
