/**
 * AUTHORED WIRE CONTRACT for the ratings vertical (`PUT`/`DELETE /api/v1/recipes/{id}/rating`).
 *
 * This file is the SOURCE OF TRUTH for these shapes. It is copied verbatim into
 * `@kitchensink/schema-recipe`, which the typed client — and therefore web and mobile — compile against, so
 * it may import ONLY `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules. See
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/config.ts`) for why that restriction
 * is load-bearing rather than stylistic.
 *
 * DESIGN PATTERN: single-source schema + inferred type, composed over a `recipe-core` Value Object. The zod
 * schema is the definition; the TypeScript type is `z.infer` of it, so a shape cannot be validated one way and
 * typed another.
 *
 * ── WHAT CHANGED HERE, AND WHY IT IS NOT A RE-DECLARATION ──
 *
 * This file used to be `export const setRatingRequestSchema = setRecipeRatingInputSchema` — an alias for a WHOLE
 * REQUEST BODY authored in `@kitchensink/recipe-core`. That was the one thing `recipeRequestBounds.ts`'s own
 * header forbids outright ("⛔ Do NOT add a whole request body schema here: the moment this module describes an
 * ENVELOPE the service also describes, the twin is back"), and it had two consequences worth naming:
 *
 *  1. **The rating body could not be made strict without editing a shared domain package.** GR-017 §17-c makes
 *     `z.strictObject()` the default for a mutating body; `PUT …/rating` is mutating; the schema lived somewhere
 *     a strictness change would have altered every other consumer of the domain type.
 *  2. **The type twin was live.** `SetRecipeRatingInput` (a hand-written `interface`) and this schema described
 *     one thing twice, which is the drift ADR-0014 exists to remove.
 *
 * The split is now the same one every other vertical uses: `recipe-core` owns the VALUE constraint
 * (`recipeRatingStarsSchema` — whole stars, 1–5, the single authority both apps' inputs also compose), and THIS
 * FILE owns the ENVELOPE (that the body has a `stars` field, that it is required, and that nothing else is
 * accepted). Nothing is re-declared: the bound is composed by reference, and
 * `__tests__/ratings.schema.test.ts` asserts that by IDENTITY rather than by equivalence.
 */
import { z } from 'zod';

import { recipeRatingStarsSchema } from '@kitchensink/recipe-core';

/**
 * Body of `PUT /api/v1/recipes/{id}/rating`.
 *
 * The rater is ALWAYS taken from the verified bearer token, never from the body — a client-supplied rater id
 * would let any caller rate as another user. `z.strictObject` (GR-017 §17-c) means a body carrying a spoofed
 * `userId` is answered `400` rather than parsed to `{ stars }` with the extra key dropped. The SERVER was safe
 * either way (it never read the field); what changes is that the caller is now TOLD its field was refused
 * instead of receiving a `200` that looks like the whole body was honoured.
 */
export const setRatingRequestSchema = z.strictObject({
    /** Whole stars, 1–5 inclusive. The bound is `recipe-core`'s, composed by reference and never restated. */
    stars: recipeRatingStarsSchema,
});

/** Request body for setting the caller's rating on a recipe. */
export type SetRatingRequest = z.infer<typeof setRatingRequestSchema>;
