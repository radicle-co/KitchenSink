/**
 * The recipe read-scoping predicates as composable Drizzle `SQL` conditions — the single, authoritative
 * SQL source for "which recipe rows may this reader see?", so the rule is not hand-copied across the
 * query-builder DALs (`recipes`, `collections`) and the raw search CTE in two dialects (S-R3).
 *
 * These are the SQL twin of the in-memory {@link ../domain/recipe-visibility.ts | isRecipeViewableBy}:
 * the same rule expressed two ways because one filters rows in Postgres and the other decides an
 * already-loaded row. Keeping both here-and-there in lockstep by comment was the drift hazard this module
 * removes — {@link viewableBy} is now the one place the visibility rule lives in SQL, and {@link readableBy}
 * the one place W8-a.3 will AND-in the draft-status term, collapsing that change from ~6 hand-edits across
 * two dialects to one.
 *
 * The conditions reference the `recipes` table columns (qualified), so they compose into both a Drizzle
 * `.where(...)` and a raw `sql\`... WHERE ${cond}\`` template (every search read is `FROM recipes`).
 *
 * @module
 */
import { and, eq, isNull, or, type SQL } from 'drizzle-orm';

import { recipes } from '../../database/schema/index.js';

/** Tombstone filter (C-007): the recipe is not soft-deleted (`deleted_at IS NULL`). */
export function activeRecipe(): SQL {
    return isNull(recipes.deletedAt);
}

/**
 * Read-visibility rule (FR-003) — the SQL twin of `isRecipeViewableBy`: the recipe is `public`, OR it is
 * owned by `viewerId`. `'public'` is an inlined constant; only the viewer id is a bound parameter.
 *
 * @param viewerId - The requesting principal's app-user ULID.
 */
export function viewableBy(viewerId: string): SQL {
    // `or` with two defined conditions is always defined.
    return or(eq(recipes.visibility, 'public'), eq(recipes.ownerId, viewerId)) as SQL;
}

/**
 * The composed read predicate: {@link activeRecipe} AND {@link viewableBy} — a non-owner sees only
 * public, non-tombstoned recipes; an owner also sees their own. This is the single condition W8-a.3 will
 * extend with the draft-status term (`status = 'published' OR owner_id = :viewer`).
 *
 * @param viewerId - The requesting principal's app-user ULID.
 */
export function readableBy(viewerId: string): SQL {
    return and(activeRecipe(), viewableBy(viewerId)) as SQL;
}
