/**
 * A UUID derived from a name, for an id a retry must find again (an idempotency key).
 *
 * DESIGN PATTERN: **Deterministic identifier**. The id is an RFC 9562 version 8 (custom) UUID built from a SHA-256 of the
 * seed: the format exists for exactly this (an implementation-defined name-based id), its version nibble keeps it apart from
 * every random (version 4) id a column defaults to, and the column and the wire accept it as any other UUID.
 */

/**
 * The version 8 UUID of `seed`.
 *
 * @param seed - The name. The caller makes it unambiguous (each part separated by a character no part can hold).
 * @param sha256Hex - The hash, injected so a domain module imports no crypto.
 * @returns A UUID. Pure.
 */
export function uuidV8Of(seed: string, sha256Hex: (text: string) => string): string {
    const hex = sha256Hex(seed);
    const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        `8${hex.slice(13, 16)}`,
        `${variant}${hex.slice(17, 20)}`,
        hex.slice(20, 32),
    ].join('-');
}
