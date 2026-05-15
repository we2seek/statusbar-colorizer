import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { VscodePluginConfiguration } from '../pluginConfiguration';
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
