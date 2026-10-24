/**
 * The failure-record vocabulary (plan 002 U2): why an ingredient lookup ended unresolved, and the coarse
 * status each reason implies.
 *
 * It lives in recipe-core because two parties read it: the recipe service's `unresolved_foods` table, whose
 * CHECK and generated `status` column restate it in SQL, and the recipe wire, which carries a line's reason
 * code so the client can render copy for it (R6). The SQL is authoritative for what a row may hold; the pin
 * that ties the two together is `packages/services/recipe-service/tests/e2e/ingredientGrain.e2e.test.ts`.
 */
import { z } from 'zod';

import type { CatalogFoodResolutionStatus } from './foodResolutionStatus.js';

/**
 * Why the cascade stopped short of a food.
 *
 * ⚠️ `author_declared` is the one member that is not a failure of ours: the cook named a substance and asked for
 * it as written. It never converges with another cook's declaration and it is never retried.
 */
export const UNRESOLVED_FOOD_REASON_CODES = [
    'author_declared',
    'awaiting_source',
    'no_source_has_it',
    'sources_errored',
    'several_candidates',
    'cascade_exhausted',
    'cascade_unavailable',
    'phrase_unusable',
] as const;

/** A reason an ingredient lookup ended unresolved. */
export type UnresolvedFoodReasonCode = (typeof UNRESOLVED_FOOD_REASON_CODES)[number];

/** Runtime validator for {@link UnresolvedFoodReasonCode}. */
export const unresolvedFoodReasonSchema = z.enum(UNRESOLVED_FOOD_REASON_CODES);

/**
 * The statuses a failure record can hold — every one of them a way of NOT being resolved.
 *
 * ⛔ A proper subset of {@link CatalogFoodResolutionStatus}: `RESOLVED` is absent by construction, because a
 * resolved lookup points at a food and has no failure record at all. `satisfies` ties each member to the
 * catalog vocabulary. It cannot say "proper subset", so `unresolvedFood.test.ts` pins the exact set.
 */
export const UNRESOLVED_FOOD_STATUSES = [
    'PENDING',
    'UNRESOLVED',
    'NOT_FOUND',
    'FAILED',
] as const satisfies readonly CatalogFoodResolutionStatus[];

/** A status a failure record can hold. */
export type UnresolvedFoodStatus = (typeof UNRESOLVED_FOOD_STATUSES)[number];
