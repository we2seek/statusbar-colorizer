import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DefaultColorAssigner } from '../colorAssigner';
import { fnv1a32 } from '../fnv1a';

const assigner = new DefaultColorAssigner();

/**
 * Arbitrary that generates a valid hex color string in the format #RRGGBB.
 * fc.hexColor() is not available in this version of fast-check, so we build it
 * from fc.stringMatching.
 */
const hexColorArb = fc.stringMatching(/^#[0-9A-Fa-f]{6}$/);

// Feature: project-statusbar-colorizer, Property 2: Детермінованість призначення
describe('Property 2: Детермінованість призначення', () => {
  it('two calls with the same arguments return the same color (Validates: Requirements 4.4)', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(hexColorArb), (projectPath, paletteArr) => {
        // Ensure palette has at least one element
        const palette = paletteArr.length > 0 ? paletteArr : ['#000000'];
        const occupiedColors = new Set<string>();

        const result1 = assigner.assign(projectPath, occupiedColors, palette);
        const result2 = assigner.assign(projectPath, occupiedColors, palette);

        expect(result1.color).toBe(result2.color);
      })
    );
  });
});

// Feature: project-statusbar-colorizer, Property 3: Призначений колір завжди з палітри
describe('Property 3: Призначений колір завжди з палітри', () => {
  it('result color is always a member of the passed palette (Validates: Requirements 4.1)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.uniqueArray(hexColorArb, { minLength: 1 }),
        (projectPath, palette) => {
          const occupiedColors = new Set<string>();

          const result = assigner.assign(projectPath, occupiedColors, palette);

          expect(palette).toContain(result.color);
        }
      )
    );
  });
});

// Feature: project-statusbar-colorizer, Property 4: Уникнення зайнятих кольорів
describe('Property 4: Уникнення зайнятих кольорів', () => {
  it('result is not in occupiedColors when a free color exists (Validates: Requirements 4.3)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.uniqueArray(hexColorArb, { minLength: 2 }).chain((palette) => {
          // palette already has unique elements (fc.uniqueArray guarantees uniqueness)
          // Pick a proper subset (at least 1, at most palette.length - 1)
          const maxOccupied = palette.length - 1;
          return fc
            .integer({ min: 1, max: maxOccupied })
            .map((count) => ({
              palette,
              occupiedColors: new Set(palette.slice(0, count)),
            }));
        }),
        (projectPath, { palette, occupiedColors }) => {
          const result = assigner.assign(projectPath, occupiedColors, palette);

          expect(occupiedColors.has(result.color)).toBe(false);
        }
      )
    );
  });
});

// Unit tests for ColorAssigner (Validates: Requirements 4.3, 4.5)
describe('DefaultColorAssigner — unit tests', () => {
  it('all colors occupied → returns palette[hash % len] with warning: palette-exhausted', () => {
    const palette = ['#111111', '#222222', '#333333'];
    const occupiedColors = new Set(palette);
    const projectPath = '/some/project';

    const result = assigner.assign(projectPath, occupiedColors, palette);

    const hash = fnv1a32(projectPath);
    const expectedColor = palette[hash % palette.length];

    expect(result.color).toBe(expectedColor);
    expect(result.warning).toBe('palette-exhausted');
  });

  it('empty occupiedColors → returns color at startIndex', () => {
    const palette = ['#aabbcc', '#ddeeff', '#112233'];
    const occupiedColors = new Set<string>();
    const projectPath = '/my/workspace';

    const result = assigner.assign(projectPath, occupiedColors, palette);

    const hash = fnv1a32(projectPath);
    const startIndex = hash % palette.length;
    const expectedColor = palette[startIndex];

    expect(result.color).toBe(expectedColor);
    expect(result.warning).toBeUndefined();
  });

  it('first color occupied → returns next color in palette', () => {
    const palette = ['#aabbcc', '#ddeeff', '#112233'];
    const projectPath = '/my/workspace';

    const hash = fnv1a32(projectPath);
    const startIndex = hash % palette.length;
    const firstColor = palette[startIndex];
    const occupiedColors = new Set([firstColor]);

    const result = assigner.assign(projectPath, occupiedColors, palette);

    const expectedColor = palette[(startIndex + 1) % palette.length];

    expect(result.color).toBe(expectedColor);
    expect(result.warning).toBeUndefined();
  });
});
