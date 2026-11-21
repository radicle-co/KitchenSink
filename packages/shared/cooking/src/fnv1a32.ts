/**
 * FNV-1a 32, shared by the step and ingredient-line digests (ADR-0094 section 9). It has published reference vectors,
 * runs on Hermes and in browsers, and is a change detector, not a security control.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const encoder = new TextEncoder();

/**
 * Hashes text to 8 lowercase hex characters.
 *
 * @param text - The text to hash. It is not normalized: the caller decides what counts as the same text.
 * @returns FNV-1a 32 over the UTF-8 bytes of `text`, zero padded.
 */
export function fnv1a32Hex(text: string): string {
    let hash = FNV_OFFSET;

    for (const byte of encoder.encode(text)) {
        hash = Math.imul(hash ^ byte, FNV_PRIME) >>> 0;
    }

    return hash.toString(16).padStart(8, '0');
}
