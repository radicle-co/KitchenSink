/**
 * AUTHORED WIRE CONTRACT for the versions vertical (`/api/v1/recipes/{id}/versions…`).
 *
 * SOURCE OF TRUTH; copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY `zod`,
 * `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules (allowlist in `contract/config.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, composed over `recipe-core`'s domain ENTITIES. This
 * vertical's list and detail bodies ARE those entities (a version is `recipeVersionSchema`, a recipe is
 * `recipeDetailSchema`), so what this file adds is the one shape that is neither: the restore ENVELOPE.
 *
 * ⛔ A wire ENVELOPE belongs HERE, never in `recipe-core` — the boundary ADR-0014 and GR-007 draw between each
 * other, and load-bearing rather than stylistic: `CONTRACT_HASH` is computed over the service's authored
 * `*.schema.ts` sources, so while this response lived in the domain package its shape could change without
 * moving the hash. Composed entity sources are fingerprinted too now (`collectComposedSources`), and
 * `computeContractHash`'s `composed` parameter is REQUIRED with no default so a caller cannot quietly recreate
 * the blind hash.
 */
import { z } from 'zod';

import { recipeDetailSchema, recipeVersionSchema } from '@kitchensink/recipe-core';

/**
 * A version number as this RESPONSE reports it: a positive whole number.
 *
 * ⚠️ DECLARED HERE, and that is NOT the re-declaration this seam forbids — worth stating because it looks like
 * one. Two facts settle it:
 *
 *  1. **There was nothing to compose.** `recipe-core`'s nearest base, `positiveIntSchema`, is module-PRIVATE and
 *     unexported; importing it yields `undefined` and fails the OpenAPI derivation (`Cannot read properties of
 *     undefined (reading '_zod')`) rather than compiling into a component describing nothing.
 *  2. **It is not the same rule as any request bound.** `recipeExpectedVersionSchema` carries the int4 ceiling
 *     because it reaches `WHERE current_version = $1`, where an out-of-range value is a `500`. These two fields
 *     are SERVER-PRODUCED and write nothing, so composing that ceiling would tie a response's shape to a
 *     request's storage concern.
 *
 * The published shape is unchanged from what `recipe-core` emitted: `{ type: 'integer', exclusiveMinimum: 0 }`.
 */
const versionNumberSchema = z.number().int().positive();

/**
 * Response of `POST /api/v1/recipes/{id}/versions/{versionNumber}/restore`: the recipe after the restore, the
 * version it was restored FROM, and the recipe's new current version number. All three are required.
 *
 * `restoredFromVersion` is echoed back rather than left to the caller's memory because a restore MINTS a new
 * version — so it is not idempotent from the client's point of view, and a client that retried needs to know
 * which snapshot the server actually applied.
 *
 * ⚠️ NOT `.readonly()`, unlike this contract's other response bodies, and deliberately: `recipeDetailSchema` is
 * `recipe-core`'s and is not itself readonly, so wrapping only the envelope would produce a shallowly-frozen type
 * whose `recipe` is still mutable — a `readonly` that reads as a guarantee and is not one. The consistent
 * treatment belongs with `recipe-core`'s entity schemas, not forked for one route.
 */
export const restoreVersionResponseSchema = z.object({
    /** The recipe as it stands AFTER the restore — the same detail body `GET /api/v1/recipes/{id}` returns. */
    recipe: recipeDetailSchema,
    /** The version number whose snapshot was applied. */
    restoredFromVersion: versionNumberSchema,
    /** The recipe's new `currentVersion` — always greater than `restoredFromVersion`, never equal to it. */
    currentVersion: versionNumberSchema,
});

/** The body of a successful version restore. */
export type RestoreVersionResponse = z.infer<typeof restoreVersionResponseSchema>;

// ── Re-exported wire shapes: the version entity body this vertical serves ─────────────────────────

/*
 * ⚠️ RE-EXPORT, NOT RE-DECLARATION. `recipe-core` remains the sole AUTHOR; this makes the shape reachable from
 * `@kitchensink/schema-recipe`, which is authoritative for everything on the recipe wire. Full reasoning is
 * stated ONCE, in `recipes.schema.ts`. ⛔ Do not re-declare it here to make this file self-contained.
 */
export {
    /** The `RecipeVersion` component — one version snapshot, and each element of `RecipeVersionList`. */
    recipeVersionSchema,
};
