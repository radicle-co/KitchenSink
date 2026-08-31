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
 *  - `fetch_requesters` — the ONLY per-user data this service stores today: demand rows keyed by the
 *    app-user ULID (`requester_id`, since migration 0002's rename from the Clerk `sub`). Deleted outright;
 *    other users' demand rows and the foods themselves (shared reference data) survive.
 *  - The `svc_*` rows in the same table are NAMED SERVICE PRINCIPALS (`svc_change_refresh`,
 *    `svc_admin_requeue`) — constants belonging to no person. They are structurally unreachable here
 *    because the predicate is equality on the erased USER's ULID, which a `svc_*` literal can never equal.
 *
 * Idempotent: a second run matches zero rows and reports it.
 *
 * @param db - The food Drizzle client (or a transaction over it).
 * @param requesterId - The deleted user's app-user ULID (identity's `users.id`) — NEVER the Clerk `sub`.
 * @returns How many `fetch_requesters` rows were removed.
 * @sideEffect Deletes from `fetch_requesters`.
 */
import { sql } from 'drizzle-orm';

import type { FoodDrizzle } from '../database/database.module.js';

// ⚠️ A `const` arrow ON PURPOSE, matching `eraseRecipeRows`: the coverage gate's parser reads the
// template literals inside a VariableDeclaration of this name — a `function` declaration is invisible
// to it, which its own non-vacuity floor reports as "addresses no tables".
export const eraseFoodRows = async (
    db: FoodDrizzle,
    requesterId: string,
): Promise<{ deletedRequesterRows: number }> => {
    const result = await db.execute(sql`DELETE FROM fetch_requesters WHERE requester_id = ${requesterId}`);

    return { deletedRequesterRows: result.rowCount ?? 0 };
};
