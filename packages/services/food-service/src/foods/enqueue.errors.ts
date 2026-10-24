/**
 * The queue writer's own refusal (`EnqueueEmitter`). No route reaches it: each one refuses a seed-owned food first, so
 * reaching it is a defect, and the exception filter answers it as a `500`.
 */

/** A caller asked to queue a fetch for a food the seed owns (KTD-12: the seed is that food's one writer). */
export class SeedOwnedFoodNotQueueableError extends Error {
    /** The seed-owned food's id. */
    public readonly id: string;

    public constructor(id: string) {
        super(`Food '${id}' belongs to the catalog seed, so no fetch may be queued for it`);
        this.name = 'SeedOwnedFoodNotQueueableError';
        this.id = id;
        Object.setPrototypeOf(this, SeedOwnedFoodNotQueueableError.prototype);
    }
}

/** Type guard for {@link SeedOwnedFoodNotQueueableError}. */
export function isSeedOwnedFoodNotQueueableError(error: unknown): error is SeedOwnedFoodNotQueueableError {
    return error instanceof SeedOwnedFoodNotQueueableError;
}
