import { fnv1a32 } from './fnv1a';

export type ColorAssignmentResult =
  | { color: string; warning?: undefined }
  | { color: string; warning: 'palette-exhausted' };

export interface ColorAssigner {
  assign(
    projectPath: string,
    occupiedColors: Set<string>,
    palette: readonly string[],
    offset?: number
  ): ColorAssignmentResult;
}

export class DefaultColorAssigner implements ColorAssigner {
  assign(
    projectPath: string,
    occupiedColors: Set<string>,
    palette: readonly string[],
    offset: number = 0
  ): ColorAssignmentResult {
    const hash = fnv1a32(projectPath);
    const startIndex = (hash + offset) % palette.length;

    for (let i = 0; i < palette.length; i++) {
      const color = palette[(startIndex + i) % palette.length];
      if (!occupiedColors.has(color)) {
        return { color };
      }
    }

    // All colors are occupied — return the hash-based color with a warning
    return { color: palette[startIndex], warning: 'palette-exhausted' };
  }
}
