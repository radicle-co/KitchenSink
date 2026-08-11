/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the source and
 * regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/ratings/ratings.schema.ts

/**
 * AUTHORED WIRE CONTRACT for the ratings vertical (`PUT`/`DELETE /api/v1/recipes/{id}/rating`).
 *
 * This file is the SOURCE OF TRUTH for these shapes. It is copied verbatim into
 * `@kitchensink/schema-recipe`, which the typed client — and therefore web and mobile — compile against, so
 * it may import ONLY `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules. See
 * `contract/schema-imports.ts` for why that restriction is load-bearing rather than stylistic.
 *
 * DESIGN PATTERN: single-source schema + inferred type. The zod schema is the definition; the TypeScript
 * type is `z.infer` of it, so a shape cannot be validated one way and typed another.
 *
 * NOTE ON COMPOSITION — this file deliberately does NOT re-declare the rating body. `@kitchensink/recipe-core`
 * already owns `setRecipeRatingInputSchema` (whole stars, 1-5), and it is imported by both the service and
 * the client today. Re-declaring it here to make this file self-contained would create a second authority
 * for one rule and reintroduce exactly the drift this seam exists to remove.
 */
import type { z } from 'zod';

import { setRecipeRatingInputSchema } from '@kitchensink/recipe-core';

/**
 * Body of `PUT /api/v1/recipes/{id}/rating`.
 *
 * The rater is ALWAYS taken from the verified bearer token, never from the body — a client-supplied rater id
 * would let any caller rate as another user. The schema is non-strict, so a body carrying a spoofed `userId`
 * parses to `{ stars }` and the extra key is dropped rather than reaching the service.
 */
export const setRatingRequestSchema = setRecipeRatingInputSchema;

/** Request body for setting the caller's rating on a recipe. */
export type SetRatingRequest = z.infer<typeof setRatingRequestSchema>;
