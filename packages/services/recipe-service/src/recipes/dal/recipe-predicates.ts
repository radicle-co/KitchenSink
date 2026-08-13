/**
 * The recipe read-scoping predicates as composable Drizzle `SQL` conditions — the single, authoritative
 * SQL source for "which recipe rows may this reader see?", so the rule is not hand-copied across the
 * query-builder DALs (`recipes`, `collections`) and the raw search CTE in two dialects (S-R3).
 *
 * These are the SQL twin of the in-memory `isRecipeViewableBy` (`../domain/recipe-visibility.ts`):
 * the same rule expressed two ways because one filters rows in Postgres and the other decides an
 * already-loaded row. Keeping both here-and-there in lockstep by comment was the drift hazard this module
 * removes — {@link viewableBy} is now the one place the visibility rule lives in SQL, {@link publishedOrOwnedBy}
 * the one place the W8-a.3 draft-status boundary lives, and {@link readableBy} the one place the three read
 * terms (tombstone + visibility + draft) are AND-ed together.
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
 * Draft-status read boundary (W8-a.3 — a SECURITY rule, decision 5): the recipe is `published`, OR it is
 * owned by `viewerId`. ORTHOGONAL to {@link viewableBy}: a `draft` is owner-only REGARDLESS of visibility
 * (a free-tier draft is `visibility='public'`, so the visibility term alone would leak it). `'published'`
 * is an inlined constant; only the viewer id is a bound parameter.
 *
 * @param viewerId - The requesting principal's app-user ULID.
 */
export function publishedOrOwnedBy(viewerId: string): SQL {
    // `or` with two defined conditions is always defined.
    return or(eq(recipes.status, 'published'), eq(recipes.ownerId, viewerId)) as SQL;
}

/**
 * The composed read predicate: {@link activeRecipe} AND {@link viewableBy} AND {@link publishedOrOwnedBy} —
 * a non-owner sees only public, published, non-tombstoned recipes; an owner also sees their own (private
 * and/or draft). This is the single place the three read terms are AND-ed together; a new read path should
 * consume THIS rather than re-listing the terms.
 *
 * @param viewerId - The requesting principal's app-user ULID.
 */
export function readableBy(viewerId: string): SQL {
    return and(activeRecipe(), viewableBy(viewerId), publishedOrOwnedBy(viewerId)) as SQL;
}
