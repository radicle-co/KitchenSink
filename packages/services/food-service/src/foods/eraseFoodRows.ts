/**
 * `eraseFoodRows` (plan U17, T-056/FR-043/FR-044/R24) — THE food database's account-erasure sweep, as one
 * function whose raw-SQL statements ARE the sweep.
 *
 * ## ⛔ WHY THIS IS A RAW-SQL FUNCTION AND NOT A DAO CALL — the shape is load-bearing
 *
 * `packages/infra/global/__tests__/erasureSweepCoverage.test.ts` gates every user-bearing table in this
 * database against the statements of THIS function, exactly as it reads `eraseRecipeRows` for the recipe
 * database. That gate reads TEMPLATE LITERALS from the function's own body (comments are stripped; a
 * drizzle query-builder call is invisible to it), so the sweep and the audit surface must be the same
 * text. The previous shape — `FetchRequestersDao.deleteForRequester`, a builder call three files away —
 * erased correctly and was UNAUDITABLE: a new user-keyed table could land with the gate unable to see
 * whether anything swept it. R24 makes that gate a precondition of any `food.user_id` column, so the
 * sweep moved here FIRST (U17 ships before U10 by dependency edge, not by convention).
 *
 * ## What it sweeps, and what it deliberately does not
 *
 *  - `fetch_requesters` — demand rows keyed by the app-user ULID (`requester_id`, since migration 0002's
 *    rename from the Clerk `sub`). Deleted outright; other users' demand rows and the catalog foods
 *    themselves (shared reference data) survive.
 *  - `food` — the erased user's AUTHORED foods (0013/0014, plans U10/U18): Q3b's delete-or-orphan. The
 *    deletion worker orchestrates the three-step protocol — {@link beginFoodErasure} tombstones (the
 *    refusal window), the worker asks recipe-service which ids live recipes still reference, and THIS
 *    function completes: unreferenced rows DELETE (CASCADE takes macros/portions/versions), referenced
 *    rows revert to RESOLVED as pseudonymous orphans (`user_id` retained — the recipes/`owner_id`
 *    precedent; the row holds no cleartext).
 *  - `food_versions.created_by` — NULLed for the erased author (the sweep's one de-identifying write):
 *    a kept food's version history survives as other users' recourse (R21); its attribution does not.
 *  - The `svc_*` rows in `fetch_requesters` are NAMED SERVICE PRINCIPALS (`svc_change_refresh`,
 *    `svc_admin_requeue`) — constants belonging to no person. They are structurally unreachable here
 *    because the predicate is equality on the erased USER's ULID, which a `svc_*` literal can never equal.
 *
 * Idempotent: a second run matches zero rows and reports it.
 *
 * @param db - The food Drizzle client (or a transaction over it).
 * @param requesterId - The deleted user's app-user ULID (identity's `users.id`) — NEVER the Clerk `sub`.
 * @returns How many rows each statement removed.
 * @sideEffect Deletes from `fetch_requesters` and `food`.
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../database/database.module.js';

// ⚠️ A `const` arrow ON PURPOSE, matching `eraseRecipeRows`: the coverage gate's parser reads the
// template literals inside a VariableDeclaration of this name — a `function` declaration is invisible
// to it, which its own non-vacuity floor reports as "addresses no tables".
export const eraseFoodRows = async (
    db: FoodDrizzle,
    requesterId: string,
    referencedFoodIds: readonly string[] = [],
): Promise<{ deletedRequesterRows: number; deletedAuthoredFoods: number; keptAuthoredFoods: number }> => {
    const requesters = await db.execute(sql`DELETE FROM fetch_requesters WHERE requester_id = ${requesterId}`);
    // Q3b's two arms (plan U18). DELETE-if-unreferenced: everything not on the worker-supplied kept list
    // goes, CASCADE taking macros, portions and versions. ORPHAN-if-referenced: the kept rows revert from
    // the begin-step's DELETING tombstone to RESOLVED **with `user_id` retained** — the recipes
    // precedent, exactly: a kept public recipe keeps its pseudonymous `owner_id` (Recital 26) and only
    // the cleartext handle is scrubbed. The food row carries NO cleartext (name/macros are content), so
    // retaining the opaque ULID IS the pseudonymized orphan; deriving a display attribution from it is
    // `pseudonymizedAuthorHandle(user_id)`, computed at render, never stored.
    const deleted = await db.execute(sql`
        DELETE FROM food
         WHERE user_id = ${requesterId}
           AND NOT (id = ANY(${sql.param([...referencedFoodIds])}))
    `);
    const kept = await db.execute(sql`
        UPDATE food SET status = 'RESOLVED', updated_at = now()
         WHERE user_id = ${requesterId} AND status = 'DELETING'
    `);
    // The version history of KEPT foods survives (it is other users' recourse — R21), but the erased
    // author's attribution does not: the one de-identifying write this sweep issues.
    await db.execute(sql`UPDATE food_versions SET created_by = NULL WHERE created_by = ${requesterId}`);

    return {
        deletedRequesterRows: requesters.rowCount ?? 0,
        deletedAuthoredFoods: deleted.rowCount ?? 0,
        keptAuthoredFoods: kept.rowCount ?? 0,
    };
};

/**
 * The erasure protocol's BEGIN step (plan U18) — tombstone every authored food of the owner so `by-food`
 * admission refuses to bind them while the worker runs the cross-service reference check, and return the
 * ids that check needs. Idempotent: an already-DELETING food (a redelivered run) stays tombstoned and is
 * still returned.
 *
 * A `const` arrow beside {@link eraseFoodRows} for the same parser reason — the two statements ARE the
 * protocol's food-side surface, and the coverage gate reads them from these declarations.
 *
 * @sideEffect Flips authored foods to DELETING; reads their ids.
 */
export const beginFoodErasure = async (
    db: FoodDrizzle,
    requesterId: string,
): Promise<{ authoredFoodIds: string[] }> => {
    await db.execute(sql`
        UPDATE food SET status = 'DELETING', updated_at = now()
         WHERE user_id = ${requesterId} AND status = 'RESOLVED'
    `);
    const ids = await db.execute<{ id: string }>(sql`SELECT id FROM food WHERE user_id = ${requesterId}`);

    return { authoredFoodIds: ids.rows.map((row) => row.id) };
};
