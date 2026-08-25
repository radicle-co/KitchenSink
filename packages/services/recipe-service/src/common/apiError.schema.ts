/**
 * THE ERROR WIRE CONTRACT — ONE envelope, keyed on a PUBLISHED code. Authored here and copied into
 * `@kitchensink/schema-recipe` (`docs/CODING_STANDARDS.md` §15.2 / ADR-0014).
 *
 * SOURCE OF TRUTH for these shapes. It may import ONLY `zod`, `@kitchensink/recipe-core`, and flat sibling
 * `*.schema.js` modules — enforced by `@kitchensink/contract-gen`'s import restriction.
 *
 * ── WHAT WAS WRONG, IN TWO LAYERS ──
 *
 * ⚠️ **Layer 1 — the document described a shape the service mostly did not send.** `ErrorResponse` was
 * `@kitchensink/recipe-core`'s `recipeErrorSchema`, whose `code` is an ENUM of the fifteen recipe-DOMAIN codes.
 * That schema is CORRECT for what it is — the type guard `ApiExceptionFilter` uses to recognise a thrown domain
 * error — and WRONG as a description of the wire: the generic `500`'s `INTERNAL_ERROR`, the auth middleware's
 * `IDENTITY_SYNC_PENDING` `401`, the erasure service's `ACCOUNT_ALREADY_ERASED` `410`, every Nest
 * `{ statusCode, message, error }`, the validation `400` and the `429` all FAIL it.
 *
 * ⚠️ **Layer 2 — the service really did emit FOUR shapes**, because the filter returned `exception.getResponse()`
 * UNCHANGED: the envelope, Nest's `{ statusCode, message, error? }`, `nestjs-zod`'s
 * `{ statusCode, message: 'Validation failed', errors }`, and — for the `429` — a bare JSON **string**. An
 * earlier revision of this file published all four as a union, on the reasoning that a document must describe
 * what ships. That was the right call for a documentation-only change and the WRONG place to stop: it made the
 * inconsistency honest instead of removing it, and left the client unable to tell two `409`s apart by anything
 * better than a string compare on `body.code` through an unchecked cast.
 *
 * ── THERE IS NOW ONE SHAPE, AND THE FILTER IS ITS SOLE AUTHOR ──
 *
 * `ApiExceptionFilter` normalizes EVERY failure into {@link apiErrorSchema} and has **no passthrough branch**.
 * That is the structural core rather than a tidy-up: because the guarantee lives in one class instead of in
 * throw-site discipline, it also covers failures this service never raises — `ClerkAuthService`'s argument-less
 * `401`s, Nest's `404` for an unrouted path, the body parser's `413`, the throttler's string `429` — none of
 * which any amount of controller discipline would have reached. Same change food made (`d7684207`); this follows
 * it deliberately rather than inventing a second dialect.
 *
 * ── HOW A CONSUMER USES THE TWO SCHEMAS (both halves matter) ──
 *
 *  1. Parse with {@link apiErrorSchema} — `code` is a plain `string`, so a body carrying a code this build has
 *     never been taught still parses. That is REQUIRED, not lenient: a deployed service adds codes ahead of a
 *     released mobile binary, and narrowing here would make every new code a client-side crash.
 *  2. Then narrow with {@link recipeApiErrorSchema}, the discriminated union over `code`. Success means "a code I
 *     was taught, carrying the `details` its contract promises"; failure means "map by HTTP status alone", which
 *     is the correct degradation for exactly the skew case in (1).
 *
 * `.loose()` on every arm: a response must tolerate a field a newer server added. That is the mirror image of the
 * `z.strictObject()` rule for REQUEST bodies (GR-017 §17-c), and the asymmetry is deliberate — a request's
 * unknown key is a caller's mistake to be told about, a response's is a newer server's addition to be absorbed.
 */
import { z } from 'zod';

import { versionConflictDetailsSchema, IDENTITY_SYNC_PENDING_CODE } from '@kitchensink/recipe-core';

/**
 * The structured error envelope — the ONLY body a non-2xx response from this service carries.
 *
 * Shared VERBATIM with the food and identity services (ARCH-PS-2), so one client-side handler covers all three.
 *
 * `code` is a plain `string` and MUST stay one. ⛔ Do not "tighten" it to {@link recipeErrorCodeSchema}: that
 * would make every code the service adds a breaking change for a client that only branches on the few it knows,
 * and it is precisely how the previous `ErrorResponse` came to describe a shape the service mostly does not send.
 * The typed view is {@link recipeApiErrorSchema}, which a consumer applies SECOND and is allowed to fail.
 */
export const apiErrorSchema = z
    .object({
        /** Stable, machine-readable failure code, e.g. `VERSION_CONFLICT`, `INTERNAL_ERROR`. Branch on this. */
        code: z.string(),
        /** Human-readable summary. Never localized, never security-sensitive, never a stack trace. */
        message: z.string(),
        /** Per-code diagnostic detail, when that code's contract promises any. */
        details: z.record(z.string(), z.unknown()).optional(),
    })
    .loose();

/** The structured error envelope: `{ code, message, details? }`. */
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/**
 * Every failure code this API publishes.
 *
 * ── WHY THIS IS A SUPERSET OF `recipe-core`'s `RecipeErrorCode`, AND WHY THAT IS NOT DUPLICATION ──
 *
 * `recipe-core`'s `RecipeErrorCode` is the DOMAIN's: the codes a thrown `RecipeError` can carry, used by
 * `isRecipeError` and by every `*.error.ts` factory. This enum is the WIRE's, and it necessarily contains codes
 * that are not domain errors at all — a validation rejection, an unrouted path, a rate limit, an unmapped fault.
 * Neither is derivable from the other, so both exist; what is NOT allowed is for them to disagree about a code
 * they share, and `__tests__/apiError.schema.test.ts` asserts the subset relation MECHANICALLY over
 * `RecipeErrorCode`'s own values rather than over a hand-copied list.
 *
 * Food's `foodErrorCodeSchema` is the same shape for the same reason, and the generic members are spelled
 * IDENTICALLY across the two services on purpose, so the three services speak one vocabulary for the cases that
 * are not about their domain.
 *
 * ⛔ Adding a member here is a contract change with two mechanical consequences, both intended: `RECIPE_ERROR_STATUS`
 * (`../common/apiError.ts`) fails to compile until the new code has a status, and the typed client's exhaustive
 * `switch` fails to compile until it decides what the code MEANS. Neither is busywork — a code with no status
 * cannot be served, and a code no consumer handles is a contract nobody can use.
 */
export const recipeErrorCodeSchema = z.enum([
    // ── The fifteen recipe DOMAIN codes (mirrored from `recipe-core`'s `RecipeErrorCode`) ──
    /** No such recipe, or it is not visible to the caller. Also the answer for a recipe you may not rate. */
    'RECIPE_NOT_FOUND',
    /** The recipe was erased; a tombstone row remains so the `410` is distinguishable from a `404`. */
    'RECIPE_TOMBSTONED',
    /** The caller does not own the resource. */
    'NOT_OWNER',
    /** Optimistic-concurrency failure — `details` carries the version numbers and the conflicting snapshots. */
    'VERSION_CONFLICT',
    /** The recipe already holds the maximum of 10 photos. */
    'MAX_PHOTOS_EXCEEDED',
    /** The requested visibility transition is not allowed for this recipe's provenance (C-004). */
    'INVALID_VISIBILITY',
    /** A photo was uploaded but could not be processed (magic-byte or thumbnail failure). */
    'PHOTO_PROCESSING_FAILED',
    /** The version's S3 archive has not been written yet, so the snapshot cannot be read. */
    'ARCHIVE_PENDING',
    /** The version archive failed permanently and landed in the DLQ. */
    'ARCHIVE_DLQ',
    /** The operation requires a collection that was cloned from a source, and this one was not. */
    'COLLECTION_NOT_CLONED',
    /** A pull-from-source commit was rejected because the diff drifted since the caller's preview (W8-a.8). */
    'PULL_DRIFT',
    /** The caller already owns the maximum of 50 collections (REQ-049b). */
    'COLLECTION_LIMIT_REACHED',
    /** The caller has an in-flight account erasure, so writes are locked (HAZ-052) — a `423`. */
    'ERASURE_IN_PROGRESS',
    /** A recipe line referenced an `ingredientId` the catalog does not hold. */
    'UNKNOWN_INGREDIENT',
    /** A caller may not rate their own recipe (FR-013) — always a `403`, never a `404`. */
    'CANNOT_RATE_OWN_RECIPE',

    // ── Auth and account-lifecycle codes, which are NOT recipe-domain errors ──
    /** No, invalid, expired, or wrong-authorized-party bearer token. */
    'UNAUTHORIZED',
    /** The token verified but carries no `external_id` yet — RETRY with a refreshed token, do not surface. */
    'IDENTITY_SYNC_PENDING',
    /** Authenticated, but not permitted (a scope/permission gate rather than an ownership one). */
    'FORBIDDEN',
    /** The caller's account has already been erased — a `410` on the erasure route. */
    'ACCOUNT_ALREADY_ERASED',

    // ── Transport / framework outcomes the filter now names rather than passing through ──
    /** A request body, query or param the boundary rejected. `details.fields` names each offending field. */
    'VALIDATION_FAILED',
    /** A request for a path this service does not route. ⚠️ NOT `RECIPE_NOT_FOUND` — a different fix. */
    'NOT_FOUND',
    /** The request body exceeded the size cap (the 5 MB photo ceiling, or the JSON body limit). */
    'PAYLOAD_TOO_LARGE',
    /** The declared content type is not one this route accepts. */
    'UNSUPPORTED_MEDIA_TYPE',
    /** Per-user rate limit exceeded. */
    'TOO_MANY_REQUESTS',
    /** The instance cannot serve traffic — the readiness probe's database check failed. */
    'NOT_READY',
    /**
     * The on-demand live ingredient search was refused on the RATE budget — ours (FR-019's reserved
     * interactive lane is spent) or the upstream source's own `429`. A `503`; `details.retryAfterSeconds`
     * carries the window when one is known (plan U29).
     */
    'SOURCE_BUSY',
    /**
     * The upstream food-data source did not answer the on-demand live search — a `502`.
     *
     * ⛔ Deliberately distinct from {@link SOURCE_BUSY} rather than a second spelling of it. That one is a
     * rate refusal that names when to come back; this one is an outage we can say nothing about. The picker
     * renders two different sentences and a cook takes two different actions.
     */
    'SOURCE_UNAVAILABLE',
    /** An unmapped server fault. The body carries no internal detail, by design. */
    'INTERNAL_ERROR',
]);

/** A stable, machine-readable recipe-API failure code. */
export type RecipeErrorCode = z.infer<typeof recipeErrorCodeSchema>;

/** `{ code, message }` with no promised `details` — the shape most codes have. */
const bare = <TCode extends RecipeErrorCode>(code: TCode) =>
    z.object({ code: z.literal(code), message: z.string() }).loose();

/**
 * The TYPED view of an error body: {@link recipeErrorCodeSchema} as a discriminant, with the `details` each code
 * actually carries.
 *
 * It is a REFINEMENT of {@link apiErrorSchema}, never a second error shape — every value here is also a valid
 * `apiErrorSchema` body, asserted for EVERY arm in `__tests__/apiError.schema.test.ts` rather than assumed.
 *
 * `details` is REQUIRED on every arm whose code promises one. A body that dropped `details.currentVersion` must
 * FAIL the typed parse — surfacing at the boundary, naming the field — rather than handing a caller an
 * `undefined` that surfaces three layers deeper as "cannot read property of undefined".
 *
 * ⚠️ `PULL_DRIFT`'s `details.diff` is deliberately NOT typed structurally here, and the reason is a real
 * constraint rather than an oversight. The diff's shape is `pullDiffSchema`, authored in
 * `../collections/collections.schema.ts`; generation FLATTENS every authored schema into one directory, so a
 * `*.schema.ts` may import only a FLAT `./x.schema.js` sibling, and that file is not one of this module's
 * siblings in the service tree. Re-declaring the diff here to get a typed `details` would create a second
 * authority for `PullDiff` — the exact defect ADR-0014 exists to remove — so the arm guarantees only that
 * `details.diff` is PRESENT, and the consumer narrows it with `pullDiffSchema`, which it already imports from
 * `@kitchensink/schema-recipe` and already parses the preview response with.
 */
export const recipeApiErrorSchema = z.discriminatedUnion('code', [
    // ── Codes whose `details` are part of their contract ──
    z
        .object({
            code: z.literal('VERSION_CONFLICT'),
            message: z.string(),
            /**
             * The optimistic-concurrency detail, INCLUDING the W8-a.5 snapshots that let a conflict UI 3-way
             * merge without re-fetching. Composed from `recipe-core`'s own schema, never re-declared.
             */
            details: versionConflictDetailsSchema.loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('PULL_DRIFT'),
            message: z.string(),
            /** Carries `diff` — the freshly-derived `PullDiff`. See the note above on why it is not typed here. */
            details: z.object({ diff: z.unknown() }).loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('VALIDATION_FAILED'),
            message: z.string(),
            /** One rendered `"<field path>: <constraint>"` per rejected field. */
            details: z.object({ fields: z.array(z.string()) }).loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('COLLECTION_LIMIT_REACHED'),
            message: z.string(),
            /** The configured cap, reported so a caller need not guess it. */
            details: z.object({ limit: z.number() }).loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('MAX_PHOTOS_EXCEEDED'),
            message: z.string(),
            /** The per-recipe photo cap. */
            details: z.object({ limit: z.number() }).loose(),
        })
        .loose(),

    // ── Codes carrying no promised `details` ──
    bare('RECIPE_NOT_FOUND'),
    bare('RECIPE_TOMBSTONED'),
    bare('NOT_OWNER'),
    bare('INVALID_VISIBILITY'),
    bare('PHOTO_PROCESSING_FAILED'),
    bare('ARCHIVE_PENDING'),
    bare('ARCHIVE_DLQ'),
    bare('COLLECTION_NOT_CLONED'),
    bare('ERASURE_IN_PROGRESS'),
    bare('UNKNOWN_INGREDIENT'),
    bare('CANNOT_RATE_OWN_RECIPE'),
    bare('UNAUTHORIZED'),
    bare('IDENTITY_SYNC_PENDING'),
    bare('FORBIDDEN'),
    bare('ACCOUNT_ALREADY_ERASED'),
    bare('NOT_FOUND'),
    bare('PAYLOAD_TOO_LARGE'),
    bare('UNSUPPORTED_MEDIA_TYPE'),
    bare('TOO_MANY_REQUESTS'),
    bare('NOT_READY'),
    // `details.retryAfterSeconds` is OPTIONAL, deliberately: a refusal from our own reserved lane names its
    // window, while one relayed from an upstream `429` may not — and inventing a number would tell a cook to
    // come back at a moment nothing has any basis for.
    z
        .object({
            code: z.literal('SOURCE_BUSY'),
            message: z.string(),
            details: z.object({ retryAfterSeconds: z.number().int().nonnegative() }).loose().optional(),
        })
        .loose(),
    bare('SOURCE_UNAVAILABLE'),
    bare('INTERNAL_ERROR'),
]);

/** An error body whose `code` this build has been taught, with the `details` that code promises. */
export type RecipeApiError = z.infer<typeof recipeApiErrorSchema>;

// ── Re-exported wire shapes: the error payloads a consumer must branch on ─────────────────────────

/*
 * ⚠️ RE-EXPORT, NOT RE-DECLARATION. `recipe-core` remains the sole AUTHOR; this makes the shape reachable from
 * `@kitchensink/schema-recipe`, which is authoritative for everything on the recipe wire. The full reasoning
 * (and the `CONTRACT_HASH` residual it does not close) is stated ONCE, in `recipes.schema.ts`. ⛔ Do not
 * re-declare it here to make this file self-contained.
 */
export {
    /**
     * The `code` on the `401` a client must RETRY rather than surface (the first-token sync race). Re-exported
     * because the auth middleware raises it from `recipe-core`'s constant while the union above spells it as a
     * literal; `__tests__/apiError.schema.test.ts` asserts the two are the same string, so the middleware and
     * the published union cannot drift.
     */
    IDENTITY_SYNC_PENDING_CODE,
    /**
     * The `details` payload of a `VERSION_CONFLICT` — `{ currentVersion, conflictingVersion, server, base? }`.
     * Re-exported alongside the envelope so a consumer gets every schema it needs to parse an error from one
     * package. It is also composed directly into the typed union's `VERSION_CONFLICT` arm above.
     */
    versionConflictDetailsSchema,
};
