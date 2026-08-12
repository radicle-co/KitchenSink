/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/versions/versions.schema.ts

/**
 * AUTHORED WIRE CONTRACT for the versions vertical (`/api/v1/recipes/{id}/versions…`).
 *
 * SOURCE OF TRUTH for these shapes. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/config.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, composed over `recipe-core`'s domain ENTITIES. This
 * vertical's list and detail bodies ARE those entities (a version is `recipeVersionSchema`, a recipe is
 * `recipeDetailSchema`), so what this file adds is the one shape that is neither: the restore ENVELOPE.
 *
 * ── WHY THIS FILE NOW EXISTS (IT DID NOT BEFORE) ──
 *
 * The versions vertical was the only one of the eight with no authored `*.schema.ts`, and
 * {@link restoreVersionResponseSchema} was declared in `@kitchensink/recipe-core` instead. That was a wire
 * ENVELOPE — the body of exactly one route, shaped like a description of one operation rather than like anything
 * in the recipe domain — living in the DOMAIN package, which is the boundary ADR-0014 and GR-007 draw between
 * each other. Moving it here is not a stylistic tidy-up; it closes a hole in drift layer 3, because
 * `CONTRACT_HASH` is computed over the service's authored `*.schema.ts` sources and therefore did not move when
 * this response's shape changed.
 *
 * ✅ RESIDUAL NOW CLOSED (and recorded because the note used to say otherwise). The ENTITY schemas this envelope
 * composes (`recipeDetailSchema`, `recipeVersionSchema`) are authored in `recipe-core`, and a change to them
 * used to move no `CONTRACT_HASH` — so drift layer 3 was blind to every entity body this API returns.
 * `computeContractHash` now fingerprints the COMPOSED sources too (`collectComposedSources`), and its
 * `composed` parameter is REQUIRED with no default so a caller cannot quietly recreate the blind hash. Recipe is
 * the service where this mattered: it is the only one whose import allowlist admits a composed package at all.
 */
import { z } from 'zod';

import { recipeDetailSchema, recipeVersionSchema } from '@kitchensink/recipe-core';

/**
 * A version number as this RESPONSE reports it: a positive whole number.
 *
 * ⚠️ DECLARED HERE, and that is not the re-declaration this seam forbids — the distinction is worth stating
 * because it looks like one. Two facts settle it:
 *
 *  1. **There was nothing to compose.** While this envelope lived in `recipe-core` it used that module's
 *     `positiveIntSchema`, which is module-PRIVATE and not exported, so moving the envelope necessarily moves
 *     this bound with it. (The empirical proof was immediate and worth recording: importing the private symbol
 *     produced `undefined` and the OpenAPI derivation failed with `Cannot read properties of undefined (reading
 *     '_zod')` rather than compiling into a component describing nothing.)
 *  2. **It is not the same rule as any request bound.** `recipe-core`'s nearest neighbour is
 *     `recipeExpectedVersionSchema`, which is a REQUEST field carrying the int4 ceiling because it reaches
 *     `WHERE current_version = $1` and an out-of-range value would be a `500`. These two fields are SERVER-
 *     PRODUCED and write nothing, so that ceiling is not their rule — composing it would publish a `maximum`
 *     this response cannot exceed anyway, and would tie a response's shape to a request's storage concern.
 *
 * The published shape is therefore unchanged from what `recipe-core` emitted: `{ type: 'integer',
 * exclusiveMinimum: 0 }`.
 */
const versionNumberSchema = z.number().int().positive();

/**
 * Response of `POST /api/v1/recipes/{id}/versions/{versionNumber}/restore`: the recipe after the restore, the
 * version it was restored FROM, and the recipe's new current version number.
 *
 * All three fields are required. `restoredFromVersion` is echoed back rather than left to the caller's memory
 * because a restore is not idempotent from the client's point of view — it MINTS a new version — so a client
 * that retried needs to know which snapshot the server actually applied.
 *
 * NOT `.readonly()`, unlike this contract's other response bodies, and deliberately so: `recipeDetailSchema` is
 * `recipe-core`'s and is not itself readonly, so wrapping only the envelope would produce a shallowly-frozen
 * type whose `recipe` is still mutable — a `readonly` that reads as a guarantee and is not one. The consistent
 * treatment belongs with `recipe-core`'s entity schemas (the same widening `collections.schema.ts` records
 * accepting) rather than being forked for one route.
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
 * `@kitchensink/schema-recipe`, which is authoritative for everything on the recipe wire. The full reasoning
 * (and the `CONTRACT_HASH` residual it does not close) is stated ONCE, in `recipes.schema.ts`. ⛔ Do not
 * re-declare it here to make this file self-contained.
 */
export {
    /** The `RecipeVersion` component — one version snapshot, and each element of `RecipeVersionList`. */
    recipeVersionSchema,
};
