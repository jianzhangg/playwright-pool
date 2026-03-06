import type { ToolCallResult } from './types.js';

export function extractTabIndices(result: ToolCallResult): number[] {
  const textBlocks = result.content
    .filter((item): item is { type: 'text'; text: string } => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text);
  const indices = new Set<number>();

  for (const block of textBlocks) {
    const matches = block.matchAll(/^- (\d+):/gm);
    for (const match of matches) {
      const index = Number(match[1]);
      if (Number.isInteger(index)) {
        indices.add(index);
      }
    }
  }

  return Array.from(indices).sort((left, right) => right - left);
}
