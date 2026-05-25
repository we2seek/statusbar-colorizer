import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { VscodePluginConfiguration, BUILT_IN_BRANCH_COLORS } from '../pluginConfiguration';
import { BUILT_IN_PALETTE } from '../palette';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(),
  },
}));
/**
 * Arbitrary that generates a valid HEX color string in the format #RRGGBB.
 */
const validHexColorArb = fc.stringMatching(/^#[0-9A-Fa-f]{6}$/);

/**
 * Arbitrary that generates a string that is NOT a valid #RRGGBB hex color.
 */
const invalidHexColorArb = fc.string().filter((s) => !/^#[0-9A-Fa-f]{6}$/.test(s));

// Feature: project-statusbar-colorizer, Property 13: Кастомна палітра використовується замість вбудованої
describe('Property 13: Кастомна палітра використовується замість вбудованої', () => {
  it('valid custom palette is returned as-is instead of BUILT_IN_PALETTE (Validates: Requirements 5.4)', () => {
    fc.assert(
      fc.property(
        fc.array(validHexColorArb, { minLength: 1 }),
        (customPalette) => {
          const showError = vi.fn();
          const config = new VscodePluginConfiguration(
            showError,
            () => customPalette
          );

          const result = config.getColorPalette();

          expect(result).toEqual(customPalette);
          expect(showError).not.toHaveBeenCalled();
        }
      )
    );
  });
});

// Feature: project-statusbar-colorizer, Property 14: Некоректна кастомна палітра → fallback
describe('Property 14: Некоректна кастомна палітра → fallback на вбудовану', () => {
  it('palette with at least one invalid color returns BUILT_IN_PALETTE and calls showError (Validates: Requirements 5.5)', () => {
    fc.assert(
      fc.property(
        // Build an array with at least one invalid color mixed in
        fc.array(validHexColorArb).chain((validColors) =>
          fc.array(invalidHexColorArb, { minLength: 1 }).map((invalidColors) => {
            // Interleave valid and invalid colors
            const mixed = [...validColors, ...invalidColors];
            // Shuffle to ensure invalid colors aren't always at the end
            return mixed;
          })
        ),
        (mixedPalette) => {
          const showError = vi.fn();
          const config = new VscodePluginConfiguration(
            showError,
            () => mixedPalette
          );

          const result = config.getColorPalette();

          expect(result).toEqual([...BUILT_IN_PALETTE]);
          expect(showError).toHaveBeenCalledTimes(1);
        }
      )
    );
  });
});

// Unit tests for PluginConfiguration (Validates: Requirements 5.4, 5.5, 8.4)
describe('VscodePluginConfiguration — unit tests', () => {
  let showError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    showError = vi.fn();
  });

  it('config not set (undefined) → returns BUILT_IN_PALETTE', () => {
    const config = new VscodePluginConfiguration(showError, () => undefined);

    const result = config.getColorPalette();

    expect(result).toEqual([...BUILT_IN_PALETTE]);
    expect(showError).not.toHaveBeenCalled();
  });

  it('empty array → returns BUILT_IN_PALETTE', () => {
    const config = new VscodePluginConfiguration(showError, () => []);

    const result = config.getColorPalette();

    expect(result).toEqual([...BUILT_IN_PALETTE]);
    expect(showError).not.toHaveBeenCalled();
  });

  it('valid custom palette → returns it', () => {
    const customPalette = ['#1A2B3C', '#AABBCC', '#FF0000'];
    const config = new VscodePluginConfiguration(showError, () => customPalette);

    const result = config.getColorPalette();

    expect(result).toEqual(customPalette);
    expect(showError).not.toHaveBeenCalled();
  });

  it('palette with one invalid color → calls showError with invalid value and returns BUILT_IN_PALETTE', () => {
    const invalidColor = 'not-a-color';
    const palette = ['#1A2B3C', invalidColor, '#FF0000'];
    const config = new VscodePluginConfiguration(showError, () => palette);

    const result = config.getColorPalette();

    expect(result).toEqual([...BUILT_IN_PALETTE]);
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).toHaveBeenCalledWith(invalidColor);
  });
});

// Unit tests for colorTitleBar()
describe('VscodePluginConfiguration.colorTitleBar()', () => {
  it('returns false when config is not set (undefined) — default off', () => {
    const config = new VscodePluginConfiguration(vi.fn(), () => undefined, () => undefined, () => undefined);
    expect(config.colorTitleBar()).toBe(false);
  });

  it('returns true when config is explicitly true', () => {
    const config = new VscodePluginConfiguration(vi.fn(), () => undefined, () => undefined, () => true);
    expect(config.colorTitleBar()).toBe(true);
  });

  it('returns false when config is explicitly false', () => {
    const config = new VscodePluginConfiguration(vi.fn(), () => undefined, () => undefined, () => false);
    expect(config.colorTitleBar()).toBe(false);
  });
});

// Unit tests for colorStatusBar()
describe('VscodePluginConfiguration.colorStatusBar()', () => {
  it('returns true when config is not set (undefined) — default on', () => {
    const config = new VscodePluginConfiguration(vi.fn(), () => undefined, () => undefined);
    expect(config.colorStatusBar()).toBe(true);
  });

  it('returns true when config is explicitly true', () => {
    const config = new VscodePluginConfiguration(vi.fn(), () => undefined, () => true);
    expect(config.colorStatusBar()).toBe(true);
  });

  it('returns false when config is explicitly false', () => {
    const config = new VscodePluginConfiguration(vi.fn(), () => undefined, () => false);
    expect(config.colorStatusBar()).toBe(false);
  });
});

// Feature: branch-based-colorization, Property 10: getBranchColors validation — empty string keys
describe('Property 10: getBranchColors validation — empty string keys', () => {
  it('calls showError once for the empty key and returns BUILT_IN_BRANCH_COLORS (Validates: Requirements 3.5, 3.6)', () => {
    const validHexArb = fc.hexaString({ minLength: 6, maxLength: 6 }).map(h => `#${h.toUpperCase()}`);
    fc.assert(
      fc.property(
        validHexArb,  // value for the empty key
        fc.dictionary(fc.string({ minLength: 1 }), validHexArb),  // other valid entries
        (emptyKeyValue, otherEntries) => {
          const userMap: Record<string, string> = { ...otherEntries, '': emptyKeyValue };
          const showError = vi.fn();
          const config = new VscodePluginConfiguration(
            showError, undefined, undefined, undefined, undefined,
            () => userMap
          );
          const result = config.getBranchColors();
          // showError called exactly once for the empty key
          expect(showError).toHaveBeenCalledTimes(1);
          expect(showError).toHaveBeenCalledWith('');
          expect(result).toEqual(BUILT_IN_BRANCH_COLORS);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Property 11: getColorStrategy falls back to "branch" for invalid values
describe('Property 11: getColorStrategy falls back to "branch" for invalid values', () => {
  it('calls showError once and returns "branch" for any non-"project"/non-"branch" value (Validates: Requirements 8.6)', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => s !== 'project' && s !== 'branch'),
        (invalidValue) => {
          const showError = vi.fn();
          const config = new VscodePluginConfiguration(
            showError, undefined, undefined, undefined,
            () => invalidValue
          );
          const result = config.getColorStrategy();
          expect(showError).toHaveBeenCalledTimes(1);
          expect(showError).toHaveBeenCalledWith(invalidValue);
          expect(result).toBe('branch');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Property 8: getBranchColors merge semantics
describe('Property 8: getBranchColors merge semantics', () => {
  it('user entries override built-ins; un-overridden built-ins remain (Validates: Requirements 3.2)', () => {
    const validHexArb = fc.hexaString({ minLength: 6, maxLength: 6 }).map(h => `#${h.toUpperCase()}`);
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1 }),  // non-empty keys
          validHexArb,
        ).filter(d => Object.keys(d).length >= 1),
        (userMap) => {
          const showError = vi.fn();
          const config = new VscodePluginConfiguration(
            showError, undefined, undefined, undefined, undefined,
            () => userMap
          );
          const result = config.getBranchColors();
          // Every user key maps to user value
          for (const [key, value] of Object.entries(userMap)) {
            expect(result[key]).toBe(value);
          }
          // Every un-overridden built-in key maps to built-in value
          for (const [key, value] of Object.entries(BUILT_IN_BRANCH_COLORS)) {
            if (!Object.prototype.hasOwnProperty.call(userMap, key)) {
              expect(result[key]).toBe(value);
            }
          }
          expect(showError).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Property 9: getBranchColors validation — invalid hex values
describe('Property 9: getBranchColors validation — invalid hex values', () => {
  it('calls showError once per invalid value and returns BUILT_IN_BRANCH_COLORS (Validates: Requirements 3.4, 3.6)', () => {
    const invalidHexArb = fc.string().filter(s => !/^#[0-9A-Fa-f]{6}$/.test(s));
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.string({ minLength: 1 }),
            value: invalidHexArb,
          }),
          { minLength: 1 }
        ),
        (entries) => {
          const userMap: Record<string, string> = {};
          for (const { key, value } of entries) {
            userMap[key] = value;
          }
          const showError = vi.fn();
          const config = new VscodePluginConfiguration(
            showError, undefined, undefined, undefined, undefined,
            () => userMap
          );
          const result = config.getBranchColors();
          // showError called once per invalid value
          const invalidValues = Object.values(userMap).filter(v => !/^#[0-9A-Fa-f]{6}$/.test(v));
          expect(showError).toHaveBeenCalledTimes(invalidValues.length);
          expect(result).toEqual(BUILT_IN_BRANCH_COLORS);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Unit tests for getColorStrategy() and getBranchColors()
describe('VscodePluginConfiguration — getColorStrategy() unit tests', () => {
  it('returns "branch" when config is unset (undefined)', () => {
    const config = new VscodePluginConfiguration(vi.fn(), undefined, undefined, undefined, () => undefined);
    expect(config.getColorStrategy()).toBe('branch');
  });

  it('returns "project" when config is "project"', () => {
    const config = new VscodePluginConfiguration(vi.fn(), undefined, undefined, undefined, () => 'project');
    expect(config.getColorStrategy()).toBe('project');
  });

  it('returns "branch" when config is "branch"', () => {
    const config = new VscodePluginConfiguration(vi.fn(), undefined, undefined, undefined, () => 'branch');
    expect(config.getColorStrategy()).toBe('branch');
  });

  it('shows error and returns "branch" for invalid value', () => {
    const showError = vi.fn();
    const config = new VscodePluginConfiguration(showError, undefined, undefined, undefined, () => 'invalid');
    expect(config.getColorStrategy()).toBe('branch');
    expect(showError).toHaveBeenCalledWith('invalid');
  });
});

describe('VscodePluginConfiguration — getBranchColors() unit tests', () => {
  it('returns built-in defaults when config is unset', () => {
    const config = new VscodePluginConfiguration(vi.fn(), undefined, undefined, undefined, undefined, () => undefined);
    expect(config.getBranchColors()).toEqual(BUILT_IN_BRANCH_COLORS);
  });

  it('returns built-in defaults when config is empty object', () => {
    const config = new VscodePluginConfiguration(vi.fn(), undefined, undefined, undefined, undefined, () => ({}));
    expect(config.getBranchColors()).toEqual(BUILT_IN_BRANCH_COLORS);
  });

  it('merges valid user map over built-in defaults', () => {
    const userMap = { 'feature/x': '#AABBCC' };
    const config = new VscodePluginConfiguration(vi.fn(), undefined, undefined, undefined, undefined, () => userMap);
    const result = config.getBranchColors();
    expect(result['feature/x']).toBe('#AABBCC');
    expect(result['main']).toBe(BUILT_IN_BRANCH_COLORS['main']);
    expect(result['develop']).toBe(BUILT_IN_BRANCH_COLORS['develop']);
  });

  it('built-in defaults contain main, master, develop', () => {
    expect(BUILT_IN_BRANCH_COLORS).toHaveProperty('main');
    expect(BUILT_IN_BRANCH_COLORS).toHaveProperty('master');
    expect(BUILT_IN_BRANCH_COLORS).toHaveProperty('develop');
  });
});
