import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Root } from '@modelcontextprotocol/sdk/types.js';

function buildFallbackRoot(fallbackRootPath: string): Root {
  const normalizedPath = path.resolve(fallbackRootPath);
  return {
    uri: pathToFileURL(normalizedPath).href,
    name: normalizedPath
  };
}

export function normalizeForwardedRoots(roots: Root[], fallbackRootPath: string): Root[] {
  return roots.length > 0 ? roots : [buildFallbackRoot(fallbackRootPath)];
}

export function buildForwardedRootsSignature(roots: Root[], fallbackRootPath: string): string {
  const normalizedRoots = normalizeForwardedRoots(roots, fallbackRootPath);
  return JSON.stringify(
    normalizedRoots.map((root) => ({
      uri: root.uri,
      name: root.name ?? ''
    }))
  );
}

export class ForwardedRootsState {
  private roots: Root[];

  constructor(
    private readonly fallbackRootPath: string,
    roots: Root[] = []
  ) {
    this.roots = normalizeForwardedRoots(roots, fallbackRootPath);
  }

  set(roots: Root[]): void {
    this.roots = normalizeForwardedRoots(roots, this.fallbackRootPath);
  }

  list(): Root[] {
    return this.roots;
  }

  signature(): string {
    return buildForwardedRootsSignature(this.roots, this.fallbackRootPath);
  }
}
