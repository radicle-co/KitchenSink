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
 * `PENDING` a fetch is enqueued, never attempted · `AWAITING_RETRY` a real source failure occurred and a
 * retry is scheduled with backoff (U9) · `UNRESOLVED` awaiting a human disambiguation pick · `RESOLVED` a
 * golden record exists · `NOT_FOUND` no wired source has it (tombstoned until TTL) · `FAILED` every source
 * errored past the five-attempt retry budget.
 */
export const foodStatusSchema = z.enum(['PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED', 'AWAITING_RETRY']);

export type FoodStatus = z.infer<typeof foodStatusSchema>;

/**
 * The non-terminal statuses a `202` body can carry — `RESOLVED` would be a `200`, and the rest are `404`.
 *
 * `AWAITING_RETRY` belongs HERE, not with the terminal set: the food is still going to be attempted, so the
 * caller should keep polling exactly as it would for `PENDING`. Putting it in the terminal set would tell a
 * client to give up on a food the worker is about to retry.
 */
export const pendingFoodStatusSchema = z.enum(['PENDING', 'UNRESOLVED', 'AWAITING_RETRY']);

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

/**
 * A NORMALIZED portion in the batch-nutrition response — grams per ONE unit (KTD-3 / plan U8).
 *
 * Distinct from {@link portionViewSchema}, which is the RAW stored `{ label, gramWeight }`. Returning the
 * raw shape was what forced the recipe service to keep a heuristic interpreting food's data — the second
 * source of truth KTD-3 exists to delete. Food normalizes; consumers do not parse.
 */
export const normalizedPortionSchema = z.object({
    /** The measure unit, lower-cased and singularized (`cup`, `tablespoon`, `clove`). */
    unit: z.string(),
    /** Grams in ONE of that unit; strictly positive. */
    gramsPerUnit: z.number().positive(),
});

export type NormalizedPortion = z.infer<typeof normalizedPortionSchema>;

/**
 * One food's entry in the batch-nutrition response (plan U8).
 *
 * ⚠️ Every macro is OPTIONAL, and absence is meaningful: it means no nutrient row satisfied all three of
 * `basis === 'per_100g'`, the canonical name, and the canonical unit. It does NOT mean zero. A food whose
 * energy is published only `per_serving`, or only in `kJ`, reports absent rather than a coerced number —
 * see `nutrition/nutrientSelection.ts` for why coercing is how the 4.184× error class returns.
 */
export const foodNutritionSchema = z.object({
    /** The requested food id. */
    id: z.string(),
    /** The food's lifecycle status, so an unresolved id is REPORTED rather than silently omitted. */
    status: foodStatusSchema,
    /** Energy, kcal per 100 g. Absent when no qualifying row exists. */
    caloriesPer100g: z.number().optional(),
    /** Protein, g per 100 g. */
    proteinGPer100g: z.number().optional(),
    /** Carbohydrate, g per 100 g. */
    carbsGPer100g: z.number().optional(),
    /** Fat, g per 100 g. */
    fatGPer100g: z.number().optional(),
    /** Normalized household portions, de-duplicated by unit. Empty when none could be interpreted. */
    portions: z.array(normalizedPortionSchema),
});

export type FoodNutrition = z.infer<typeof foodNutritionSchema>;

/**
 * ## The `?ids=` canonicalization — CONTRACT, not parsing
 *
 * The URL **is** the cache key. ADR-0020 keys food's CloudFront distribution on the URL alone (sound only
 * because this response is caller-independent), so two callers asking for the same set of foods must
 * produce byte-identical URLs or the cache simply never hits. Order and duplicates are therefore not
 * cosmetic: `?ids=b,a` and `?ids=a,b` requesting the same data through two cache entries is the difference
 * between a CDN and an expensive proxy.
 *
 * It lives HERE, in the authored schema, rather than beside the controller, because it is the one rule the
 * SERVER and every CLIENT must agree on — and the contract generator copies this file into
 * `@kitchensink/schema-food`, so the client gets the rule itself instead of a second implementation of it.
 */

/**
 * The most ids one request may name.
 *
 * A cap is required, not defensive: without one an unauthenticated-shaped URL can name unbounded ids and
 * turn one request into an unbounded database read — the memory-exhaustion vector the findings review
 * flagged. It also bounds the URL, which CloudFront and the ALB both limit independently.
 */
export const MAX_NUTRITION_IDS = 100;

/** Raised when the caller's id list cannot produce a stable cache key. */
export class NutritionIdListError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'NutritionIdListError';
        Object.setPrototypeOf(this, NutritionIdListError.prototype);
    }
}

/** Type guard for {@link NutritionIdListError}. */
export function isNutritionIdListError(error: unknown): error is NutritionIdListError {
    return error instanceof NutritionIdListError;
}

/**
 * Parse and canonicalize the raw `ids` query value. Pure.
 *
 * Canonical means: split on commas, trimmed, empties dropped, **deduplicated**, **sorted**. The last two are
 * what make the URL a stable cache key regardless of how a client happened to order its request.
 *
 * @param raw - The raw `ids` query parameter.
 * @returns The canonical id list.
 * @throws {NutritionIdListError} When the list is empty or exceeds {@link MAX_NUTRITION_IDS}.
 */
export function canonicalizeNutritionIds(raw: string | undefined): string[] {
    const ids = (raw ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

    if (ids.length === 0) {
        throw new NutritionIdListError('ids must name at least one food id');
    }

    const unique = [...new Set(ids)].sort();

    if (unique.length > MAX_NUTRITION_IDS) {
        throw new NutritionIdListError(
            `ids names ${unique.length} distinct foods, which exceeds the ${MAX_NUTRITION_IDS} per-request cap`,
        );
    }

    return unique;
}

/**
 * The canonical query string for a set of ids — the exact cache key a client should request. Pure.
 *
 * Exported so a CLIENT can build the same URL the server considers canonical, rather than reimplementing
 * the ordering rule and drifting from it.
 *
 * @param ids - The ids to request.
 * @returns The canonical `ids=…` query-string fragment.
 * @throws {NutritionIdListError} Under the same conditions as {@link canonicalizeNutritionIds}.
 */
export function canonicalNutritionQuery(ids: readonly string[]): string {
    return `ids=${canonicalizeNutritionIds(ids.join(',')).join(',')}`;
}

/**
 * Query for `GET /api/v1/foods/nutrition` (plan U8).
 *
 * The list arrives as ONE comma-separated string rather than a repeated parameter, because the URL is the
 * cache key (ADR-0020) and a repeated parameter has no canonical serialization — `?ids=a&ids=b` and
 * `?ids=b&ids=a` are the same request through two cache entries. Ordering, de-duplication and the cap are
 * applied after this parse, in `nutrition/nutritionIdList.ts`; this schema's job is only to guarantee the
 * parameter is present and is a string, which is what §15.4(3) requires of every query.
 */
export const foodNutritionQuerySchema = z
    .object({
        /** Comma-separated food ids. Canonicalized (sorted, de-duplicated, capped) before use. */
        ids: z.string().min(1),
    })
    .strict();

export type FoodNutritionQuery = z.infer<typeof foodNutritionQuerySchema>;

/**
 * `GET /api/v1/foods/nutrition?ids=…` (plan U8).
 *
 * ⛔ **This response MUST NOT vary by caller.** ADR-0020 keys food's CloudFront distribution on the URL
 * alone, which is sound only while that holds. It is a standing invariant of this endpoint, not a one-time
 * test: adding anything caller-derived here would serve one user's response to another.
 */
export const foodNutritionBatchResponseSchema = z.object({
    /** One entry per requested id, in the canonical (sorted, de-duplicated) id order. */
    foods: z.array(foodNutritionSchema),
    /** Ids that name no food at all — reported, never silently dropped. */
    unknownIds: z.array(z.string()),
});

export type FoodNutritionBatchResponse = z.infer<typeof foodNutritionBatchResponseSchema>;

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
    /**
     * U5: the FNDDS consumption-prior fraction in [0, 1]. Absent when the food has no measured
     * consumption — absent means "no prior", never zero. Recipe-service CAPTURES this into its local
     * ingredients cache at admission/refresh time (ADR-0006 forbids a cross-database join).
     */
    priorFraction: z.number().min(0).max(1).optional(),
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
    /**
     * Per-100g macros, present only when the caller asked (`withNutrition=true`) AND the food has a
     * qualifying stored row — absent is "unknown", never zero (plan U4b: recipe-service's verification
     * gate compares candidates' nutrients before an identity skip can be earned).
     */
    caloriesPer100g: z.number().finite().optional(),
    proteinGPer100g: z.number().finite().optional(),
    carbsGPer100g: z.number().finite().optional(),
    fatGPer100g: z.number().finite().optional(),
});

export type SearchResultView = z.infer<typeof searchResultViewSchema>;

/** Body for `GET /api/v1/foods/search` (FR-008). */
export const searchResponseSchema = z.object({
    /** Ranked results, or an empty array on no local match (never a source call). */
    results: z.array(searchResultViewSchema),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;

/**
 * A single ON-DEMAND live-source hit (`GET /api/v1/foods/search/live`, plan U29).
 *
 * ⛔ It is NOT a {@link searchResultViewSchema}, and must not be merged into one. A local hit is a golden
 * record we hold: it always has an `id` and carries a relevance `score` from our own ranking. A live hit is
 * something a source just told us about: it may have no counterpart here at all, and the source's ordering is
 * the only ordering there is — a `score` field would have to be fabricated. Two shapes that differ in what
 * they can promise are not duplication.
 */
export const liveSearchResultViewSchema = z.object({
    /** The source's own description for the item. */
    name: z.string(),
    /**
     * Our internal food id, present ONLY when this hit is already crosswalked into our catalog. Its absence
     * means "not yet admitted", which is what tells a caller the pick costs an admission rather than being
     * free. ⛔ The source-native key (`fdcId`) is never on the wire (FR-IDN-2).
     */
    id: z.string().optional(),
});

export type LiveSearchResultView = z.infer<typeof liveSearchResultViewSchema>;

/**
 * Body for `GET /api/v1/foods/search/live` (plan U29).
 *
 * ⚠️ An EMPTY `results` is a SUCCESS — "the source has nothing for this" — and is deliberately distinct from
 * the `503` (busy / our lane exhausted) and the `502` (the source did not answer) this route can also return.
 * A cook who sees the first should stop looking; one who sees either other should try again. That is why a
 * below-minimum query is REJECTED here (`400`) rather than short-circuited to an empty page the way the local
 * `GET /api/v1/foods/search` is: an empty page would be indistinguishable from the first outcome.
 */
export const liveSearchResponseSchema = z.object({
    /** The source's hits, in the source's order, capped by the service. Empty = the source has nothing. */
    results: z.array(liveSearchResultViewSchema),
});

export type LiveSearchResponse = z.infer<typeof liveSearchResponseSchema>;

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
 * ⛔ **The FR-010a three-character minimum is NOT enforced here, and that is deliberate** (owner ruling
 * 2026-08-24, plan U37). A query of one or two characters is a well-formed request that answers `200` with
 * an EMPTY result set — never a `400`. FR-010a's words are that the system "returns no results and says so",
 * and the "says so" is the localized empty state both clients render; a `400` would force a debouncing
 * typeahead to model an ordinary keystroke as an error, and would make the boundary a wire-breaking change
 * every time the minimum is retuned. `FoodsService.search` short-circuits below the minimum WITHOUT issuing
 * the ranked statement or either crosswalk read — see `@kitchensink/recipe-core/resolution/search-minimum`,
 * which both clients read as well, so the number the cook is shown is the number the server enforces.
 *
 * ⚠️ Wildcards are NOT escaped here. `?query=%` built the `ILIKE` pattern `'%%%'`, which matches every row that
 * has a name; that is fixed at the point the pattern is BUILT (`toIlikePattern` in `dao/foodSearch.dao.ts`),
 * because escaping at validation time would corrupt the full-text and trigram branches, which receive the same
 * string as a VALUE and where a backslash is a character to match.
 */
export const searchFoodQuerySchema = z.strictObject({
    query: z.string().max(MAX_FOOD_NAME_LENGTH).trim().min(1),
    /** Opt-in per-100g macro enrichment (plan U4b). A query param, so the value is the string 'true'. */
    withNutrition: z.literal('true').optional(),
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
    /** An operator requeue was attempted on a food that is not blackholed — use `POST /{id}/refetch` (`409`, U9). */
    'NOT_REQUEUEABLE',
    /** Backpressure / flood-shed / resolve cap — a `503` + `Retry-After`, NEVER a per-user `429` (FR-046). */
    'FETCH_UNAVAILABLE',
    /** An upstream food-data source did not answer a live search — a `502`, distinct from our own `503` (U29). */
    'SOURCE_UNAVAILABLE',
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
            code: z.literal('NOT_REQUEUEABLE'),
            message: z.string(),
            details: z
                .object({
                    id: z.string(),
                    /**
                     * The status that makes the requeue inapplicable — the food's OBSERVED status, not the
                     * rejected target, because the operator's next move depends on where the food actually is.
                     */
                    status: foodStatusSchema,
                })
                .loose(),
        })
        .loose(),
    z.object({ code: z.literal('SOURCE_UNAVAILABLE'), message: z.string() }).loose(),
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
