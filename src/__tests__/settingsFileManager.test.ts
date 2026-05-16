import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock the vscode module so tests can run outside VS Code
vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
}));

import { DefaultSettingsFileManager, SettingsObject } from '../settingsFileManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a temporary directory for each test and cleans it up afterwards.
 */
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfm-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Writes a `.vscode/settings.json` file inside `projectPath`. */
async function writeSettingsFile(projectPath: string, content: string): Promise<void> {
  const vscodePath = path.join(projectPath, '.vscode');
  await fs.mkdir(vscodePath, { recursive: true });
  await fs.writeFile(path.join(vscodePath, 'settings.json'), content, 'utf-8');
}

/** Reads the raw content of `.vscode/settings.json` inside `projectPath`. */
async function readSettingsFile(projectPath: string): Promise<string> {
  return fs.readFile(path.join(projectPath, '.vscode', 'settings.json'), 'utf-8');
}

/**
 * Arbitrary that generates a valid hex color string in the format #RRGGBB.
 */
const hexColorArb = fc.stringMatching(/^#[0-9A-Fa-f]{6}$/);

// ---------------------------------------------------------------------------
// Unit tests — read()
// ---------------------------------------------------------------------------

describe('DefaultSettingsFileManager.read()', () => {
  it('returns null when settings.json does not exist (ENOENT)', async () => {
    await withTempDir(async (dir) => {
      const manager = new DefaultSettingsFileManager();
      const result = await manager.read(dir);
      expect(result).toBeNull();
    });
  });

  it('returns {} when settings.json is empty', async () => {
    await withTempDir(async (dir) => {
      await writeSettingsFile(dir, '');
      const manager = new DefaultSettingsFileManager();
      const result = await manager.read(dir);
      expect(result).toEqual({});
    });
  });

  it('returns {} when settings.json contains only whitespace', async () => {
    await withTempDir(async (dir) => {
      await writeSettingsFile(dir, '   \n  ');
      const manager = new DefaultSettingsFileManager();
      const result = await manager.read(dir);
      expect(result).toEqual({});
    });
  });

  it('returns parsed object for valid JSON', async () => {
    await withTempDir(async (dir) => {
      const settings = { 'editor.tabSize': 2, 'workbench.colorCustomizations': {} };
      await writeSettingsFile(dir, JSON.stringify(settings));
      const manager = new DefaultSettingsFileManager();
      const result = await manager.read(dir);
      expect(result).toEqual(settings);
    });
  });

  it('calls showError and returns null for invalid JSON', async () => {
    await withTempDir(async (dir) => {
      await writeSettingsFile(dir, '{ invalid json }');
      const showError = vi.fn();
      const manager = new DefaultSettingsFileManager(showError);
      const result = await manager.read(dir);
      expect(result).toBeNull();
      expect(showError).toHaveBeenCalledOnce();
      expect(showError.mock.calls[0][0]).toContain('settings.json');
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests — hasStatusBarBackground()
// ---------------------------------------------------------------------------

describe('DefaultSettingsFileManager.hasStatusBarBackground()', () => {
  const manager = new DefaultSettingsFileManager();

  it('returns false for null', () => {
    expect(manager.hasStatusBarBackground(null)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(manager.hasStatusBarBackground({})).toBe(false);
  });

  it('returns false when workbench.colorCustomizations is missing', () => {
    expect(manager.hasStatusBarBackground({ 'editor.tabSize': 2 })).toBe(false);
  });

  it('returns false when workbench.colorCustomizations exists but has no statusBar.background', () => {
    const settings: SettingsObject = {
      'workbench.colorCustomizations': {
        'titleBar.activeBackground': '#1e1e1e',
      },
    };
    expect(manager.hasStatusBarBackground(settings)).toBe(false);
  });

  it('returns true when statusBar.background is present', () => {
    const settings: SettingsObject = {
      'workbench.colorCustomizations': {
        'statusBar.background': '#2D6A4F',
        'statusBar.foreground': '#FFFFFF',
      },
    };
    expect(manager.hasStatusBarBackground(settings)).toBe(true);
  });

  it('returns false when workbench.colorCustomizations is not an object (string)', () => {
    const settings: SettingsObject = {
      'workbench.colorCustomizations': 'not-an-object',
    };
    expect(manager.hasStatusBarBackground(settings)).toBe(false);
  });

  it('returns false when workbench.colorCustomizations is an array', () => {
    const settings: SettingsObject = {
      'workbench.colorCustomizations': ['#000000'],
    };
    expect(manager.hasStatusBarBackground(settings)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — write()
// ---------------------------------------------------------------------------

describe('DefaultSettingsFileManager.write()', () => {
  it('creates .vscode/settings.json when it does not exist', async () => {
    await withTempDir(async (dir) => {
      const manager = new DefaultSettingsFileManager();
      await manager.write(dir, '#2D6A4F', '#FFFFFF');

      const raw = await readSettingsFile(dir);
      const parsed = JSON.parse(raw);
      expect(parsed['workbench.colorCustomizations']['statusBar.background']).toBe('#2D6A4F');
      expect(parsed['workbench.colorCustomizations']['statusBar.foreground']).toBe('#FFFFFF');
    });
  });

  it('does not write statusBar keys when statusBar params are omitted', async () => {
    await withTempDir(async (dir) => {
      const manager = new DefaultSettingsFileManager();
      await manager.write(dir, undefined, undefined, '#2D6A4F', '#FFFFFF');

      const raw = await readSettingsFile(dir);
      const parsed = JSON.parse(raw);
      expect(parsed['workbench.colorCustomizations']).not.toHaveProperty('statusBar.background');
      expect(parsed['workbench.colorCustomizations']).not.toHaveProperty('statusBar.foreground');
      expect(parsed['workbench.colorCustomizations']['titleBar.activeBackground']).toBe('#2D6A4F');
    });
  });

  it('writes titleBar colors when provided', async () => {
    await withTempDir(async (dir) => {
      const manager = new DefaultSettingsFileManager();
      await manager.write(dir, '#2D6A4F', '#FFFFFF', '#2D6A4F', '#FFFFFF');

      const raw = await readSettingsFile(dir);
      const parsed = JSON.parse(raw);
      expect(parsed['workbench.colorCustomizations']['titleBar.activeBackground']).toBe('#2D6A4F');
      expect(parsed['workbench.colorCustomizations']['titleBar.activeForeground']).toBe('#FFFFFF');
    });
  });

  it('does not write titleBar keys when titleBar params are omitted', async () => {
    await withTempDir(async (dir) => {
      const manager = new DefaultSettingsFileManager();
      await manager.write(dir, '#2D6A4F', '#FFFFFF');

      const raw = await readSettingsFile(dir);
      const parsed = JSON.parse(raw);
      expect(parsed['workbench.colorCustomizations']).not.toHaveProperty('titleBar.activeBackground');
      expect(parsed['workbench.colorCustomizations']).not.toHaveProperty('titleBar.activeForeground');
    });
  });
  it('treats empty settings.json as {} and writes colors', async () => {
    await withTempDir(async (dir) => {
      await writeSettingsFile(dir, '');
      const manager = new DefaultSettingsFileManager();
      await manager.write(dir, '#1D3557', '#FFFFFF');

      const raw = await readSettingsFile(dir);
      const parsed = JSON.parse(raw);
      expect(parsed['workbench.colorCustomizations']['statusBar.background']).toBe('#1D3557');
    });
  });

  it('preserves existing top-level fields after write', async () => {
    await withTempDir(async (dir) => {
      const existing = { 'editor.tabSize': 4, 'editor.formatOnSave': true };
      await writeSettingsFile(dir, JSON.stringify(existing));

      const manager = new DefaultSettingsFileManager();
      await manager.write(dir, '#2D6A4F', '#FFFFFF');

      const raw = await readSettingsFile(dir);
      const parsed = JSON.parse(raw);
      expect(parsed['editor.tabSize']).toBe(4);
      expect(parsed['editor.formatOnSave']).toBe(true);
    });
  });

  it('preserves existing nested keys in workbench.colorCustomizations', async () => {
    await withTempDir(async (dir) => {
      const existing = {
        'workbench.colorCustomizations': {
          'titleBar.activeBackground': '#1e1e1e',
          'activityBar.background': '#333333',
        },
      };
      await writeSettingsFile(dir, JSON.stringify(existing));

      const manager = new DefaultSettingsFileManager();
      // titleBar params are omitted → titleBar.activeBackground should be removed
      await manager.write(dir, '#2D6A4F', '#FFFFFF');

      const raw = await readSettingsFile(dir);
      const parsed = JSON.parse(raw);
      // titleBar.activeBackground is a managed key — it gets cleared when not passed
      expect(parsed['workbench.colorCustomizations']).not.toHaveProperty('titleBar.activeBackground');
      // Unrelated keys must be preserved
      expect(parsed['workbench.colorCustomizations']['activityBar.background']).toBe('#333333');
      expect(parsed['workbench.colorCustomizations']['statusBar.background']).toBe('#2D6A4F');
      expect(parsed['workbench.colorCustomizations']['statusBar.foreground']).toBe('#FFFFFF');
    });
  });

  it('throws and calls showError when settings.json has invalid JSON', async () => {
    await withTempDir(async (dir) => {
      await writeSettingsFile(dir, '{ bad json }');
      const showError = vi.fn();
      const manager = new DefaultSettingsFileManager(showError);

      await expect(manager.write(dir, '#2D6A4F', '#FFFFFF')).rejects.toThrow();
      expect(showError).toHaveBeenCalledOnce();
    });
  });

  it('writes JSON with 2-space indentation', async () => {
    await withTempDir(async (dir) => {
      const manager = new DefaultSettingsFileManager();
      await manager.write(dir, '#2D6A4F', '#FFFFFF');

      const raw = await readSettingsFile(dir);
      // Check that the file uses 2-space indentation (lines start with 2 spaces)
      const lines = raw.split('\n');
      const indentedLines = lines.filter((l) => l.startsWith('  ') && !l.startsWith('   '));
      expect(indentedLines.length).toBeGreaterThan(0);
      // Verify it's valid JSON
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  it('calls showError and re-throws on write error (unwritable file)', async () => {
    await withTempDir(async (dir) => {
      // Create the settings file and make it read-only
      await writeSettingsFile(dir, '{}');
      const settingsPath = path.join(dir, '.vscode', 'settings.json');
      await fs.chmod(settingsPath, 0o444);

      const showError = vi.fn();
      const manager = new DefaultSettingsFileManager(showError);

      try {
        await expect(manager.write(dir, '#2D6A4F', '#FFFFFF')).rejects.toThrow();
        expect(showError).toHaveBeenCalledOnce();
        expect(showError.mock.calls[0][0]).toContain('settings.json');
      } finally {
        // Restore permissions for cleanup
        await fs.chmod(settingsPath, 0o644);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: project-statusbar-colorizer, Property 11: Round-trip збереження полів
// ---------------------------------------------------------------------------

describe('Property 11: Round-trip збереження полів settings.json', () => {
  /**
   * Arbitrary for a settings object with arbitrary fields (excluding statusBar keys).
   * Uses fc.dictionary with string keys and JSON-compatible values.
   */
  const settingsArb = fc.dictionary(
    // Keys that are not statusBar-related
    fc.string({ minLength: 1, maxLength: 30 }).filter(
      (k) => k !== 'workbench.colorCustomizations'
    ),
    fc.oneof(
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.constant(null)
    )
  );

  it(
    'all non-statusBar fields are preserved after write + read (Validates: Requirements 7.3, 10.3)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          settingsArb,
          hexColorArb,
          hexColorArb,
          async (extraFields, bg, fg) => {
            await withTempDir(async (dir) => {
              // Write initial settings with extra fields
              await writeSettingsFile(dir, JSON.stringify(extraFields));

              const manager = new DefaultSettingsFileManager();
              await manager.write(dir, bg, fg);
              const result = await manager.read(dir);

              expect(result).not.toBeNull();
              if (result === null) return;

              // All original fields must be preserved
              for (const [key, value] of Object.entries(extraFields)) {
                expect(result[key]).toEqual(value);
              }
            });
          }
        ),
        { numRuns: 50 }
      );
    }
  );
});

// ---------------------------------------------------------------------------
// Feature: project-statusbar-colorizer, Property 12: Серіалізація — валідний JSON
// ---------------------------------------------------------------------------

describe('Property 12: Серіалізація — валідний JSON з відступами', () => {
  it(
    'written file is valid JSON with 2-space indentation (Validates: Requirements 7.4, 10.2)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.oneof(fc.string(), fc.integer(), fc.boolean())
          ),
          hexColorArb,
          hexColorArb,
          async (initialSettings, bg, fg) => {
            await withTempDir(async (dir) => {
              await writeSettingsFile(dir, JSON.stringify(initialSettings));

              const manager = new DefaultSettingsFileManager();
              await manager.write(dir, bg, fg);

              const raw = await readSettingsFile(dir);

              // Must be parseable as valid JSON
              let parsed: unknown;
              expect(() => {
                parsed = JSON.parse(raw);
              }).not.toThrow();

              // Must use 2-space indentation: JSON.stringify with null, 2 produces
              // lines indented by multiples of 2 spaces
              const expected = JSON.stringify(JSON.parse(raw), null, 2);
              expect(raw).toBe(expected);
            });
          }
        ),
        { numRuns: 50 }
      );
    }
  );
});
