/**
 * The id an import item's parse job is created under (ADR-0072 §2).
 *
 * DESIGN PATTERN: **Deterministic identifier** (idempotency key). `advance` creates a job, then names it on the item; those
 * are two writes, and a crash between them leaves a job that exists and is enqueued while the item does not name it. A retry
 * that made a NEW job would bill a second LLM parse. Deriving the id from (import, ordinal, generation) turns the retry into a
 * lookup: the job is created under that id, so the retry finds it. The generation is bumped when a job expires or is purged
 * before the item was matched, so a replacement never collides with the job it replaces.
 *
 * The id is the version 8 UUID of the three parts (`uuidV8Of`).
 */
import { uuidV8Of } from '../../common/derivedUuid.js';

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
    return uuidV8Of(`recipe-import-job:${importId}:${String(ordinal)}:${String(generation)}`, sha256Hex);
}
