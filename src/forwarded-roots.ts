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

function buildConfiguredRoot(rootPath: string): Root {
  const normalizedPath = path.resolve(rootPath);
  return {
    uri: pathToFileURL(normalizedPath).href,
    name: normalizedPath
  };
}

function mergeRoots(roots: Root[], extraAllowedRootPaths: string[]): Root[] {
  const dedupedRoots = new Map<string, Root>();
  for (const root of [...roots, ...extraAllowedRootPaths.map((rootPath) => buildConfiguredRoot(rootPath))]) {
    const key = `${root.uri}::${root.name ?? ''}`;
    if (!dedupedRoots.has(key)) {
      dedupedRoots.set(key, root);
    }
  }

  return Array.from(dedupedRoots.values());
}

export function normalizeForwardedRoots(
  roots: Root[],
  fallbackRootPath: string,
  extraAllowedRootPaths: string[] = []
): Root[] {
  const mergedRoots = mergeRoots(roots, extraAllowedRootPaths);
  return mergedRoots.length > 0 ? mergedRoots : [buildFallbackRoot(fallbackRootPath)];
}

export function buildForwardedRootsSignature(
  roots: Root[],
  fallbackRootPath: string,
  extraAllowedRootPaths: string[] = []
): string {
  const normalizedRoots = normalizeForwardedRoots(roots, fallbackRootPath, extraAllowedRootPaths);
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
    roots: Root[] = [],
    private readonly extraAllowedRootPaths: string[] = []
  ) {
    this.roots = normalizeForwardedRoots(roots, fallbackRootPath, extraAllowedRootPaths);
  }

  set(roots: Root[]): void {
    this.roots = normalizeForwardedRoots(roots, this.fallbackRootPath, this.extraAllowedRootPaths);
  }

  list(): Root[] {
    return this.roots;
  }

  signature(): string {
    return buildForwardedRootsSignature(this.roots, this.fallbackRootPath, this.extraAllowedRootPaths);
  }
}
