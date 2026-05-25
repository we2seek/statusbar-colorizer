import { fnv1a32 } from './fnv1a';

export type BranchColorResolveResult =
  | { color: string; warning?: 'palette-exhausted' }
  | { color: null };

export interface BranchColorResolver {
  resolve(
    branchName: string,
    branchColorMap: Record<string, string>,
    occupiedColors: Set<string>,
    palette: readonly string[],
    offset?: number
  ): BranchColorResolveResult;
}

export class DefaultBranchColorResolver implements BranchColorResolver {
  resolve(
    branchName: string,
    branchColorMap: Record<string, string>,
    occupiedColors: Set<string>,
    palette: readonly string[],
    offset: number = 0
  ): BranchColorResolveResult {
    // Named branch
    if (Object.prototype.hasOwnProperty.call(branchColorMap, branchName)) {
      // offset = 0: automatic assignment path — return the branch-mapped color directly
      if (offset === 0) {
        return { color: branchColorMap[branchName] };
      }

      // offset > 0: reassign path — cycle through palette using hash + offset
      const hash = fnv1a32(branchName);
      const startIndex = (hash + offset) % palette.length;

      for (let i = 0; i < palette.length; i++) {
        const color = palette[(startIndex + i) % palette.length];
        if (!occupiedColors.has(color)) {
          return { color };
        }
      }

      // All palette colors are occupied — fall back with a warning
      return { color: palette[startIndex], warning: 'palette-exhausted' };
    }

    // Unnamed branch: no color — caller handles messaging
    return { color: null };
  }
}
