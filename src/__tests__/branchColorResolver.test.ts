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
// Feature: reassign-branch-strategy-fix
// Property 1: Bug Condition — Reassign Ignores Offset on Named Branch
// CRITICAL: This test MUST FAIL on unfixed code — failure confirms the bug exists
// NOTE: This test encodes the expected behavior — it will validate the fix when
//       it passes after implementation
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 1 (Bug Condition): Reassign cycles palette colors on named branch (Validates: Requirements 1.1, 1.2)', () => {
  it('concrete case: resolve("main", { main: "#1A3A5C" }, new Set(), palette, 1) returns a color that is NOT "#1A3A5C"', () => {
    const resolver = new DefaultBranchColorResolver();
    const palette = ['#2D6A4F', '#1B4332'];
    const result = resolver.resolve('main', { main: '#1A3A5C' }, new Set(), palette, 1);
    // On unfixed code this fails: resolver returns '#1A3A5C' because _offset is ignored
    expect(palette).toContain(result.color);
    expect(result.color).not.toBe('#1A3A5C');
  });

  it('property: for any named branch, palette ≥ 2 colors, and offset ∈ [1, 100], returned color is a palette member and differs from the branch-mapped color (Validates: Requirements 1.1, 1.2)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),                          // branch name
        hexColorArb,                                           // branch-mapped color
        fc.uniqueArray(hexColorArb, { minLength: 2 }),        // palette with ≥ 2 distinct colors
        fc.integer({ min: 1, max: 100 }),                     // offset ∈ [1, 100]
        (branchName, mappedColor, palette, offset) => {
          // Ensure mappedColor is NOT in the palette so the "differs" assertion is meaningful
          // (if mappedColor happened to be in the palette, the resolver could legitimately
          //  return it as the palette selection — we want to test the case where the mapped
          //  color is distinct from all palette colors)
          const paletteWithoutMapped = palette.filter(c => c !== mappedColor);
          if (paletteWithoutMapped.length < 2) {
            // Not enough distinct colors to form a meaningful test — skip this sample
            return;
          }

          const branchColorMap = { [branchName]: mappedColor };
          const resolver = new DefaultBranchColorResolver();
          const result = resolver.resolve(
            branchName,
            branchColorMap,
            new Set(),
            paletteWithoutMapped,
            offset
          );

          // The returned color must be a palette member
          expect(paletteWithoutMapped).toContain(result.color);
          // The returned color must differ from the branch-mapped color
          // (on unfixed code this fails: resolver returns mappedColor because _offset is ignored)
          expect(result.color).not.toBe(mappedColor);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Feature: reassign-branch-strategy-fix
// Property 2: Preservation — Offset Zero Returns Branch-Mapped Color
// IMPORTANT: These tests MUST PASS on unfixed code — they capture baseline
//            behavior that must not regress after the fix is applied.
// ─────────────────────────────────────────────────────────────────────────────
describe('Property 2a (Preservation): Named branch with offset = 0 returns branch-mapped color (Validates: Requirements 3.2, 3.3)', () => {
  it('concrete case: resolve("main", { main: "#1A3A5C" }, new Set(), palette, 0) returns { color: "#1A3A5C" }', () => {
    const resolver = new DefaultBranchColorResolver();
    const palette = ['#2D6A4F', '#1B4332'];
    const result = resolver.resolve('main', { main: '#1A3A5C' }, new Set(), palette, 0);
    expect(result).toEqual({ color: '#1A3A5C' });
  });

  it('property: for any named branch and offset = 0, resolve() returns exactly the branch-mapped color (Validates: Requirements 3.2, 3.3)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),                          // branch name
        hexColorArb,                                           // branch-mapped color
        fc.array(hexColorArb),                                 // occupied colors (irrelevant at offset 0)
        fc.array(hexColorArb, { minLength: 1 }),               // palette (irrelevant at offset 0)
        (branchName, mappedColor, occupiedArr, palette) => {
          const branchColorMap = { [branchName]: mappedColor };
          const resolver = new DefaultBranchColorResolver();
          const result = resolver.resolve(
            branchName,
            branchColorMap,
            new Set(occupiedArr),
            palette,
            0  // offset = 0: automatic assignment path (activation / HEAD change)
          );
          // Automatic assignment must always return the branch-mapped color
          expect(result.color).toBe(mappedColor);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('Property 2b (Preservation): Unnamed branch returns { color: null } for any offset (Validates: Requirements 3.2, 3.3)', () => {
  it('concrete case: resolve("feature/x", {}, new Set(), palette, 0) returns { color: null }', () => {
    const resolver = new DefaultBranchColorResolver();
    const palette = ['#2D6A4F', '#1B4332'];
    const result = resolver.resolve('feature/x', {}, new Set(), palette, 0);
    expect(result).toEqual({ color: null });
  });

  it('concrete case: resolve("feature/x", {}, new Set(), palette, 5) returns { color: null }', () => {
    const resolver = new DefaultBranchColorResolver();
    const palette = ['#2D6A4F', '#1B4332'];
    const result = resolver.resolve('feature/x', {}, new Set(), palette, 5);
    expect(result).toEqual({ color: null });
  });

  it('property: for any unnamed branch and any offset, resolve() returns { color: null } (Validates: Requirements 3.2, 3.3)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),                          // branch name (will be excluded from map)
        fc.dictionary(fc.string({ minLength: 1 }), hexColorArb),  // branch color map
        fc.array(hexColorArb),                                 // occupied colors
        fc.array(hexColorArb, { minLength: 1 }),               // palette
        fc.integer({ min: 0, max: 100 }),                      // any offset (0..100)
        (branchName, branchColorMap, occupiedArr, palette, offset) => {
          // Ensure branchName is NOT in the map (unnamed branch)
          const mapWithoutBranch = { ...branchColorMap };
          delete mapWithoutBranch[branchName];

          const resolver = new DefaultBranchColorResolver();
          const result = resolver.resolve(
            branchName,
            mapWithoutBranch,
            new Set(occupiedArr),
            palette,
            offset
          );
          // Unmapped branch must always return null — the orchestrator handles messaging
          expect(result.color).toBeNull();
        }
      ),
      { numRuns: 200 }
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
