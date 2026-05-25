import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DefaultBranchColorResolver } from '../branchColorResolver';
import { DefaultColorAssigner } from '../colorAssigner';
import { BUILT_IN_PALETTE } from '../palette';
import { fnv1a32 } from '../fnv1a';

const hexColorArb = fc.hexaString({ minLength: 6, maxLength: 6 }).map(h => `#${h.toUpperCase()}`);

// Feature: branch-based-colorization, Property 4: BranchColorResolver always returns a valid hex color
describe('Property 4: BranchColorResolver always returns a valid hex color', () => {
  it('result.color always matches #RRGGBB format (Validates: Requirements 2.1)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // branch name
        fc.dictionary(fc.string({ minLength: 1 }), hexColorArb),  // branch color map
        fc.array(fc.string({ minLength: 1 })),  // occupied colors (as array, convert to Set)
        (branchName, branchColorMap, occupiedArr) => {
          const resolver = new DefaultBranchColorResolver(new DefaultColorAssigner());
          const result = resolver.resolve(
            branchName,
            branchColorMap,
            new Set(occupiedArr),
            BUILT_IN_PALETTE
          );
          expect(result.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Property 5: Named branch returns mapped color regardless of occupied set
describe('Property 5: Named branch returns mapped color regardless of occupied set', () => {
  it('returns mapped color even when it is in the occupied set (Validates: Requirements 2.2, 7.4)', () => {
    const hexColorArb = fc.hexaString({ minLength: 6, maxLength: 6 }).map(h => `#${h.toUpperCase()}`);
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // branch name
        hexColorArb,                   // mapped color
        (branch, color) => {
          const map = { [branch]: color };
          const occupied = new Set([color]);  // color IS in occupied set
          const resolver = new DefaultBranchColorResolver(new DefaultColorAssigner());
          const result = resolver.resolve(branch, map, occupied, BUILT_IN_PALETTE);
          expect(result.color).toBe(color);
          expect(result.warning).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Property 6: Unnamed branch delegates to ColorAssigner
describe('Property 6: Unnamed branch delegates to ColorAssigner', () => {
  it('returns same color as DefaultColorAssigner for unnamed branches (Validates: Requirements 2.3)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // branch name
        fc.array(fc.string({ minLength: 1 })),  // occupied colors
        (branchName, occupiedArr) => {
          const occupied = new Set(occupiedArr);
          const assigner = new DefaultColorAssigner();
          const resolver = new DefaultBranchColorResolver(assigner);
          // Empty map — branch is definitely unnamed
          const resolverResult = resolver.resolve(branchName, {}, occupied, BUILT_IN_PALETTE);
          const assignerResult = assigner.assign(branchName, occupied, BUILT_IN_PALETTE);
          expect(resolverResult.color).toBe(assignerResult.color);
          expect(resolverResult.warning).toBe(assignerResult.warning);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Property 7: Palette exhaustion for unnamed branches
describe('Property 7: Palette exhaustion for unnamed branches', () => {
  it('returns palette[hash % len] with palette-exhausted warning when all palette colors are occupied (Validates: Requirements 7.3)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // branch name (unnamed — empty map)
        fc.array(
          fc.hexaString({ minLength: 6, maxLength: 6 }).map(h => `#${h.toUpperCase()}`),
          { minLength: 1 }
        ),  // palette (non-empty)
        (branchName, palette) => {
          // All palette colors are occupied
          const occupied = new Set(palette);
          const resolver = new DefaultBranchColorResolver(new DefaultColorAssigner());
          const result = resolver.resolve(branchName, {}, occupied, palette);
          const expectedColor = palette[fnv1a32(branchName) % palette.length];
          expect(result.color).toBe(expectedColor);
          expect(result.warning).toBe('palette-exhausted');
        }
      ),
      { numRuns: 100 }
    );
  });
});
