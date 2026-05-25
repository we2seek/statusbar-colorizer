import { ColorAssigner } from './colorAssigner';

export interface BranchColorResolveResult {
  color: string;
  warning?: 'palette-exhausted';
}

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
  constructor(private readonly assigner: ColorAssigner) {}

  resolve(
    branchName: string,
    branchColorMap: Record<string, string>,
    occupiedColors: Set<string>,
    palette: readonly string[],
    offset: number = 0
  ): BranchColorResolveResult {
    // Named branch: return mapped color directly (no neighbor-avoidance)
    if (Object.prototype.hasOwnProperty.call(branchColorMap, branchName)) {
      return { color: branchColorMap[branchName] };
    }
    // Unnamed branch: delegate to ColorAssigner with branch name as hash input
    return this.assigner.assign(branchName, occupiedColors, palette, offset);
  }
}
