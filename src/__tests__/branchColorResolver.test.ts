import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DefaultBranchColorResolver } from '../branchColorResolver';

const hexColorArb = fc.hexaString({ minLength: 6, maxLength: 6 }).map(h => `#${h.toUpperCase()}`);

// ─────────────────────────────────────────────────────────────────────────────
// Feature: branch-color-none-default
// Property 1: Unnamed branch resolver returns null
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 1: Unnamed branch resolver returns null', () => {
  it('returns { color: null } for any branch name not in the map (Validates: Requirements 1.1)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // branch name
        fc.dictionary(fc.string({ minLength: 1 }), hexColorArb),  // branch color map
        fc.array(hexColorArb),  // occupied colors
        fc.array(hexColorArb, { minLength: 1 }),  // palette
        (branchName, branchColorMap, occupiedArr, palette) => {
          // Ensure branchName is NOT in the map
          const mapWithoutBranch = { ...branchColorMap };
          delete mapWithoutBranch[branchName];

          const resolver = new DefaultBranchColorResolver();
          const result = resolver.resolve(
            branchName,
            mapWithoutBranch,
            new Set(occupiedArr),
            palette
          );
          expect(result.color).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: branch-color-none-default
// Property 2: Named branch resolver returns mapped color
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 2: Named branch resolver returns mapped color', () => {
  it('returns { color: <mapped value> } for any branch name present in the map (Validates: Requirements 1.5)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // branch name
        hexColorArb,                   // mapped color
        fc.array(hexColorArb),         // occupied colors (ignored for named branches)
        fc.array(hexColorArb, { minLength: 1 }),  // palette (ignored for named branches)
        (branchName, mappedColor, occupiedArr, palette) => {
          const branchColorMap = { [branchName]: mappedColor };
          const resolver = new DefaultBranchColorResolver();
          const result = resolver.resolve(
            branchName,
            branchColorMap,
            new Set(occupiedArr),
            palette
          );
          expect(result.color).toBe(mappedColor);
          // Named branch result has no warning
          if (result.color !== null) {
            expect(result.warning).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests
// ─────────────────────────────────────────────────────────────────────────────
describe('DefaultBranchColorResolver — unit tests', () => {
  it('returns { color: null } for an unnamed branch (not in map)', () => {
    const resolver = new DefaultBranchColorResolver();
    const result = resolver.resolve('feature/my-branch', {}, new Set(), ['#2D6A4F']);
    expect(result).toEqual({ color: null });
  });

  it('returns mapped color for a named branch', () => {
    const resolver = new DefaultBranchColorResolver();
    const result = resolver.resolve('main', { main: '#1A3A5C' }, new Set(), ['#2D6A4F']);
    expect(result).toEqual({ color: '#1A3A5C' });
  });

  it('returns mapped color even when it is in the occupied set', () => {
    const resolver = new DefaultBranchColorResolver();
    const result = resolver.resolve('main', { main: '#1A3A5C' }, new Set(['#1A3A5C']), ['#2D6A4F']);
    expect(result).toEqual({ color: '#1A3A5C' });
  });

  it('returns { color: null } for unnamed branch regardless of occupied colors or palette', () => {
    const resolver = new DefaultBranchColorResolver();
    const result = resolver.resolve(
      'unnamed-branch',
      { main: '#1A3A5C' },
      new Set(['#1A3A5C', '#2D6A4F']),
      ['#1A3A5C', '#2D6A4F', '#3A5C1A']
    );
    expect(result).toEqual({ color: null });
  });
});
