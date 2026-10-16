/**
 * `purgeTestPickedRoots` — the catalog half of ADR-0040's repeatable test-principal self-purge: take back the roots a
 * test principal's remote pick created (owner ruling 2026-10-16, "Clean up test-picked foods").
 *
 * @pattern Command — executes the purge for an ALREADY-AUTHORIZED caller; the rule it applies is the Specification
 *   `domain/testPickedRootPolicy.ts`, so this file holds no predicate of its own.
 *
 * ## Why this exists
 *
 * A remote pick makes a new CATALOG root under the hit's name (ADR-0055 point 4), and that root then hides the hit
 * for everyone. A fixed pool slot that picks the same word on every run therefore meets a hidden hit on every run
 * after the first, and `.maestro/recipes/ingredientCandidates.yaml` cannot be repeated. This removes the root, so the
 * same phrase offers the remote candidate again.
 *
 * ## What it removes, and what it deliberately does not
 *
 *  - **Only a root the caller's own pick CREATED**, attributed in the write that created it. A seed root, a root a
 *    real cook made, a placeholder a pick merely completed, another pool slot's root and an authored food are never in
 *    the attribution table, so they cannot be chosen.
 *  - **Never a root a real cook has since been answered with** (`held_by_real_user`): a normal cook's flow may now
 *    depend on it, and the owner's ruling is that cleaning up must not change a normal user's flow. EVERY answer that
 *    names a root holds it (`answeredRoots.ts`): a pick, a search hit, an add, a read by id, a ref check.
 *  - **Never a seed-owned item, a root with variants, or a root mid-erasure.**
 *
 * The attribution rows are locked for the whole transaction, so a real cook's hold either lands before the rule reads
 * it or waits until the root is gone; and the delete re-reads the hold in its own statement, so a caller that did not
 * lock cannot delete past one either. ⚠️ One window stays open and is accepted: an answer that LISTS ids (a search, an
 * add) reads them before it holds them, so a purge that deletes a root between the two leaves a cook one id that no
 * longer exists, which every later read answers `absent` or `404`. By-id reads hold first, so they never name a root
 * the purge then deletes. The window is milliseconds wide, needs a test principal's purge to run in it, and is closed
 * only by re-checking existence after the hold, a second round trip on every answer (rejected: ADR-0040 section 5).
 *
 * Idempotent: a second run finds no attribution and reports zero.
 *
 * @param dao - The attribution table's gateway, on the purge's transaction.
 * @param userId - The test principal's app-user ULID (identity's `users.id`) — NEVER the Clerk `sub`.
 * @returns How many roots were deleted.
 * @sideEffect Deletes from `food` and `food_item`, and by cascade the roots' crosswalks, record and attribution.
 */
import type { TestPickedRootDao } from './dao/testPickedRoot.dao.js';
import { isPurgeablePickedRoot } from './domain/testPickedRootPolicy.js';

export const purgeTestPickedRoots = async (
    dao: Pick<TestPickedRootDao, 'lockCreatedBy' | 'deleteRoots'>,
    userId: string,
): Promise<number> => {
    const attributed = await dao.lockCreatedBy(userId);

    return dao.deleteRoots(attributed.filter((root) => isPurgeablePickedRoot(root.facts, userId)));
};
