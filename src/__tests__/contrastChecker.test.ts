import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ContrastCheckerImpl } from '../contrastChecker';

const checker = new ContrastCheckerImpl();

/**
 * Arbitrary that generates a valid hex color string in the format #RRGGBB.
 */
const hexColorArb = fc.stringMatching(/^#[0-9A-Fa-f]{6}$/);

// Feature: project-statusbar-colorizer, Property 9: Контраст завжди ≥ 4.5:1
describe('Property 9: Контраст завжди ≥ 4.5:1', () => {
  it('contrast ratio between any background and its foreground is always >= 4.5 (Validates: Requirements 6.4)', () => {
    fc.assert(
      fc.property(hexColorArb, (bg) => {
        const fg = checker.getForeground(bg);
        const ratio = checker.getContrastRatio(bg, fg);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      })
    );
  });
});

// Feature: project-statusbar-colorizer, Property 10: Правило вибору тексту (яскравість)
describe('Property 10: Правило вибору тексту (яскравість)', () => {
  it('luminance > 0.179 → getForeground returns #000000 (Validates: Requirements 6.2, 6.3)', () => {
    fc.assert(
      fc.property(hexColorArb, (bg) => {
        const luminance = checker.getLuminance(bg);
        const fg = checker.getForeground(bg);
        if (luminance > 0.179) {
          expect(fg).toBe('#000000');
        } else {
          expect(fg).toBe('#FFFFFF');
        }
      })
    );
  });
});

// Unit tests for ContrastChecker (Validates: Requirements 6.2, 6.3, 6.4)
describe('ContrastCheckerImpl — unit tests', () => {
  it('#FFFFFF → getForeground returns #000000', () => {
    expect(checker.getForeground('#FFFFFF')).toBe('#000000');
  });

  it('#000000 → getForeground returns #FFFFFF', () => {
    expect(checker.getForeground('#000000')).toBe('#FFFFFF');
  });

  it('#2D6A4F (dark green) → known luminance and correct foreground', () => {
    // #2D6A4F: R=0x2D=45, G=0x6A=106, B=0x4F=79
    // Expected luminance is relatively low (dark color) → foreground should be #FFFFFF
    const luminance = checker.getLuminance('#2D6A4F');
    expect(luminance).toBeGreaterThan(0);
    expect(luminance).toBeLessThan(1);
    // Dark green has luminance ~0.054, which is <= 0.179 → white text
    expect(luminance).toBeLessThanOrEqual(0.179);
    expect(checker.getForeground('#2D6A4F')).toBe('#FFFFFF');
  });

  it('#94D2BD (light teal) → known luminance and correct foreground', () => {
    // #94D2BD: R=0x94=148, G=0xD2=210, B=0xBD=189
    // Light color → luminance > 0.179 → black text
    const luminance = checker.getLuminance('#94D2BD');
    expect(luminance).toBeGreaterThan(0.179);
    expect(checker.getForeground('#94D2BD')).toBe('#000000');
  });

  it('#E07A5F (terracotta) → known luminance and correct foreground', () => {
    // #E07A5F: R=0xE0=224, G=0x7A=122, B=0x5F=95
    // Medium-light color → luminance > 0.179 → black text
    const luminance = checker.getLuminance('#E07A5F');
    expect(luminance).toBeGreaterThan(0.179);
    expect(checker.getForeground('#E07A5F')).toBe('#000000');
  });

  it('getContrastRatio is symmetric', () => {
    expect(checker.getContrastRatio('#FFFFFF', '#000000')).toBeCloseTo(
      checker.getContrastRatio('#000000', '#FFFFFF'),
      10
    );
  });

  it('getContrastRatio(#FFFFFF, #000000) is approximately 21:1', () => {
    const ratio = checker.getContrastRatio('#FFFFFF', '#000000');
    expect(ratio).toBeCloseTo(21, 0);
  });
});
