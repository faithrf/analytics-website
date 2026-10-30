/**
 * Sync codes: 10 characters from Crockford base32 (no I, L, O, U), shown as
 * XXXXX-XXXXX. Pure helpers so they can be unit tested and shared by client and server.
 */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 10;

/** Builds a code from random bytes (one byte per character; 256 is a multiple of 32, so no bias). */
export function codeFromBytes(bytes: ArrayLike<number>): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] & 31];
  return out;
}

/** Uppercase, strip spaces/dashes, map O->0 and I/L->1. Returns the 10-char form or null if invalid. */
export function normaliseCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** XXXXX-XXXXX display form of a normalised code. */
export function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
