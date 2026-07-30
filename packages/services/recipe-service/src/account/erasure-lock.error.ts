/**
 * The HAZ-052 write-lock's throwable. Reuses the shared {@link RecipeDomainError} — its
 * `ERASURE_IN_PROGRESS` code is already mapped to `423 Locked` by `ApiExceptionFilter` — so
 * {@link ErasureLockGuard} needs no bespoke exception plumbing.
 */
import { RecipeErrorCode } from '@kitchensink/recipe-core';

import { RecipeDomainError } from '../recipes/recipe.error.js';

/**
 * `ERASURE_IN_PROGRESS` (→ 423) — the caller's own account has a `queued`/`running` erasure job, so the
 * mutation is refused until it reaches a terminal state. `details.ownerId` echoes the caller's own owner
 * key back to them (never someone else's) for client-side diagnostics.
 */
export function erasureInProgressError(ownerId: string): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.ERASURE_IN_PROGRESS,
        'Account erasure is in progress; mutations are temporarily locked.',
        { ownerId },
    );
}
