/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the food (ingredient) service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/food-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/food-service/src/foods/foods.schema.ts

/**
 * THE FOOD (INGREDIENT) API WIRE CONTRACT — authored here, in the service, and copied verbatim into
 * `@kitchensink/schema-food` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * ⚠️ READ THIS FIRST: despite every `food_*` name, this is the **INGREDIENT** service. Its data comes from the
 * USDA and it holds ingredients, not dishes. A recipe is NEVER written back into it — a recipe is a method, not
 * a substance (feature 001, T150). Read every identifier below as `ingredient_*`; do not rename them.
 *
 * WHAT THIS FILE IS. The single authoritative representation of every request and response body on
 * `/api/v1/foods/*`. Before this seam existed the same shapes were written twice — `src/foods/foods.types.ts`
 * (13 interfaces) and `packages/clients/food-service/src/types.ts` (12 more, hand-written, zero zod) — and
 * NEITHER side imported the other, so a backend change to a response shape did not break the client's
 * `typecheck`. The client simply went on asserting its own beliefs about the server (§15.1).
 *
 * WHY EVERY FIELD IS SOURCE-AGNOSTIC. Every food is keyed by its internal ULID; NO source-native key (`fdcId`)
 * ever appears in a public shape (SC-013). `CandidateView.externalKey` is the sole exception and is deliberate:
 * disambiguation cannot be presented without telling the user which source's item they are picking.
 *
 * IMPORT RESTRICTION (enforced by `@kitchensink/contract-gen`, not by convention): this file may import ONLY
 * `zod` and flat sibling `*.schema.js` modules. It notably may NOT import `./dao/index.js` — which is where
 * `FoodStatus` used to come from, i.e. the wire contract used to be defined by a drizzle `pgEnum`. That is why
 * {@link foodStatusSchema} restates the lifecycle values here and
 * `src/foods/__tests__/foods.schema.test.ts` pins them to the database enum: the WIRE owns its own truth, and a
 * divergence between the two is a test failure rather than a silent contract change.
 *
 * Dates are ISO-8601 strings, never `Date` (CODING_STANDARDS).
 */
import { z } from 'zod';

/**
 * Longest food name / search term accepted on the wire.
 *
 * A BOUND, not a preference. Every one of these strings becomes work in Postgres: a name is normalized and
 * trigram-indexed, and a search term becomes an `ILIKE` pattern plus a `plainto_tsquery` parse plus a trigram
 * comparison. Unbounded, a single request could hand the database a megabyte to index or match. 200 characters
 * is comfortably above the longest USDA description this service actually stores (the descriptive names run to
 * roughly half that), so the bound rejects abuse without rejecting data.
 *
 * ⚠️ Stated in the CONTRACT rather than the controller, unlike the batch cap: this is a fixed property of the
 * wire, not a runtime knob, so a client can and should know it. The batch cap is the opposite — see
 * {@link batchAddFoodRequestSchema}.
 */
export const MAX_FOOD_NAME_LENGTH = 200;

/**
 * Food lifecycle status — the service's canonical set (FR-002/FR-003/FR-004).
 *
 * `PENDING` a fetch is enqueued · `UNRESOLVED` awaiting a human disambiguation pick · `RESOLVED` a golden
 * record exists · `NOT_FOUND` no wired source has it (tombstoned until TTL) · `FAILED` every source errored
 * past the retry budget.
 */
export const foodStatusSchema = z.enum(['PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED']);

/** Food lifecycle status (the service's canonical set). */
export type FoodStatus = z.infer<typeof foodStatusSchema>;

/** The non-terminal statuses a `202` body can carry — `RESOLVED` would be a `200`, and the rest are `404`. */
export const pendingFoodStatusSchema = z.enum(['PENDING', 'UNRESOLVED']);

/** The lifecycle statuses that answer `202 Accepted`. */
export type PendingFoodStatus = z.infer<typeof pendingFoodStatusSchema>;

/**
 * The terminal statuses a `404` body can carry — no wired source has the food (`NOT_FOUND`, tombstoned until
 * TTL) or every source errored past the retry budget (`FAILED`).
 *
 * Together with {@link pendingFoodStatusSchema} and `RESOLVED` this PARTITIONS {@link foodStatusSchema}: every
 * lifecycle value answers exactly one status code. `foods.schema.test.ts` asserts the partition is exhaustive, so
 * a migration that adds a sixth value has to decide which code it answers with instead of landing in neither
 * subset.
 */
export const terminalFoodStatusSchema = z.enum(['NOT_FOUND', 'FAILED']);

/** The lifecycle statuses that answer `404 Not Found`. */
export type TerminalFoodStatus = z.infer<typeof terminalFoodStatusSchema>;

/** A golden nutrient value in the read shape (the dictionary join, source-tagged). */
export const nutrientViewSchema = z.object({
    /** Nutrient display name (e.g. `Protein`). */
    nutrient: z.string(),
    /** Amount (numeric, full source fidelity). */
    amount: z.number(),
    /** Unit the amount is expressed in (e.g. `g`, `kcal`). */
    unit: z.string(),
    /** The basis the amount is on (`per_100g` | `per_serving`). */
    basis: z.string(),
    /** The source that supplied the winning value (e.g. `usda`). */
    source: z.string(),
});

/** A golden nutrient value (source-tagged). */
export type NutrientView = z.infer<typeof nutrientViewSchema>;

/** A household-measure portion in the read shape. */
export const portionViewSchema = z.object({
    /** Human label (e.g. `1 cup chopped`). */
    label: z.string(),
    /** Gram weight (numeric, strictly positive). */
    gramWeight: z.number(),
    /** The source that supplied the portion. */
    source: z.string(),
});

/** A household-measure portion (source-tagged). */
export type PortionView = z.infer<typeof portionViewSchema>;

/** The full golden record returned for a `RESOLVED` food (FR-002). */
export const foodResponseSchema = z.object({
    /** Internal food id (ULID). */
    id: z.string(),
    /** Golden display name. */
    name: z.string().nullable(),
    /** Golden free-text description. */
    description: z.string().nullable(),
    /** Generic/branded classification. */
    kind: z.string(),
    /** Lifecycle status (always `RESOLVED` for this shape). */
    status: foodStatusSchema,
    /** Per-100g (or per-serving) golden nutrients. */
    nutrients: z.array(nutrientViewSchema),
    /** Household-measure portions. */
    portions: z.array(portionViewSchema),
    /** Scalar-field provenance — `{ field: source }` (FR-029). */
    provenance: z.record(z.string(), z.string()),
});

/** The full golden record returned for a `RESOLVED` food. */
export type FoodResponse = z.infer<typeof foodResponseSchema>;

/**
 * Body for a `PENDING`/`UNRESOLVED` food (`202 Accepted`, FR-003).
 *
 * ⚠️ `status` is {@link pendingFoodStatusSchema}, NOT the full lifecycle. It published the five-value enum until
 * 2026-08-12, which made the contract disagree with itself — {@link getFoodResultSchema}'s pending arm already
 * used the two-value form — and forced `@kitchensink/food-service-client` to re-narrow at the boundary just to
 * keep its own declared return union honest. Only `PENDING` and `UNRESOLVED` can answer a `202`: `RESOLVED` is a
 * `200` and the terminal statuses are a `404`.
 */
export const pendingResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The lifecycle status (`PENDING` or `UNRESOLVED`). */
    status: pendingFoodStatusSchema,
    /** Best-effort seconds until availability (omitted for `UNRESOLVED`). */
    estimatedWaitSeconds: z.number().optional(),
});

/** Body for a `PENDING`/`UNRESOLVED` food (`202 Accepted`). */
export type PendingResponse = z.infer<typeof pendingResponseSchema>;

/** Body for `GET /api/v1/foods/{id}/status` (FR-007). */
export const statusResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** Current lifecycle status. */
    status: foodStatusSchema,
    /** Present for `PENDING`: estimated seconds until availability. */
    estimatedWaitSeconds: z.number().optional(),
    /** Present only when `RESOLVED`: the full golden record. */
    food: foodResponseSchema.optional(),
});

/** Body for `GET /api/v1/foods/{id}/status`. */
export type StatusResponse = z.infer<typeof statusResponseSchema>;

/** A single cross-source candidate in the disambiguation list (FR-RES-1). */
export const candidateViewSchema = z.object({
    /** The candidate row id (the PATCH-resolve pick handle). */
    candidateId: z.string(),
    /** The source the candidate came from. */
    source: z.string(),
    /** That source's opaque key for the item — the ONE place a source-native key surfaces (SC-013). */
    externalKey: z.string(),
    /** Candidate display name. */
    name: z.string(),
    /** One-line disambiguation hint, when present. */
    summary: z.string().nullable(),
});

/** A single cross-source candidate in the disambiguation list. */
export type CandidateView = z.infer<typeof candidateViewSchema>;

/** Body for `GET /api/v1/foods/{id}/candidates` (FR-RES-1). */
export const candidatesResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The (non-expired) candidate set; empty for a non-`UNRESOLVED` food. */
    candidates: z.array(candidateViewSchema),
});

/** Body for `GET /api/v1/foods/{id}/candidates`. */
export type CandidatesResponse = z.infer<typeof candidatesResponseSchema>;

/** A single search hit (FR-008). */
export const searchResultViewSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** Golden display name. */
    name: z.string().nullable(),
    /** Relevance score (trigram similarity; `1` for a barcode/external-key crosswalk hit). */
    score: z.number(),
});

/** A single search hit. */
export type SearchResultView = z.infer<typeof searchResultViewSchema>;

/** Body for `GET /api/v1/foods/search` (FR-008). */
export const searchResponseSchema = z.object({
    /** Ranked results, or an empty array on no local match (never a source call). */
    results: z.array(searchResultViewSchema),
});

/** Body for `GET /api/v1/foods/search`. */
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** Body for `POST /api/v1/foods` and `POST /api/v1/foods/{id}/refetch` (`202 Accepted`, FR-005/FR-039). */
export const addResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The lifecycle status after the add (`PENDING` on a fresh add / reactivation). */
    status: foodStatusSchema,
    /** Best-effort seconds until availability, when enqueued. */
    estimatedWaitSeconds: z.number().optional(),
});

/** Body for `POST /api/v1/foods` (`202 Accepted`). */
export type AddResponse = z.infer<typeof addResponseSchema>;

/** A single item in a batch add response (FR-045). */
export const batchItemViewSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The item's lifecycle status (`RESOLVED` inline hit, else `PENDING`). */
    status: foodStatusSchema,
    /** Golden display name (present for an inline `RESOLVED` hit). */
    name: z.string().nullable().optional(),
    /** Estimated seconds until availability (present for a `PENDING` miss). */
    estimatedWaitSeconds: z.number().optional(),
});

/** A single item in a batch add response. */
export type BatchItemView = z.infer<typeof batchItemViewSchema>;

/** Body for `POST /api/v1/foods/batch` (FR-045). */
export const batchResponseSchema = z.object({
    /** Per-item partial results (inline hits + pending misses). */
    items: z.array(batchItemViewSchema),
});

/** Body for `POST /api/v1/foods/batch`. */
export type BatchResponse = z.infer<typeof batchResponseSchema>;

/** Body for `PATCH /api/v1/foods/{id}` (FR-RES-2). */
export const resolveResponseSchema = z.object({
    /** Internal food id. */
    id: z.string(),
    /** The resulting status (`RESOLVED`). */
    status: foodStatusSchema,
});

/** Body for `PATCH /api/v1/foods/{id}`. */
export type ResolveResponse = z.infer<typeof resolveResponseSchema>;

/**
 * The union `GET /api/v1/foods/{id}` actually returns: the golden record on `200`, or a non-terminal pending
 * state on `202`. Discriminated on `status`, so a consumer narrows by branching instead of testing for the
 * presence of a field.
 *
 * This exists because the client USED to model the same fork as its own hand-written `GetFoodResult` union —
 * a second representation of one endpoint's contract, on the far side of a boundary that could not typecheck
 * against the service.
 */
export const getFoodResultSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('RESOLVED'), food: foodResponseSchema }),
    z.object({
        status: pendingFoodStatusSchema,
        id: z.string(),
        estimatedWaitSeconds: z.number().optional(),
    }),
]);

/** Either the golden record (`RESOLVED`) or a non-terminal pending state. */
export type GetFoodResult = z.infer<typeof getFoodResultSchema>;

/**
 * Request body for `POST /api/v1/foods` — add by name (FR-005/FR-006).
 *
 * The name is trimmed and required non-empty by the schema itself, so "what counts as an empty name" has one
 * definition that both the request validator and the published contract use.
 */
export const addFoodRequestSchema = z.strictObject({
    /** The display name to resolve. Trimmed; must be non-empty after trimming (FR-006). */
    name: z.string().max(MAX_FOOD_NAME_LENGTH).trim().min(1),
});

/** Request body for `POST /api/v1/foods`. */
export type AddFoodRequest = z.infer<typeof addFoodRequestSchema>;

/**
 * Request body for `POST /api/v1/foods/batch` — batch add by name (FR-045).
 *
 * Trims each name, matching the single-add path.
 *
 * TWO RULES ARE DELIBERATELY *NOT* HERE, and both belong to the controller rather than the contract:
 *  - **The batch cap** is `FOOD_MAX_BATCH_NAMES`, a runtime configuration value. A static `.max(100)` in the
 *    published contract would be a second representation of it that silently disagrees the moment the
 *    environment variable is tuned, so the controller enforces the configured bound and reports it in the `400`.
 *  - **Dropping blank entries** is server-side normalization, not a shape a client must satisfy — and a
 *    `.transform()` here cannot be represented in JSON Schema at all, so it would make the published document
 *    ungenerable while describing nothing a caller needs to know.
 */
export const batchAddFoodRequestSchema = z.strictObject({
    /** The names to add. Each trimmed. Blank entries are dropped and the rest capped, server-side. */
    names: z.array(z.string().max(MAX_FOOD_NAME_LENGTH).trim()),
});

/** Request body for `POST /api/v1/foods/batch`. */
export type BatchAddFoodRequest = z.infer<typeof batchAddFoodRequestSchema>;

/** Request body for `PATCH /api/v1/foods/{id}` — resolve from the user's candidate pick (FR-RES-2, DSN-14). */
export const resolveFoodRequestSchema = z.strictObject({
    /** The picked candidate row ids. At least one; validated against the food's own set server-side. */
    candidateIds: z.array(z.string()).min(1),
});

/** Request body for `PATCH /api/v1/foods/{id}`. */
export type ResolveFoodRequest = z.infer<typeof resolveFoodRequestSchema>;

/**
 * Query for `GET /api/v1/foods/search` (FR-008).
 *
 * ⚠️ THIS SCHEMA WAS WRITTEN AND THEN NEVER WIRED UP. The controller read a bare `@Query('query') query?: string`
 * and passed `query ?? ''` straight to the DAO, so the published contract described a validation that did not
 * exist. Three consequences, all of them reachable with one request:
 *
 *  - **Unbounded length.** The term becomes an `ILIKE` pattern, a `plainto_tsquery` parse and a trigram
 *    comparison against every candidate row. Nothing capped it.
 *  - **A wildcard scanned the catalog.** `?query=%` built the pattern `'%%%'`, which `ILIKE` matches against
 *    every row that has a name. Fixed at the point the pattern is BUILT (`toIlikePattern` in
 *    `dao/food-search.dao.ts`) rather than here — escaping at validation time would corrupt the full-text and
 *    trigram branches, which receive the same string as a VALUE and where a backslash is a character to match.
 *  - **An empty term was a silent no-op**, so a caller could not distinguish "no results" from "you sent
 *    nothing". `.min(1)` after trimming makes it a `400`.
 *
 * `query` is REQUIRED. It was previously optional with an absent value treated as the empty string — a shape
 * whose only possible outcome was an empty result set, i.e. a request that can only waste a round trip.
 */
export const searchFoodQuerySchema = z.strictObject({
    /** The search term. Trimmed; must be non-empty and within {@link MAX_FOOD_NAME_LENGTH} after trimming. */
    query: z.string().max(MAX_FOOD_NAME_LENGTH).trim().min(1),
});

/** Query for `GET /api/v1/foods/search`. */
export type SearchFoodQuery = z.infer<typeof searchFoodQuerySchema>;

/* ─────────────────────────── THE ERROR CONTRACT ─────────────────────────── */

/**
 * Every stable, machine-readable `code` the `/api/v1/foods/*` surface emits.
 *
 * ⚠️ BRANCH ON THIS, NEVER ON `message`. Until 2026-08-12 this service published THREE error shapes — the
 * `{ code, message, details? }` ARCH-PS-2 envelope, Nest's `{ statusCode, message, error }`, and the controller's
 * `{ error, …extras }` — and the only way a consumer could tell a candidate-not-in-set `409` from a
 * lifecycle-conflict `409` was `/candidate/i.test(body.error)`. That is a parser for English: it breaks on the
 * first copy edit and it fires on any unrelated message containing the word. There is now ONE shape
 * (`common/api-error.schema.ts`) and `code` is the discriminant.
 *
 * WHAT IS AND IS NOT IN HERE. These are the codes the FOOD DOMAIN owns, plus the transport-level codes its
 * routes actually answer with. `ApiExceptionFilter` additionally derives a status-shaped code for a failure no
 * documented route produces (a `405`, a `413`, a framework `404` on an unrouted path — `HTTP_<status>` at the
 * limit), so this enum is deliberately NOT "every string that can ever appear in `code`". A consumer must
 * tolerate a code it has not been taught — see {@link foodErrorSchema}.
 */
export const foodErrorCodeSchema = z.enum([
    /** A request body/query/param the boundary rejected. `details.fields` names each offending field. */
    'VALIDATION_FAILED',
    /** The `{id}` path parameter is not a structurally valid food ULID (FR-006). */
    'INVALID_ID',
    /** More names than the service-configured `FOOD_MAX_BATCH_NAMES`, which `details.maxNames` reports (FR-045). */
    'BATCH_TOO_LARGE',
    /** No valid Clerk session or M2M token (FR-051). */
    'UNAUTHORIZED',
    /** The token is valid but its `external_id` has not synced yet — retry with a refreshed token (CR-002/U1). */
    'IDENTITY_SYNC_PENDING',
    /** Authenticated, but lacking the `food:admin` scope (FR-039). */
    'FORBIDDEN',
    /** The food is being fetched or awaits disambiguation — a `202`, not a failure (FR-003). */
    'FOOD_PENDING',
    /** No such food, or a terminal `NOT_FOUND`/`FAILED` one; the status stays in `details` (FR-004). */
    'FOOD_NOT_FOUND',
    /** A resolve pick is not in the food's own candidate set (`409`, DSN-14). */
    'CANDIDATE_MISMATCH',
    /** A resolve was attempted on a food that is not awaiting disambiguation (`409`, FR-028a). */
    'NOT_RESOLVABLE',
    /** Backpressure / flood-shed / resolve cap — a `503` + `Retry-After`, NEVER a per-user `429` (FR-046). */
    'FETCH_UNAVAILABLE',
    /** An unmapped server fault. The body carries no internal detail, by design. */
    'INTERNAL_ERROR',
]);

/** A stable, machine-readable food-API failure code. */
export type FoodErrorCode = z.infer<typeof foodErrorCodeSchema>;

/**
 * The TYPED view of a food-API error body: {@link foodErrorCodeSchema} as a discriminant, with the `details`
 * each code actually carries.
 *
 * ── HOW THIS RELATES TO `apiErrorSchema`, AND WHY IT IS A SEPARATE FILE ──
 *
 * It is a REFINEMENT of the one published envelope, not a second error shape: every value here is also a valid
 * `apiErrorSchema` body, and `src/foods/__tests__/foods.schema.test.ts` asserts that for every arm. The
 * separation is forced rather than chosen — generation FLATTENS every authored schema into one directory, so a
 * `*.schema.ts` may import only a flat `./x.schema.js` sibling, and `common/api-error.schema.ts` is not one of
 * this file's siblings. The lifecycle enum, on the other hand, IS here, which is the whole reason the typed view
 * lives on this side of the line: `details.status` can be a real {@link FoodStatus} instead of the bare
 * `z.string()` the cross-vertical envelope was reduced to, which is what forced the client to re-narrow it.
 *
 * ── HOW A CONSUMER USES IT (both halves matter) ──
 *
 * 1. Parse the body with `apiErrorSchema` — it accepts ANY code, including one this build has never heard of.
 * 2. Then `foodErrorSchema.safeParse` to NARROW. Success means "a code I was taught, with the details it
 *    promises"; failure means "map by HTTP status alone", which is the correct degradation for a service
 *    deployed ahead of a released mobile binary.
 *
 * `details` is REQUIRED on every arm whose code promises one. A body that dropped `details.id` must fail the
 * typed parse — surfacing at the edge that names the field — rather than hand a caller an `undefined` that
 * surfaces three layers deeper.
 *
 * Every arm is `.loose()`: an unknown key added by a forward-compatible deploy must survive rather than turn
 * into a consumer-side parse crash.
 */
export const foodErrorSchema = z.discriminatedUnion('code', [
    z
        .object({
            code: z.literal('VALIDATION_FAILED'),
            message: z.string(),
            /** One rendered `"<field path>: <constraint>"` per rejected field. */
            details: z.object({ fields: z.array(z.string()) }).loose(),
        })
        .loose(),
    z.object({ code: z.literal('INVALID_ID'), message: z.string() }).loose(),
    z
        .object({
            code: z.literal('BATCH_TOO_LARGE'),
            message: z.string(),
            /** The configured cap, reported so a caller can re-chunk without guessing it. */
            details: z.object({ maxNames: z.number() }).loose(),
        })
        .loose(),
    z.object({ code: z.literal('UNAUTHORIZED'), message: z.string() }).loose(),
    z.object({ code: z.literal('IDENTITY_SYNC_PENDING'), message: z.string() }).loose(),
    z.object({ code: z.literal('FORBIDDEN'), message: z.string() }).loose(),
    z
        .object({
            code: z.literal('FOOD_PENDING'),
            message: z.string(),
            details: z
                .object({
                    /** Internal food id. */
                    id: z.string(),
                    /** Which non-terminal state it is in. */
                    status: pendingFoodStatusSchema,
                    /** Best-effort seconds until availability (absent for `UNRESOLVED`). */
                    estimatedWaitSeconds: z.number().optional(),
                })
                .loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('FOOD_NOT_FOUND'),
            message: z.string(),
            details: z
                .object({
                    /** Internal food id. */
                    id: z.string(),
                    /** The terminal status when a row exists; absent when there is no row at all. */
                    status: terminalFoodStatusSchema.optional(),
                })
                .loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('CANDIDATE_MISMATCH'),
            message: z.string(),
            details: z.object({ id: z.string() }).loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('NOT_RESOLVABLE'),
            message: z.string(),
            details: z
                .object({
                    /** Internal food id. */
                    id: z.string(),
                    /** The status that makes it non-resolvable (anything but `UNRESOLVED`). */
                    status: foodStatusSchema,
                })
                .loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('FETCH_UNAVAILABLE'),
            message: z.string(),
            /** Also sent as the `Retry-After` header; repeated here so a body-only consumer can read it. */
            details: z.object({ retryAfterSeconds: z.number() }).loose(),
        })
        .loose(),
    z.object({ code: z.literal('INTERNAL_ERROR'), message: z.string() }).loose(),
]);

/** A food-API error body, narrowed by its `code`. */
export type FoodError = z.infer<typeof foodErrorSchema>;
