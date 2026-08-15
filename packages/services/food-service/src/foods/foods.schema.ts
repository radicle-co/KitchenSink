/**
 * THE FOOD (INGREDIENT) API WIRE CONTRACT — authored here and copied verbatim into `@kitchensink/schema-food`
 * (`docs/CODING_STANDARDS.md` §15.2). The single authoritative representation of every request and response body
 * on `/api/v1/foods/*`; these shapes were previously written twice, in the service and again by hand in the
 * client, with NEITHER side importing the other — so a change to a response shape did not break the client's
 * `typecheck` (§15.1).
 *
 * ⚠️ Despite every `food_*` name this is the **INGREDIENT** service: its data comes from the USDA and it holds
 * ingredients, not dishes. A recipe is NEVER written back into it — a recipe is a method, not a substance
 * (feature 001, T150). Read every identifier below as `ingredient_*`; do not rename them.
 *
 * SOURCE-AGNOSTIC BY RULE: every food is keyed by its internal ULID, and NO source-native key (`fdcId`) appears
 * in a public shape (SC-013). `CandidateView.externalKey` is the sole exception and is deliberate —
 * disambiguation cannot be presented without telling the user which source's item they are picking.
 *
 * IMPORT RESTRICTION (enforced by `@kitchensink/contract-gen`, not by convention): this file may import ONLY
 * `zod` and flat sibling `*.schema.js` modules. It notably may NOT import `./dao/index.js`, which is where
 * `FoodStatus` used to come from — i.e. the wire contract used to be defined by a drizzle `pgEnum`. That is why
 * {@link foodStatusSchema} restates the lifecycle values here and `__tests__/foods.schema.test.ts` pins them to
 * the database enum: the WIRE owns its own truth, and a divergence is a test failure rather than a silent
 * contract change.
 */
import { z } from 'zod';

/**
 * Longest food name / search term accepted on the wire — a BOUND, not a preference. Every one of these strings
 * becomes work in Postgres (a name is normalized and trigram-indexed; a term becomes an `ILIKE` pattern plus a
 * `plainto_tsquery` parse plus a trigram comparison), so unbounded, one request could hand the database a
 * megabyte to index or match. 200 is comfortably above the longest USDA description this service stores.
 *
 * ⚠️ Stated in the CONTRACT rather than the controller because it is a fixed property of the wire that a client
 * can and should know. The batch cap is the opposite — see {@link batchAddFoodRequestSchema}.
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

export type FoodStatus = z.infer<typeof foodStatusSchema>;

/** The non-terminal statuses a `202` body can carry — `RESOLVED` would be a `200`, and the rest are `404`. */
export const pendingFoodStatusSchema = z.enum(['PENDING', 'UNRESOLVED']);

export type PendingFoodStatus = z.infer<typeof pendingFoodStatusSchema>;

/**
 * The terminal statuses a `404` body can carry — no wired source has the food (`NOT_FOUND`, tombstoned until
 * TTL) or every source errored past the retry budget (`FAILED`).
 *
 * With {@link pendingFoodStatusSchema} and `RESOLVED` this PARTITIONS {@link foodStatusSchema}: every lifecycle
 * value answers exactly one status code. `foods.schema.test.ts` asserts the partition is exhaustive, so a
 * migration that adds a sixth value has to decide which code it answers with instead of landing in neither
 * subset.
 */
export const terminalFoodStatusSchema = z.enum(['NOT_FOUND', 'FAILED']);

export type TerminalFoodStatus = z.infer<typeof terminalFoodStatusSchema>;

/** A golden nutrient value in the read shape (the dictionary join, source-tagged). */
export const nutrientViewSchema = z.object({
    /** Nutrient display name (e.g. `Protein`). */
    nutrient: z.string(),
    /** Amount, at full source fidelity. */
    amount: z.number(),
    /** Unit the amount is expressed in (e.g. `g`, `kcal`). */
    unit: z.string(),
    /** The basis the amount is on (`per_100g` | `per_serving`). */
    basis: z.string(),
    /** The source that supplied the winning value (e.g. `usda`). */
    source: z.string(),
});

export type NutrientView = z.infer<typeof nutrientViewSchema>;

/** A household-measure portion in the read shape (source-tagged). */
export const portionViewSchema = z.object({
    /** Human label (e.g. `1 cup chopped`). */
    label: z.string(),
    /** Gram weight; strictly positive. */
    gramWeight: z.number(),
    source: z.string(),
});

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
    /** Always `RESOLVED` for this shape. */
    status: foodStatusSchema,
    /** Per-100g (or per-serving) golden nutrients. */
    nutrients: z.array(nutrientViewSchema),
    /** Household-measure portions. */
    portions: z.array(portionViewSchema),
    /** Scalar-field provenance — `{ field: source }` (FR-029). */
    provenance: z.record(z.string(), z.string()),
});

export type FoodResponse = z.infer<typeof foodResponseSchema>;

/**
 * Body for a `PENDING`/`UNRESOLVED` food (`202 Accepted`, FR-003).
 *
 * ⚠️ `status` is {@link pendingFoodStatusSchema}, NOT the full lifecycle: only `PENDING` and `UNRESOLVED` can
 * answer a `202` — `RESOLVED` is a `200` and the terminal statuses are a `404`. Publishing the five-value enum
 * here made the contract disagree with itself ({@link getFoodResultSchema}'s pending arm already used the
 * two-value form) and forced `@kitchensink/food-service-client` to re-narrow at the boundary.
 */
export const pendingResponseSchema = z.object({
    id: z.string(),
    status: pendingFoodStatusSchema,
    /** Best-effort seconds until availability (omitted for `UNRESOLVED`). */
    estimatedWaitSeconds: z.number().optional(),
});

export type PendingResponse = z.infer<typeof pendingResponseSchema>;

/** Body for `GET /api/v1/foods/{id}/status` (FR-007). */
export const statusResponseSchema = z.object({
    id: z.string(),
    status: foodStatusSchema,
    /** Present for `PENDING`: estimated seconds until availability. */
    estimatedWaitSeconds: z.number().optional(),
    /** Present only when `RESOLVED`: the full golden record. */
    food: foodResponseSchema.optional(),
});

export type StatusResponse = z.infer<typeof statusResponseSchema>;

/** A single cross-source candidate in the disambiguation list (FR-RES-1). */
export const candidateViewSchema = z.object({
    /** The candidate row id (the PATCH-resolve pick handle). */
    candidateId: z.string(),
    source: z.string(),
    /** That source's opaque key for the item — the ONE place a source-native key surfaces (SC-013). */
    externalKey: z.string(),
    name: z.string(),
    /** One-line disambiguation hint, when present. */
    summary: z.string().nullable(),
});

export type CandidateView = z.infer<typeof candidateViewSchema>;

/** Body for `GET /api/v1/foods/{id}/candidates` (FR-RES-1). */
export const candidatesResponseSchema = z.object({
    id: z.string(),
    /** The (non-expired) candidate set; empty for a non-`UNRESOLVED` food. */
    candidates: z.array(candidateViewSchema),
});

export type CandidatesResponse = z.infer<typeof candidatesResponseSchema>;

/** A single search hit (FR-008). */
export const searchResultViewSchema = z.object({
    id: z.string(),
    /** Golden display name. */
    name: z.string().nullable(),
    /** Relevance score (trigram similarity; `1` for a barcode/external-key crosswalk hit). */
    score: z.number(),
});

export type SearchResultView = z.infer<typeof searchResultViewSchema>;

/** Body for `GET /api/v1/foods/search` (FR-008). */
export const searchResponseSchema = z.object({
    /** Ranked results, or an empty array on no local match (never a source call). */
    results: z.array(searchResultViewSchema),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** Body for `POST /api/v1/foods` and `POST /api/v1/foods/{id}/refetch` (`202 Accepted`, FR-005/FR-039). */
export const addResponseSchema = z.object({
    id: z.string(),
    /** The lifecycle status after the add (`PENDING` on a fresh add / reactivation). */
    status: foodStatusSchema,
    /** Best-effort seconds until availability, when enqueued. */
    estimatedWaitSeconds: z.number().optional(),
});

export type AddResponse = z.infer<typeof addResponseSchema>;

/** A single item in a batch add response (FR-045). */
export const batchItemViewSchema = z.object({
    id: z.string(),
    /** `RESOLVED` for an inline hit, else `PENDING`. */
    status: foodStatusSchema,
    /** Golden display name (present for an inline `RESOLVED` hit). */
    name: z.string().nullable().optional(),
    /** Estimated seconds until availability (present for a `PENDING` miss). */
    estimatedWaitSeconds: z.number().optional(),
});

export type BatchItemView = z.infer<typeof batchItemViewSchema>;

/** Body for `POST /api/v1/foods/batch` (FR-045). */
export const batchResponseSchema = z.object({
    /** Per-item partial results (inline hits + pending misses). */
    items: z.array(batchItemViewSchema),
});

export type BatchResponse = z.infer<typeof batchResponseSchema>;

/**
 * Body for `PATCH /api/v1/foods/{id}` (FR-RES-2).
 *
 * `status` is the LITERAL `'RESOLVED'`, not the five-value lifecycle: a resolve answers `200` with that status
 * and nothing else — both returns in `FoodsService.patchResolve` are the literal (the idempotent no-op and the
 * post-merge success), and every other outcome throws to a `404`, `409` or `503`.
 */
export const resolveResponseSchema = z.object({
    id: z.string(),
    status: z.literal('RESOLVED'),
});

export type ResolveResponse = z.infer<typeof resolveResponseSchema>;

/**
 * The union `GET /api/v1/foods/{id}` actually returns: the golden record on `200`, or a non-terminal pending
 * state on `202`. Discriminated on `status`, so a consumer narrows by branching instead of testing for the
 * presence of a field — and the fork is modelled ONCE, on this side of the boundary (see the header).
 */
export const getFoodResultSchema = z.discriminatedUnion('status', [
    z.object({ status: z.literal('RESOLVED'), food: foodResponseSchema }),
    z.object({
        status: pendingFoodStatusSchema,
        id: z.string(),
        estimatedWaitSeconds: z.number().optional(),
    }),
]);

export type GetFoodResult = z.infer<typeof getFoodResultSchema>;

/**
 * Request body for `POST /api/v1/foods` — add by name (FR-005/FR-006). The name is trimmed and required
 * non-empty by the schema itself, so "what counts as an empty name" has one definition that both the request
 * validator and the published contract use.
 */
export const addFoodRequestSchema = z.strictObject({
    /** The display name to resolve (FR-006). */
    name: z.string().max(MAX_FOOD_NAME_LENGTH).trim().min(1),
});

export type AddFoodRequest = z.infer<typeof addFoodRequestSchema>;

/**
 * Request body for `POST /api/v1/foods/batch` — batch add by name (FR-045). Trims each name, matching the
 * single-add path.
 *
 * ⛔ TWO RULES ARE DELIBERATELY *NOT* HERE, and both belong to the controller rather than the contract:
 *  - **The batch cap** is `FOOD_MAX_BATCH_NAMES`, a runtime configuration value. A static `.max(100)` in the
 *    published contract would be a second representation of it that silently disagrees the moment the
 *    environment variable is tuned, so the controller enforces the configured bound and reports it in the `400`.
 *  - **Dropping blank entries** is server-side normalization, not a shape a client must satisfy — and a
 *    `.transform()` here cannot be represented in JSON Schema at all, so it would make the published document
 *    ungenerable while describing nothing a caller needs to know.
 */
export const batchAddFoodRequestSchema = z.strictObject({
    /** The names to add. Blank entries are dropped and the rest capped, server-side. */
    names: z.array(z.string().max(MAX_FOOD_NAME_LENGTH).trim()),
});

export type BatchAddFoodRequest = z.infer<typeof batchAddFoodRequestSchema>;

/** Request body for `PATCH /api/v1/foods/{id}` — resolve from the user's candidate pick (FR-RES-2, DSN-14). */
export const resolveFoodRequestSchema = z.strictObject({
    /** The picked candidate row ids. At least one; validated against the food's own set server-side. */
    candidateIds: z.array(z.string()).min(1),
});

export type ResolveFoodRequest = z.infer<typeof resolveFoodRequestSchema>;

/**
 * Query for `GET /api/v1/foods/search` (FR-008).
 *
 * `query` is REQUIRED and non-empty after trimming: an absent or blank term can only produce an empty result
 * set, and the `400` is what lets a caller tell "no results" from "you sent nothing". Its length is bounded for
 * the reason given on {@link MAX_FOOD_NAME_LENGTH}.
 *
 * ⚠️ Wildcards are NOT escaped here. `?query=%` built the `ILIKE` pattern `'%%%'`, which matches every row that
 * has a name; that is fixed at the point the pattern is BUILT (`toIlikePattern` in `dao/foodSearch.dao.ts`),
 * because escaping at validation time would corrupt the full-text and trigram branches, which receive the same
 * string as a VALUE and where a backslash is a character to match.
 */
export const searchFoodQuerySchema = z.strictObject({
    query: z.string().max(MAX_FOOD_NAME_LENGTH).trim().min(1),
});

export type SearchFoodQuery = z.infer<typeof searchFoodQuerySchema>;

/* ─────────────────────────── THE ERROR CONTRACT ─────────────────────────── */

/**
 * Every stable, machine-readable `code` the `/api/v1/foods/*` surface emits.
 *
 * ⚠️ BRANCH ON THIS, NEVER ON `message`. Telling a candidate-not-in-set `409` from a lifecycle-conflict `409`
 * once required `/candidate/i.test(body.error)` — a parser for English, which breaks on the first copy edit and
 * fires on any unrelated message containing the word. There is ONE error shape (`common/apiError.schema.ts`)
 * and `code` is the discriminant.
 *
 * ⚠️ Deliberately NOT "every string that can ever appear in `code`": these are the codes the FOOD DOMAIN owns
 * plus the transport-level codes its routes answer with, while `ApiExceptionFilter` additionally derives a
 * status-shaped code for a failure no documented route produces (a `405`, a `413`, a framework `404` on an
 * unrouted path — `HTTP_<status>` at the limit). A consumer must tolerate a code it has not been taught — see
 * {@link foodErrorSchema}.
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

export type FoodErrorCode = z.infer<typeof foodErrorCodeSchema>;

/**
 * The TYPED view of a food-API error body: {@link foodErrorCodeSchema} as a discriminant, with the `details`
 * each code actually carries.
 *
 * It is a REFINEMENT of the one published envelope, not a second error shape — every value here is also a valid
 * `apiErrorSchema` body, asserted per arm by `__tests__/foods.schema.test.ts`. The separate file is forced
 * rather than chosen: generation FLATTENS every authored schema into one directory, so a `*.schema.ts` may
 * import only a flat `./x.schema.js` sibling, and `common/apiError.schema.ts` is not one. The lifecycle enum IS
 * here, which is the whole reason the typed view lives on this side of the line — `details.status` can be a real
 * {@link FoodStatus} instead of the bare `z.string()` the cross-vertical envelope was reduced to.
 *
 * A consumer uses BOTH halves: parse with `apiErrorSchema`, which accepts ANY code including one this build has
 * never heard of, then `foodErrorSchema.safeParse` to NARROW. Failure means "map by HTTP status alone", the
 * correct degradation for a service deployed ahead of a released mobile binary.
 *
 * `details` is REQUIRED on every arm whose code promises one, so a body that dropped `details.id` fails the
 * typed parse at the edge that names the field rather than handing a caller an `undefined` that surfaces three
 * layers deeper. Every arm is `.loose()`: an unknown key added by a forward-compatible deploy must survive
 * rather than turn into a consumer-side parse crash.
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
                    id: z.string(),
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

export type FoodError = z.infer<typeof foodErrorSchema>;
