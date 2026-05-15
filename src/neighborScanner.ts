import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';

export interface NeighborScanner {
  scan(parentDir: string, currentProjectPath: string): Promise<Set<string>>;
}

export class DefaultNeighborScanner implements NeighborScanner {
  /**
   * Scans the first level of `parentDir` and collects `statusBar.background`
   * values from each neighbor's `.vscode/settings.json`.
   *
   * Rules:
   * - Skips hidden directories (names starting with `.`)
   * - Skips `node_modules`
   * - Skips `currentProjectPath` itself
   * - No recursion — first level only
   * - Silently skips on any error (missing file, invalid JSON, etc.)
   */
  async scan(parentDir: string, currentProjectPath: string): Promise<Set<string>> {
    const colors = new Set<string>();
    const resolvedCurrent = path.resolve(currentProjectPath);

    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(parentDir, { withFileTypes: true, encoding: 'utf-8' });
    } catch {
      // If we can't read the parent directory, return empty set
      return colors;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      // Skip hidden directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      // Skip node_modules
      if (entry.name === 'node_modules') {
        continue;
      }

      const neighborPath = path.resolve(parentDir, entry.name);

      // Skip the current project
      if (neighborPath === resolvedCurrent) {
        continue;
      }

      // Try to read .vscode/settings.json
      try {
        const settingsPath = path.join(neighborPath, '.vscode', 'settings.json');
        const raw = await fs.readFile(settingsPath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        const colorCustomizations = parsed['workbench.colorCustomizations'];
        if (
          colorCustomizations !== null &&
          typeof colorCustomizations === 'object' &&
          !Array.isArray(colorCustomizations)
        ) {
          const bg = (colorCustomizations as Record<string, unknown>)['statusBar.background'];
          if (typeof bg === 'string') {
            colors.add(bg);
          }
        }
      } catch {
        // Silently skip: file not found, invalid JSON, permission error, etc.
      }
    }

    return colors;
  }
}
