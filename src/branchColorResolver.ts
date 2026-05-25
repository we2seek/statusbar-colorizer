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
    _occupiedColors: Set<string>,
    _palette: readonly string[],
    _offset: number = 0
  ): BranchColorResolveResult {
    // Named branch: return mapped color directly (no neighbor-avoidance)
    if (Object.prototype.hasOwnProperty.call(branchColorMap, branchName)) {
      return { color: branchColorMap[branchName] };
    }
    // Unnamed branch: no color — caller should clear extension-managed keys
    return { color: null };
  }
}
