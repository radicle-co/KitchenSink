/**
 * The merge's typed refusals.
 *
 * @module
 */
import type { SourceItemRef } from '../domain/heldCandidatePolicy.js';

/**
 * A merge drew on a source item another food holds (FOOD-SERVICE-6). Thrown before any value is written, inside the
 * merge's transaction, so nothing of the merge commits. The caller asks the catalog who holds the items and resolves
 * the food to that holder instead (`heldCandidatePolicy.ts`).
 */
export class SourceHeldError extends Error {
    /** Every contributing item another food holds, in the merge's order. */
    public readonly held: readonly SourceItemRef[];

    public constructor(held: readonly SourceItemRef[]) {
        super(
            `A merged source item is held by another food: ${held.map((item) => `${item.source}:${item.externalKey}`).join(', ')}`,
        );
        this.name = 'SourceHeldError';
        this.held = held;
        Object.setPrototypeOf(this, SourceHeldError.prototype);
    }
}

/** Type guard for {@link SourceHeldError}. */
export function isSourceHeldError(error: unknown): error is SourceHeldError {
    return error instanceof SourceHeldError;
}
