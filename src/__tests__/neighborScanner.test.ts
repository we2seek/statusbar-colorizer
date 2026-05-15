import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock the vscode module at the top
vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
}));

import { DefaultNeighborScanner } from '../neighborScanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a temporary directory, runs `fn`, then cleans up.
 */
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ns-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Creates a neighbor directory with a `.vscode/settings.json` containing
 * the given `statusBar.background` color.
 */
async function createNeighborWithColor(
  parentDir: string,
  name: string,
  color: string
): Promise<string> {
  const neighborPath = path.join(parentDir, name);
  await fs.mkdir(path.join(neighborPath, '.vscode'), { recursive: true });
  const settings = {
    'workbench.colorCustomizations': {
      'statusBar.background': color,
    },
  };
  await fs.writeFile(
    path.join(neighborPath, '.vscode', 'settings.json'),
    JSON.stringify(settings, null, 2),
    'utf-8'
  );
  return neighborPath;
}

/**
 * Creates a neighbor directory without any settings file.
 */
async function createNeighborWithoutSettings(
  parentDir: string,
  name: string
): Promise<string> {
  const neighborPath = path.join(parentDir, name);
  await fs.mkdir(neighborPath, { recursive: true });
  return neighborPath;
}

/**
 * Creates a neighbor directory with an invalid JSON settings file.
 */
async function createNeighborWithInvalidJson(
  parentDir: string,
  name: string
): Promise<string> {
  const neighborPath = path.join(parentDir, name);
  await fs.mkdir(path.join(neighborPath, '.vscode'), { recursive: true });
  await fs.writeFile(
    path.join(neighborPath, '.vscode', 'settings.json'),
    '{ invalid json }',
    'utf-8'
  );
  return neighborPath;
}

/**
 * Reads the raw content of `.vscode/settings.json` inside `projectPath`.
 * Returns null if the file doesn't exist.
 */
async function readSettingsFile(projectPath: string): Promise<string | null> {
  try {
    return await fs.readFile(
      path.join(projectPath, '.vscode', 'settings.json'),
      'utf-8'
    );
  } catch {
    return null;
  }
}

/**
 * Arbitrary that generates a valid hex color string in the format #RRGGBB.
 */
const hexColorArb = fc.stringMatching(/^#[0-9A-Fa-f]{6}$/);

/**
 * Arbitrary that generates a valid directory name (no dots at start, not node_modules).
 */
const neighborNameArb = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/)
  .filter((name) => name !== 'node_modules');

// ---------------------------------------------------------------------------
// Feature: project-statusbar-colorizer, Property 5: Сканер не змінює файли сусідів
// ---------------------------------------------------------------------------

describe('Property 5: Сканер не змінює файли сусідів', () => {
  it(
    'after scan(), all neighbor settings files are identical to before (Validates: Requirements 3.7)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(
            fc.record({
              name: neighborNameArb,
              color: hexColorArb,
            }),
            { selector: (r) => r.name, minLength: 1, maxLength: 5 }
          ),
          async (neighbors) => {
            await withTempDir(async (parentDir) => {
              // Create a fake "current project" that won't be scanned
              const currentProject = path.join(parentDir, '__current__');
              await fs.mkdir(currentProject, { recursive: true });

              // Create neighbor directories with settings files
              const neighborPaths: string[] = [];
              for (const { name, color } of neighbors) {
                const p = await createNeighborWithColor(parentDir, name, color);
                neighborPaths.push(p);
              }

              // Read all settings files before scan
              const beforeContents = new Map<string, string | null>();
              for (const p of neighborPaths) {
                beforeContents.set(p, await readSettingsFile(p));
              }

              // Run the scanner
              const scanner = new DefaultNeighborScanner();
              await scanner.scan(parentDir, currentProject);

              // Verify all settings files are unchanged
              for (const p of neighborPaths) {
                const after = await readSettingsFile(p);
                expect(after).toBe(beforeContents.get(p));
              }
            });
          }
        ),
        { numRuns: 30 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: project-statusbar-colorizer, Property 6: Сканер збирає всі кольори сусідів
// ---------------------------------------------------------------------------

describe('Property 6: Сканер збирає всі кольори сусідів', () => {
  it(
    'result contains all statusBar.background colors from valid neighbor settings (Validates: Requirements 3.1, 3.2)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(
            fc.record({
              name: neighborNameArb,
              color: hexColorArb,
            }),
            { selector: (r) => r.name, minLength: 1, maxLength: 5 }
          ),
          async (neighbors) => {
            await withTempDir(async (parentDir) => {
              const currentProject = path.join(parentDir, '__current__');
              await fs.mkdir(currentProject, { recursive: true });

              // Create all neighbors with valid settings
              for (const { name, color } of neighbors) {
                await createNeighborWithColor(parentDir, name, color);
              }

              const scanner = new DefaultNeighborScanner();
              const result = await scanner.scan(parentDir, currentProject);

              // All neighbor colors must be in the result
              for (const { color } of neighbors) {
                expect(result.has(color)).toBe(true);
              }
            });
          }
        ),
        { numRuns: 30 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: project-statusbar-colorizer, Property 7: Сканер не виходить за перший рівень
// ---------------------------------------------------------------------------

describe('Property 7: Сканер не виходить за перший рівень', () => {
  it(
    'colors from nested subdirectories (depth ≥ 2) do not appear in result (Validates: Requirements 3.3)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uniqueArray(
            fc.record({
              name: neighborNameArb,
              nestedName: neighborNameArb,
              nestedColor: hexColorArb,
            }),
            { selector: (r) => r.name, minLength: 1, maxLength: 4 }
          ),
          async (neighbors) => {
            await withTempDir(async (parentDir) => {
              const currentProject = path.join(parentDir, '__current__');
              await fs.mkdir(currentProject, { recursive: true });

              const nestedColors: string[] = [];

              for (const { name, nestedName, nestedColor } of neighbors) {
                // Create first-level neighbor WITHOUT a settings file
                const neighborPath = path.join(parentDir, name);
                await fs.mkdir(neighborPath, { recursive: true });

                // Create a nested subdirectory WITH a settings file (depth 2)
                const nestedPath = path.join(neighborPath, nestedName);
                await fs.mkdir(path.join(nestedPath, '.vscode'), { recursive: true });
                const settings = {
                  'workbench.colorCustomizations': {
                    'statusBar.background': nestedColor,
                  },
                };
                await fs.writeFile(
                  path.join(nestedPath, '.vscode', 'settings.json'),
                  JSON.stringify(settings),
                  'utf-8'
                );
                nestedColors.push(nestedColor);
              }

              const scanner = new DefaultNeighborScanner();
              const result = await scanner.scan(parentDir, currentProject);

              // None of the nested colors should appear in the result
              for (const color of nestedColors) {
                expect(result.has(color)).toBe(false);
              }
            });
          }
        ),
        { numRuns: 30 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: project-statusbar-colorizer, Property 8: Ігнорування прихованих директорій та node_modules
// ---------------------------------------------------------------------------

describe('Property 8: Ігнорування прихованих директорій та node_modules', () => {
  it(
    'colors from hidden dirs and node_modules do not appear in result (Validates: Requirements 3.4)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate hidden directory names (starting with '.')
          fc.uniqueArray(
            fc.record({
              suffix: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,8}$/),
              color: hexColorArb,
            }),
            { selector: (r) => r.suffix, minLength: 1, maxLength: 4 }
          ),
          async (hiddenDirs) => {
            await withTempDir(async (parentDir) => {
              const currentProject = path.join(parentDir, '__current__');
              await fs.mkdir(currentProject, { recursive: true });

              const ignoredColors: string[] = [];

              // Create hidden directories
              for (const { suffix, color } of hiddenDirs) {
                const name = `.${suffix}`;
                await createNeighborWithColor(parentDir, name, color);
                ignoredColors.push(color);
              }

              // Create node_modules with a color
              const nmColor = '#123456';
              await createNeighborWithColor(parentDir, 'node_modules', nmColor);
              ignoredColors.push(nmColor);

              const scanner = new DefaultNeighborScanner();
              const result = await scanner.scan(parentDir, currentProject);

              // None of the ignored colors should appear
              for (const color of ignoredColors) {
                expect(result.has(color)).toBe(false);
              }
            });
          }
        ),
        { numRuns: 30 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Unit tests (Validates: Requirements 3.4, 3.5, 3.6, 3.7)
// ---------------------------------------------------------------------------

describe('DefaultNeighborScanner — unit tests', () => {
  it('neighbor without settings.json is skipped', async () => {
    await withTempDir(async (parentDir) => {
      const currentProject = path.join(parentDir, 'current');
      await fs.mkdir(currentProject, { recursive: true });

      // Neighbor with no settings file
      await createNeighborWithoutSettings(parentDir, 'neighbor-no-settings');

      const scanner = new DefaultNeighborScanner();
      const result = await scanner.scan(parentDir, currentProject);

      expect(result.size).toBe(0);
    });
  });

  it('neighbor with invalid JSON is skipped, others are still scanned', async () => {
    await withTempDir(async (parentDir) => {
      const currentProject = path.join(parentDir, 'current');
      await fs.mkdir(currentProject, { recursive: true });

      // One neighbor with invalid JSON
      await createNeighborWithInvalidJson(parentDir, 'bad-neighbor');

      // One neighbor with valid settings
      await createNeighborWithColor(parentDir, 'good-neighbor', '#2D6A4F');

      const scanner = new DefaultNeighborScanner();
      const result = await scanner.scan(parentDir, currentProject);

      // Only the valid neighbor's color should be present
      expect(result.has('#2D6A4F')).toBe(true);
      expect(result.size).toBe(1);
    });
  });

  it('.git directory is ignored', async () => {
    await withTempDir(async (parentDir) => {
      const currentProject = path.join(parentDir, 'current');
      await fs.mkdir(currentProject, { recursive: true });

      // Create .git with a settings file
      await createNeighborWithColor(parentDir, '.git', '#ABCDEF');

      const scanner = new DefaultNeighborScanner();
      const result = await scanner.scan(parentDir, currentProject);

      expect(result.has('#ABCDEF')).toBe(false);
      expect(result.size).toBe(0);
    });
  });

  it('node_modules directory is ignored', async () => {
    await withTempDir(async (parentDir) => {
      const currentProject = path.join(parentDir, 'current');
      await fs.mkdir(currentProject, { recursive: true });

      // Create node_modules with a settings file
      await createNeighborWithColor(parentDir, 'node_modules', '#FEDCBA');

      const scanner = new DefaultNeighborScanner();
      const result = await scanner.scan(parentDir, currentProject);

      expect(result.has('#FEDCBA')).toBe(false);
      expect(result.size).toBe(0);
    });
  });

  it('current project directory is not included in result', async () => {
    await withTempDir(async (parentDir) => {
      // Create the current project WITH a settings file
      const currentProject = path.join(parentDir, 'my-project');
      await createNeighborWithColor(parentDir, 'my-project', '#112233');

      const scanner = new DefaultNeighborScanner();
      const result = await scanner.scan(parentDir, currentProject);

      // The current project's color must not appear
      expect(result.has('#112233')).toBe(false);
      expect(result.size).toBe(0);
    });
  });
});
