import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DefaultBranchDetector } from '../branchDetector';

// Feature: branch-based-colorization, Property 1: HEAD symbolic-ref parsing with whitespace trimming
describe('Property 1: HEAD symbolic-ref parsing with whitespace trimming', () => {
  it('returns trimmed branch name for any valid symbolic ref (Validates: Requirements 1.1, 1.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }).filter((s) => !s.includes('\n') && s.trim().length > 0),
        async (branch) => {
          const headContent = `ref: refs/heads/${branch}\n`;
          const detector = new DefaultBranchDetector(async () => headContent);
          const result = await detector.detect('/workspace');
          expect(result).toBe(branch.trim());
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Property 2: Non-ref HEAD content returns "HEAD"
describe('Property 2: Non-ref HEAD content returns "HEAD"', () => {
  it('returns "HEAD" for any content that does not start with "ref:" (Validates: Requirements 1.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter(s => !s.trim().startsWith('ref:')),
        async (content) => {
          const detector = new DefaultBranchDetector(async () => content);
          const result = await detector.detect('/workspace');
          expect(result).toBe('HEAD');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Property 3: Malformed ref returns null
describe('Property 3: Malformed ref returns null', () => {
  it('returns null for any "ref:" content that does not match refs/heads pattern (Validates: Requirements 1.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().map(s => `ref:${s}`).filter(s => {
          const trimmed = s.trim();
          return trimmed.startsWith('ref:') && !/^ref:\s+refs\/heads\/.+$/.test(trimmed);
        }),
        async (content) => {
          const detector = new DefaultBranchDetector(async () => content);
          const result = await detector.detect('/workspace');
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: branch-based-colorization, Unit tests for BranchDetector edge cases
describe('BranchDetector edge cases', () => {
  it('returns null when readFile throws ENOENT (no .git directory or HEAD missing)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const detector = new DefaultBranchDetector(async () => { throw err; });
    expect(await detector.detect('/workspace')).toBeNull();
  });

  it('returns null when readFile throws a permission error', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    const detector = new DefaultBranchDetector(async () => { throw err; });
    expect(await detector.detect('/workspace')).toBeNull();
  });

  it('returns "HEAD" for detached HEAD state (content is a commit hash, no ref: prefix)', async () => {
    const detector = new DefaultBranchDetector(async () => 'abc123def456\n');
    expect(await detector.detect('/workspace')).toBe('HEAD');
  });

  it('returns trimmed branch name for a valid symbolic ref', async () => {
    const detector = new DefaultBranchDetector(async () => 'ref: refs/heads/main\n');
    expect(await detector.detect('/workspace')).toBe('main');
  });

  it('returns null for ref: refs/tags/v1.0 (wrong pattern)', async () => {
    const detector = new DefaultBranchDetector(async () => 'ref: refs/tags/v1.0\n');
    expect(await detector.detect('/workspace')).toBeNull();
  });
});
