/**
 * `purgeTestPrincipalFoods` — food's half of ADR-0040's repeatable test-principal self-purge, as one function whose
 * raw-SQL statement IS the purge.
 *
 * @pattern Command — the effect behind `POST /api/v1/foods/authored/test-purge`, shaped like
 *   `eraseFoodRows` (a named `const` arrow, raw SQL in its body, its own file) so the statement a reviewer
 *   reads is the statement that runs.
 *
 * ## What it removes, and what it deliberately does not
 *
 *  - **The caller's own PRIVATE authored foods — HARD-deleted**, withdrawn ones included (they are exactly the rows
 *    that would otherwise pile up under a fixed pool slot). `ON DELETE CASCADE` (0000, 0012, 0014) takes their
 *    nutrients, portions, provenance, versions and any queue/requester rows keyed by those food ids.
 *  - **`promoted` foods are RETAINED and counted.** Promotion publishes a food to every cook; one may already sit in
 *    a real user's recipe or search results, so purging it would change a normal user's flow — the one thing the
 *    owner's ruling forbids.
 *  - **`DELETING` foods are RETAINED.** They are mid-erasure, and the erasure protocol (`beginFoodErasure` →
 *    reference check → `eraseFoodRows`) owns them until it completes.
 *  - **Catalog rows and `fetch_requesters` are not addressed.** Imported food is shared reference data (owner
 *    ruling 1: "if we import new food that's fine"), and the predicate's `user_id = caller` cannot reach a catalog
 *    row, whose `user_id` is NULL by 0013's CHECK.
 *
 * ## ⛔ Why a hard delete, when `DELETE /api/v1/foods/{id}` deliberately withdraws
 *
 * 0016 retains a withdrawn row as a COOK'S recourse — "so that we can provide information about what was deleted".
 * A pool slot has no such interest: it is reset before and after every run, forever, and retained rows under it
 * would grow without bound. Nothing else dangles that a normal withdrawal does not already leave: recipe-service is
 * a separate database with no foreign key into this one, so a test recipe's `ingredients.food_id` pointing at a
 * purged id is the same condition a withdrawn food produces today, and recipe-service's own purge removes that
 * recipe anyway.
 *
 * ## ⚠️ Not part of the erasure sweep, on purpose
 *
 * `erasureSweepCoverage.test.ts` audits `eraseFoodRows` by name as THE account-erasure surface. This is not erasure
 * — it keeps promoted rows with no pseudonymization step and runs repeatedly — so it lives beside that function
 * rather than inside it, unlike recipe-service, whose purge shares its erasure worker module (ADR-0040 §5).
 *
 * Idempotent: a second run matches zero rows and reports it. The DELETE and the retained count are one statement,
 * so the counts describe a single snapshot.
 *
 * @param db - The food Drizzle client (or a transaction over it).
 * @param userId - The test principal's app-user ULID (identity's `users.id`) — NEVER the Clerk `sub`.
 * @returns How many private authored foods were deleted, and how many promoted ones were kept.
 * @sideEffect Deletes from `food` (and, by cascade, its child tables).
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../database/database.module.js';

/** The two counts the purge reports. */
export interface TestPrincipalFoodPurgeOutcome {
    /** Private authored foods hard-deleted. */
    readonly deletedAuthoredFoods: number;
    /** Promoted authored foods kept because other cooks may depend on them. */
    readonly retainedPromotedFoods: number;
}

export const purgeTestPrincipalFoods = async (
    db: FoodDrizzle,
    userId: string,
): Promise<TestPrincipalFoodPurgeOutcome> => {
    const result = await db.execute<{ deleted: number; retained: number }>(sql`
        WITH purged AS (
            DELETE FROM food
             WHERE user_id = ${userId}
               AND visibility = 'private'
               AND status <> 'DELETING'
            RETURNING id
        )
        SELECT (SELECT count(*) FROM purged)::int AS deleted,
               (SELECT count(*) FROM food WHERE user_id = ${userId} AND visibility = 'promoted')::int AS retained
    `);
    const row = result.rows[0];

    return { deletedAuthoredFoods: row?.deleted ?? 0, retainedPromotedFoods: row?.retained ?? 0 };
};
