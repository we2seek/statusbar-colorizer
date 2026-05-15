/**
 * FNV-1a 32-bit hash function.
 * Deterministic hash for string inputs, used for color assignment.
 */
export function fnv1a32(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
    hash >>>= 0; // unsigned 32-bit
  }
  return hash;
}
