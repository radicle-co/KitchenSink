/**
 * The recipe read-scoping predicates as composable Drizzle `SQL` conditions — the single, authoritative
 * SQL source for "which recipe rows may this reader see?", so the rule is not hand-copied across the
 * query-builder DALs (`recipes`, `collections`) and the raw search CTE in two dialects (S-R3).
 *
 * These are the SQL twin of the in-memory `isRecipeViewableBy` (`../domain/recipeVisibility.ts`):
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
import { and, eq, getTableColumns, isNull, ne, not, or, sql, type SQL } from 'drizzle-orm';

import { PRIVATE_ONLY_SOURCE_KEYS_JSON } from '@kitchensink/recipe-core';

import { recipes, type RecipeRow } from '../../database/schema/index.js';

/** Tombstone filter (C-007): the recipe is not soft-deleted (`deleted_at IS NULL`). */
export function activeRecipe(): SQL {
    return isNull(recipes.deletedAt);
}

/**
 * The read rule's hold (ADR-0105): the database function `recipe_held_from_readers` over the `recipes` row of the query's
 * own FROM, with recipe-core's private-only keys bound as ONE jsonb parameter (never copied into SQL). It is both the
 * term {@link viewableBy} and {@link communityOf} negate AND the value every select feeds `heldFromReaders`, so the rule
 * has one SQL source and no TypeScript twin.
 */
export function heldFromReadersSql(): SQL<boolean> {
    return sql<boolean>`recipe_held_from_readers(${recipes}, ${PRIVATE_ONLY_SOURCE_KEYS_JSON}::jsonb)`;
}

/** A recipe row plus the read rule's hold, as selected by {@link readableRecipeColumns}. */
export type ReadableRecipeRow = RecipeRow & { readonly heldFromReaders: boolean };

/**
 * The columns of every select that feeds `isRecipeViewableBy`: the whole `recipes` row plus the hold, computed
 * by {@link heldFromReadersSql} and by nothing else. Spread it into `db.select(...)`.
 */
export function readableRecipeColumns(): ReturnType<typeof getTableColumns<typeof recipes>> & {
    heldFromReaders: SQL<boolean>;
} {
    return { ...getTableColumns(recipes), heldFromReaders: heldFromReadersSql() };
}

/**
 * Read-visibility rule (FR-003) — the SQL twin of `isRecipeViewableBy`: the recipe is `public` AND not held from
 * readers ({@link heldFromReadersSql}), OR it is owned by `viewerId` (an owner reads their own held recipe).
 * `'public'` is a bound constant, as is the viewer id.
 *
 * @param viewerId - The requesting principal's app-user ULID.
 */
export function viewableBy(viewerId: string): SQL {
    // `or` with two defined conditions is always defined.
    return or(and(eq(recipes.visibility, 'public'), not(heldFromReadersSql())), eq(recipes.ownerId, viewerId)) as SQL;
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

/**
 * The community read predicate: {@link activeRecipe} AND `visibility = 'public'` AND `status = 'published'` AND NOT held AND NOT
 * owned by `viewerId` — what the Discover surface shows: other cooks' finished, shared recipes. It is STRICTER than
 * {@link readableBy} on purpose (no owner widening), so it can only ever narrow what a viewer may read; it is a
 * relevance scope, not an authorization grant.
 *
 * @param viewerId - The requesting principal's app-user ULID, whose own recipes are excluded.
 */
export function communityOf(viewerId: string): SQL {
    return and(
        activeRecipe(),
        eq(recipes.visibility, 'public'),
        eq(recipes.status, 'published'),
        not(heldFromReadersSql()),
        ne(recipes.ownerId, viewerId),
    ) as SQL;
}
