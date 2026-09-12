/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/ratings/ratings.schema.ts

/**
 * AUTHORED WIRE CONTRACT for the ratings vertical (`PUT`/`DELETE /api/v1/recipes/{id}/rating`).
 *
 * SOURCE OF TRUTH; copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY `zod`,
 * `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules (allowlist in `contract/config.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, composed over a `recipe-core` Value Object.
 *
 * OWNERSHIP SPLIT (§15.2 / ADR-0014): `recipe-core` owns the VALUE constraint (`recipeRatingStarsSchema`, the
 * single authority both apps' inputs also compose); THIS FILE owns the ENVELOPE. ⛔ Do NOT move a whole request
 * body back into `recipe-core` — that is the twin `recipeRequestBounds.ts`'s own header forbids, and it put the
 * strictness of a mutating body somewhere a change would alter every other consumer of the domain type.
 * `__tests__/ratings.schema.test.ts` asserts the bound is composed by IDENTITY, not by equivalence.
 */
import { z } from 'zod';

import { recipeRatingStarsSchema } from '@kitchensink/recipe-core';

/**
 * Body of `PUT /api/v1/recipes/{id}/rating`.
 *
 * The rater is ALWAYS taken from the verified bearer token, never from the body — a client-supplied rater id
 * would let any caller rate as another user. `z.strictObject` (GR-017 §17-c) answers `400` for a body carrying a
 * spoofed `userId` rather than dropping the key: the server was safe either way (it never read the field), but
 * the caller is now TOLD its field was refused instead of receiving a `200` that looks fully honoured.
 */
export const setRatingRequestSchema = z.strictObject({
    /** Whole stars, 1–5 inclusive. */
    stars: recipeRatingStarsSchema,
});

/** Request body for setting the caller's rating on a recipe. */
export type SetRatingRequest = z.infer<typeof setRatingRequestSchema>;
