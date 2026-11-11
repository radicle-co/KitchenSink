/**
 * The id an import item's parse job is created under (ADR-0072 §2).
 *
 * DESIGN PATTERN: **Deterministic identifier** (idempotency key). `advance` creates a job, then names it on the item; those
 * are two writes, and a crash between them leaves a job that exists and is enqueued while the item does not name it. A retry
 * that made a NEW job would bill a second LLM parse. Deriving the id from (import, ordinal, generation) turns the retry into a
 * lookup: the job is created under that id, so the retry finds it. The generation is bumped when a job expires or is purged
 * before the item was matched, so a replacement never collides with the job it replaces.
 *
 * The id is an RFC 9562 version 8 (custom) UUID built from a SHA-256 of the three parts: the format exists for exactly this
 * (an implementation-defined name-based id), and the column and the wire accept it as any other UUID.
 */

/**
 * The job id of one item at one generation.
 *
 * @param importId - The import.
 * @param ordinal - The item.
 * @param generation - Which job this item is on (`parse_generation`).
 * @param sha256Hex - The hash, injected so the domain imports no crypto.
 * @returns A UUID. Pure.
 */
export function importJobIdOf(
    importId: string,
    ordinal: number,
    generation: number,
    sha256Hex: (text: string) => string,
): string {
    // `:` cannot appear in a UUID or a number, so the three parts cannot be re-cut into another triple.
    const hex = sha256Hex(`recipe-import-job:${importId}:${String(ordinal)}:${String(generation)}`);
    const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        `8${hex.slice(13, 16)}`,
        `${variant}${hex.slice(17, 20)}`,
        hex.slice(20, 32),
    ].join('-');
}
