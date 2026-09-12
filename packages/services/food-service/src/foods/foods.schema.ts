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
 * errored past the five-attempt retry budget · `WITHDRAWN` the AUTHOR deleted their own food and the row is
 * RETAINED so a reader can be told what was removed (0016; owner rulings 5 + 6, 2026-09-07).
 */
export const foodStatusSchema = z.enum([
    'PENDING',
    'UNRESOLVED',
    'RESOLVED',
    'NOT_FOUND',
    'FAILED',
    'AWAITING_RETRY',
    'WITHDRAWN',
]);

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

/**
 * The status a WITHDRAWN food answers `200` with — the partition's fourth arm.
 *
 * ⛔ ITS OWN ARM, and folding it into {@link terminalFoodStatusSchema} to make the partition test pass is
 * the change to refuse. Terminal means `404`: the row would be unreadable, and then nothing could tell a
 * cook which of their ingredient lines lost its food — which is the entire reason the row is retained
 * rather than deleted (owner ruling 5). `getStatus` answers `200 { id, status: 'WITHDRAWN' }` with no
 * `food` body, and that absence IS ruling 6 — a withdrawn food publishes no macros.
 */
export const withdrawnFoodStatusSchema = z.enum(['WITHDRAWN']);

export type WithdrawnFoodStatus = z.infer<typeof withdrawnFoodStatusSchema>;

/**
 * The statuses a CATALOG (`user_id IS NULL`) food can report — everything but `WITHDRAWN`.
 *
 * ⛔ Only an AUTHORED food can be withdrawn, and it is unreachable on a catalog row in BOTH directions:
 * the write path is gated on `evaluateAuthorship`, which answers `not-editable` for any pipeline row, and
 * the read path behind add-by-name dedups on `WHERE normalized_name = … AND user_id IS NULL`. So the add
 * and batch-add responses narrow to this, which makes the case UNREPRESENTABLE at recipe-service's
 * translation seam rather than leaving a branch there that nothing can execute. Same repair
 * {@link pendingResponseSchema} and {@link resolveResponseSchema} already carry; a response narrowing
 * cannot break a shipped client.
 */
export const catalogFoodStatusSchema = foodStatusSchema.exclude(['WITHDRAWN']);

export type CatalogFoodStatus = z.infer<typeof catalogFoodStatusSchema>;

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
    /**
     * Curated U8 S6: on a ROOT entry of the catalog batch only — whether the root has a live variant, so a recipe
     * read learns it from the batch it already caches. Absent on a variant entry and on the authored batch.
     */
    hasLiveVariants: z.boolean().optional(),
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

/**
 * Every variant attribute, in contract order (plan KTD-7, naming rule 24). A variant's parts arrive in this order,
 * and a reader that groups a root's variants walks it (the details dialog, curated U14).
 *
 * ⛔ An ORDER, not a validator: `attribute` stays an open string on the wire (KTD-15). A reader built against an
 * older copy cannot group by an attribute missing here, and still shows its text. A new attribute goes
 * `BEFORE 'origin'`, so origin stays last.
 */
export const VARIANT_ATTRIBUTES = [
    'cut',
    'bone',
    'skin',
    'formOrVariety',
    'babyFoodStage',
    'pack',
    'fat',
    'trim',
    'grade',
    'cookingMethod',
    'salt',
    'sugar',
    'addedNutrients',
    'brand',
    'origin',
] as const;

/**
 * One part of a variant's label (curated plan KTD-15): which attribute it states, and the words.
 *
 * ⛔ `attribute` is an OPEN string on the wire. The closed enum stays in the seed format; a reader that meets an
 * attribute it does not know still parses the variant and shows the text.
 */
export const variantPartViewSchema = z.object({
    /** The attribute the part states (e.g. `cut`, `cookingMethod`). */
    attribute: z.string().min(1),
    /** The part's words (e.g. `flat`). */
    text: z.string().min(1),
});

export type VariantPartView = z.infer<typeof variantPartViewSchema>;

/**
 * A live variant of a root (curated plan U8, R17). A variant has no lifecycle state on the wire (ADR-0050 §1).
 */
export const variantViewSchema = z.object({
    /** The variant's id, in the same id namespace as a root's. */
    id: z.string(),
    /** The label's parts, in contract order; never empty, since a variant is what its parts say. */
    parts: z.array(variantPartViewSchema).min(1),
    /** The variant's own calories per 100 g (KTD-21). Absent when its nutrition states no energy, never 0. */
    caloriesPer100g: z.number().finite().optional(),
});

export type VariantView = z.infer<typeof variantViewSchema>;

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
     * U10 (Q3c): present ONLY for a user-authored food, and then always `private` — an authored food is
     * AUTHOR-ONLY (ADR-0036), so there is no second value a client could branch on. Absent for a catalog
     * row (never `'public'` on the wire: catalog visibility is not a fact a client branches on, and
     * publishing it would invite exactly that).
     */
    visibility: z.literal('private').optional(),
    /**
     * Curated U8 (R17): the root's LIVE variants, in the order the variant picker lists them. `[]` for a root with
     * none and for an authored food, which never has any.
     */
    variants: z.array(variantViewSchema),
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
    /**
     * U11 (R20): present ONLY on the CALLER's own authored hits, and then always `private`. A stranger
     * never receives the row at all, so this never describes anyone else's food; the recipe side's
     * lexical tier reads it to flag an author-augmented shortlist out of the shared band statistics.
     */
    visibility: z.literal('private').optional(),
    /**
     * Curated U8 (R15, R16): the one live variant the query names, when exactly one does. The hit's id, name and
     * macros still describe the ROOT.
     */
    variant: variantViewSchema.optional(),
});

export type SearchResultView = z.infer<typeof searchResultViewSchema>;

/** Body for `GET /api/v1/foods/search` (FR-008). */
export const searchResponseSchema = z.object({
    /** Ranked results, or an empty array on no local match (never a source call). */
    results: z.array(searchResultViewSchema),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;

/**
 * A hit on the SHARED catalog search, `GET /api/v1/foods/catalog/search` (plan 002 R40, S3).
 *
 * The edge shares one response for a URL across every caller (ADR-0020), so nothing here may depend on who asked:
 * no `visibility` (every hit is a catalog root), no macros (the opt-in enrichment is the per-caller `/search`'s). An
 * unknown key is stripped rather than passed on, so a client cannot learn "private" from a catalog body.
 */
export const catalogSearchResultViewSchema = searchResultViewSchema.pick({
    id: true,
    name: true,
    score: true,
    variant: true,
});

export type CatalogSearchResultView = z.infer<typeof catalogSearchResultViewSchema>;

/** Body for `GET /api/v1/foods/catalog/search`: catalog roots ranked by text match, possibly empty. */
export const catalogSearchResponseSchema = z.object({
    results: z.array(catalogSearchResultViewSchema),
});

export type CatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>;

/**
 * A hit on the PER-CALLER authored search, `GET /api/v1/foods/authored/search` (plan 002 R40, S3): one of the
 * caller's own authored foods. The route that returned it is what makes it the cook's own (`docs/design/
 * rowEditorOpenDecisions.md`, "S5 list contract", L1), so the hit says nothing about visibility. Its `score` is the
 * catalog search's sort key.
 */
export const authoredFoodSearchResultViewSchema = searchResultViewSchema.pick({ id: true, name: true, score: true });

export type AuthoredFoodSearchResultView = z.infer<typeof authoredFoodSearchResultViewSchema>;

/** Body for `GET /api/v1/foods/authored/search`: the caller's own authored foods, possibly empty. */
export const authoredFoodSearchResponseSchema = z.object({
    results: z.array(authoredFoodSearchResultViewSchema),
});

export type AuthoredFoodSearchResponse = z.infer<typeof authoredFoodSearchResponseSchema>;

/**
 * The longest reference food issues for a remote hit (ADR-0055 point 10). A sealed reference to one item is well under
 * it; the bound keeps the adopt command from decrypting an unbounded body.
 */
export const MAX_REMOTE_REFERENCE_LENGTH = 4_096;

/**
 * Body for `POST /api/v1/foods/remote/adopt`: pick a remote hit by the reference food issued with it (ADR-0055 point
 * 10). The reference is opaque to the app, which sends it back unread; the source's own key never crosses the wire.
 */
export const adoptRemoteFoodRequestSchema = z.strictObject({
    reference: z.string().min(1).max(MAX_REMOTE_REFERENCE_LENGTH),
});

export type AdoptRemoteFoodRequest = z.infer<typeof adoptRemoteFoodRequestSchema>;

/**
 * Answer of `POST /api/v1/foods/remote/adopt`: the catalog root the remote food now is, either the new root the pick
 * made or the one that already stood for it. The app commits it as it commits any catalog pick.
 */
export const adoptRemoteFoodResponseSchema = z.object({
    id: z.string(),
});

export type AdoptRemoteFoodResponse = z.infer<typeof adoptRemoteFoodResponseSchema>;

/** Body for `POST /api/v1/foods` and `POST /api/v1/foods/{id}/refetch` (`202 Accepted`, FR-005/FR-039). */
export const addResponseSchema = z.object({
    id: z.string(),
    /**
     * The lifecycle status after the add (`PENDING` on a fresh add / reactivation).
     *
     * ⛔ {@link catalogFoodStatusSchema}, not the full lifecycle: add-by-name dedups on `user_id IS NULL`,
     * so this route can only ever answer about a CATALOG row, and a catalog row cannot be `WITHDRAWN`.
     */
    status: catalogFoodStatusSchema,
    /** Best-effort seconds until availability, when enqueued. */
    estimatedWaitSeconds: z.number().optional(),
});

export type AddResponse = z.infer<typeof addResponseSchema>;

/** A single item in a batch add response (FR-045). */
export const batchItemViewSchema = z.object({
    id: z.string(),
    /** `RESOLVED` for an inline hit, else `PENDING`. Catalog-only, like {@link addResponseSchema}. */
    status: catalogFoodStatusSchema,
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

/**
 * The most candidates one resolve may pick: one (owner ruling, 2026-10-02), because every screen sends one and each
 * pick calls the source against its shared window (security review C2). The recipe service's own resolve route
 * derives its bound from this one.
 */
export const MAX_RESOLVE_CANDIDATE_IDS = 1;

/** Request body for `PATCH /api/v1/foods/{id}` — resolve from the user's candidate pick (FR-RES-2, DSN-14). */
export const resolveFoodRequestSchema = z.strictObject({
    /**
     * The picked candidate row ids: at least one, at most {@link MAX_RESOLVE_CANDIDATE_IDS}. Membership in the food's
     * own set is checked server-side.
     */
    candidateIds: z.array(z.string()).min(1).max(MAX_RESOLVE_CANDIDATE_IDS),
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
/**
 * Response of `POST /api/v1/foods/{id}/corroborated` (plan U19, R10): the food's status AFTER the
 * trigger — `RESOLVED` when a PENDING food completed, the unchanged current status on the no-op paths.
 */
export const corroboratedResponseSchema = z.object({
    /** The food id. */
    id: z.string(),
    /** The (possibly unchanged) lifecycle status. */
    status: foodStatusSchema,
});

export type CorroboratedResponse = z.infer<typeof corroboratedResponseSchema>;

// ── The reference resolver (curated plan U8, roots slice; KTD-15) ────────────────────────────────

/**
 * The most refs one `POST /api/v1/foods/refs/resolve` may name — the same bound as
 * {@link MAX_NUTRITION_IDS}, for the same reason: without one a single request is an unbounded read.
 *
 * ⚠️ Stated in the CONTRACT (unlike the add-by-name batch cap) because it is fixed, not configured: a client
 * chunks against it, and `@kitchensink/food-service-client` refuses an over-cap list before sending it.
 */
export const MAX_FOOD_REFS = 100;

/**
 * Longest id a ref may carry. A root id is a 26-character ULID today; the bound is wider so a curated variant
 * or forwarded id (curated U8) widens the resolver ADDITIVELY rather than by loosening a published limit.
 */
export const MAX_FOOD_REF_ID_LENGTH = 64;

/**
 * What a ref names: a ROOT food (a `food` row) or one of its VARIANTS (curated U8).
 *
 * A `variant` ref is answered from the variant's own row, under its root (curated U8 S5).
 */
export const foodRefKindSchema = z.enum(['root', 'variant']);

export type FoodRefKind = z.infer<typeof foodRefKindSchema>;

/**
 * One reference to a food, as a recipe line binds it.
 *
 * `z.strictObject`: this is a REQUEST shape, and an unknown key is refused rather than stripped (the owner's
 * ruling for every request body here) — a caller sending `ownerId` must not be told it was accepted.
 */
export const foodRefSchema = z.strictObject({
    kind: foodRefKindSchema,
    id: z.string().min(1).max(MAX_FOOD_REF_ID_LENGTH),
});

export type FoodRef = z.infer<typeof foodRefSchema>;

/**
 * The ref as the RESPONSE echoes it — {@link foodRefSchema}'s own shape, minus the strictness.
 *
 * ⛔ Derived from the request shape, never restated. It is OPEN on purpose: an older client parses this, and
 * a server that later echoes a widened ref (KTD-15 widens the resolver additively) must not crash it.
 */
const foodRefViewSchema = z.object(foodRefSchema.shape);

/**
 * Request body for `POST /api/v1/foods/refs/resolve`.
 *
 * Duplicates are ACCEPTED: the answer carries one entry per DISTINCT ref, so repeating a ref costs a caller
 * nothing and refusing it would make every caller de-duplicate first.
 */
export const resolveFoodRefsRequestSchema = z.strictObject({
    refs: z.array(foodRefSchema).min(1).max(MAX_FOOD_REFS),
});

export type ResolveFoodRefsRequest = z.infer<typeof resolveFoodRefsRequestSchema>;

/**
 * One ref's answer, discriminated on `outcome`.
 *
 * - **`found`** — the caller may read this food. `name` is its current name (nullable, like
 *   {@link foodResponseSchema}'s), `status` its lifecycle — including `WITHDRAWN`, so a reader can be told which
 *   line lost its food (owner ruling 5). `visibility: 'private'` appears ONLY when the food is stored private,
 *   which the authorship policy lets through to its AUTHOR alone — so on this wire it means "the caller authored
 *   it". A catalog or promoted food carries no `visibility` at all.
 * - **`absent`** — nothing the caller may learn. An unknown id, a food mid-erasure, a retired entry whose forward
 *   never reaches one that answers, and ANOTHER USER'S PRIVATE FOOD all answer this identical entry, so the resolver
 *   cannot be used to probe whether a private food exists — the same concealment `GET /{id}` gives with its 404.
 *
 * A catalog root or variant the seed retired with no successor still answers `found`, as itself (curated U9, R29;
 * ADR-0050 §4): a recipe line bound to it keeps its name, parts and numbers. Only catalog rows are retired, so this
 * conceals nothing. The wire carries no retired marker (ADR-0050 §1): a reader learns a variant is retired from its id
 * missing from its root's live `variants` (`GET /{id}`).
 */
export const foodRefEntrySchema = z.discriminatedUnion('outcome', [
    z.object({
        outcome: z.literal('found'),
        ref: foodRefViewSchema,
        /** The TARGET root's name: the root itself, a variant's root, or the root a forward ends at. */
        name: z.string().nullable(),
        /** The target root's lifecycle. */
        status: foodStatusSchema,
        visibility: z.literal('private').optional(),
        /** Curated U8: present when the target is a variant — its root and its label's parts. */
        variant: z
            .object({
                rootId: z.string(),
                parts: z.array(variantPartViewSchema).min(1),
            })
            .optional(),
        /**
         * Curated U8 (ADR-0050 §4): present when the ref was retired and forwarded, naming the entry its forward ends at
         * — a live one, or one the seed later retired with no successor (R29).
         */
        forwardedTo: foodRefViewSchema.optional(),
    }),
    z.object({
        outcome: z.literal('absent'),
        ref: foodRefViewSchema,
    }),
]);

export type FoodRefEntry = z.infer<typeof foodRefEntrySchema>;

/**
 * Body for `POST /api/v1/foods/refs/resolve`: one entry per DISTINCT ref (same `kind` and `id`), in the order
 * each first appears in the request.
 *
 * ⛔ PER CALLER, and so never under `/nutrition*` — ADR-0020's edge cache keys that prefix on the URL alone.
 * The route answers `Cache-Control: private, no-store`.
 */
export const resolveFoodRefsResponseSchema = z.object({
    entries: z.array(foodRefEntrySchema),
});

export type ResolveFoodRefsResponse = z.infer<typeof resolveFoodRefsResponseSchema>;

// ── Authored foods (plan U10, D8/D9a — owner rulings 2026-08-30 Q3a-c) ───────────────────────────

/** Longest authored-portion label; matches what the catalog's own portion labels run to. */
export const MAX_AUTHORED_PORTION_LABEL = 80;

/** Most portions one authored food may declare. */
export const MAX_AUTHORED_PORTIONS = 10;

/**
 * The macros an authored food declares, PER 100g (Q3a: macros-only at launch; feature 009 owns the
 * additive expansion to full nutrient rows). Bounds are physical sanity, not nutrition science: no macro
 * gram figure can exceed 100 in 100g, and energy tops out below 900 kcal/100g (pure fat).
 */
export const authoredMacrosSchema = z.strictObject({
    /** Energy, kcal per 100g. */
    calories: z.number().min(0).max(900),
    /** Protein, g per 100g. */
    proteinG: z.number().min(0).max(100),
    /** Carbohydrate, g per 100g. */
    carbsG: z.number().min(0).max(100),
    /** Total fat, g per 100g. */
    fatG: z.number().min(0).max(100),
});

export type AuthoredMacros = z.infer<typeof authoredMacrosSchema>;

/** One household-measure portion an authored food declares. */
export const authoredPortionInputSchema = z.strictObject({
    /** The household label (`1 cup`, `1 scoop`). */
    label: z.string().max(MAX_AUTHORED_PORTION_LABEL).trim().min(1),
    /** What that portion weighs, in grams. */
    gramWeight: z.number().positive().max(10_000),
});

export type AuthoredPortionInput = z.infer<typeof authoredPortionInputSchema>;

/**
 * Body of `POST /api/v1/foods/authored` (D9a: the sibling CREATE door — walking through it IS the
 * provenance; there is deliberately NO `source` field, and no field here ever will say who wrote it).
 */
export const createAuthoredFoodRequestSchema = z.strictObject({
    /** Display name. Normalized server-side for the per-author dedup key. */
    name: z.string().max(MAX_FOOD_NAME_LENGTH).trim().min(1),
    /** Optional free-text description. */
    description: z.string().max(2_000).trim().min(1).optional(),
    /** The per-100g macros (Q3a). */
    macros: authoredMacrosSchema,
    /** Optional household portions. */
    portions: z.array(authoredPortionInputSchema).max(MAX_AUTHORED_PORTIONS).optional(),
});

export type CreateAuthoredFoodRequest = z.infer<typeof createAuthoredFoodRequestSchema>;

/**
 * Body of `PUT /api/v1/foods/{id}` — a FULL replacement, same shape as create (the owner ruling: "the
 * author may edit EVERYTHING in a food they own"). PUT rather than PATCH so absence means removal, not
 * "keep" — one semantics, no merge table.
 */
export const updateAuthoredFoodRequestSchema = createAuthoredFoodRequestSchema;

export type UpdateAuthoredFoodRequest = z.infer<typeof updateAuthoredFoodRequestSchema>;

/**
 * `200` body of `POST /api/v1/foods/authored/test-purge` — a TEST PRINCIPAL's self-purge of its own authored foods
 * (ADR-0040, food half).
 *
 * ⛔ A FIXTURE DOOR, NOT A PRODUCT SURFACE. Only a caller whose verified token carries
 * `public_metadata.testPrincipal === true` may use it; every other caller receives the `404` this service answers
 * for a path it does not route. There is no request body: the principal is the token, and it purges only itself.
 * The purge is synchronous and repeatable.
 */
export const authoredFoodTestPurgeResponseSchema = z.object({
    /** The caller's PRIVATE authored foods hard-deleted, withdrawn ones included (0 on a repeat run). */
    deletedAuthoredFoods: z.number().int().nonnegative(),
    /** The caller's PROMOTED authored foods kept, because other cooks may already depend on them. */
    retainedPromotedFoods: z.number().int().nonnegative(),
});

export type AuthoredFoodTestPurgeResponse = z.infer<typeof authoredFoodTestPurgeResponseSchema>;

/**
 * A search term that is not blank and holds no NUL byte, tested on the RAW term. Postgres `text` cannot hold a NUL
 * (`22021`), so a term carrying one would fail in the database (sec-aud-1 S3 review, F3).
 *
 * ONE pattern for both rules, because `@kitchensink/contract-gen` publishes one `pattern` per string and refuses a
 * post-trim `min` beside a pattern of the schema's own. The blank rule is therefore here, not in a `.min(1)` after the
 * trim: at least one character that is neither whitespace (the set `.trim()` strips) nor NUL. The leading `\s*` cannot
 * overlap the next class, so matching stays linear in the term's length.
 */
// eslint-disable-next-line no-control-regex -- NUL is the subject: Postgres `text` cannot hold it (22021).
const NON_BLANK_WITHOUT_NUL = /^\s*[^\s\0][^\0]*$/;

export const searchFoodQuerySchema = z.strictObject({
    query: z.string().max(MAX_FOOD_NAME_LENGTH).regex(NON_BLANK_WITHOUT_NUL).trim(),
    /** Opt-in per-100g macro enrichment (plan U4b). A query param, so the value is the string 'true'. */
    withNutrition: z.literal('true').optional(),
});

export type SearchFoodQuery = z.infer<typeof searchFoodQuerySchema>;

/**
 * Every whitespace run, Unicode spaces included, for {@link searchTermQuerySchema}'s collapse. `\s` with the `u` flag
 * is ES2015, so Hermes reads it as V8 does.
 */
const WHITESPACE_RUN = /\s+/gu;

/**
 * Query of the two split search routes, `GET /api/v1/foods/catalog/search` and `/authored/search` (plan 002 S3).
 *
 * STRICT and query-only: no parameter switches the shared route to per-caller behaviour (property 3), and an unknown
 * one is refused rather than keying a second edge-cache entry for the same answer.
 *
 * CANONICAL: trimmed, inner whitespace collapsed to one space, lowercased. The client parses its input with this schema
 * and builds the URL from the result, so one search is one URL and one shared cache entry (ADR-0020). Every branch of
 * the search reads the term case-insensitively, so the canonical form returns what the raw one would.
 *
 * The bound and {@link NON_BLANK_WITHOUT_NUL} are on the RAW term, before the trim, as the published document states
 * them (`@kitchensink/contract-gen` refuses a `maxLength` after a trim). ⚠️ So parsing is idempotent only while the
 * canonical form fits the bound, and one character breaks that: `İ` lowercases to two code units. The client therefore
 * re-parses its canonical form before sending it, so it never sends a term the service refuses.
 *
 * The search MINIMUM is not here: it is a service rule (003-FR-010a), and a short term answers an empty `200`.
 */
export const searchTermQuerySchema = z.strictObject({
    query: z
        .string()
        .max(MAX_FOOD_NAME_LENGTH)
        .regex(NON_BLANK_WITHOUT_NUL)
        .trim()
        .overwrite((value) => value.replace(WHITESPACE_RUN, ' '))
        .toLowerCase(),
});

export type SearchTermQuery = z.infer<typeof searchTermQuerySchema>;

/**
 * Whether a term is already its own canonical form: it parses, and parses to itself. The only term food sends the
 * remote search service, which refuses any other, so one search is one cache key there (ADR-0055 ruling 6). The
 * `İ` case above is the one way a parsed term fails it. Pure.
 *
 * @param term - The term.
 * @returns True when the term is canonical.
 */
export function isCanonicalSearchTerm(term: string): boolean {
    const parsed = searchTermQuerySchema.safeParse({ query: term });

    return parsed.success && parsed.data.query === term;
}

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
    /**
     * An operator cannot queue this food (`409`): a requeue of a food that is not blackholed (U9), or a refetch of a
     * food that is withdrawn or that the seed owns.
     */
    'NOT_REQUEUEABLE',
    /** An edit/delete was attempted on a PIPELINE food — catalog rows have a single writer (`409`, U10/D8). */
    'NOT_EDITABLE',
    /** The caller already authored a food with this normalized name (`409`, U10/KTD-H's per-author unique). */
    'DUPLICATE_AUTHORED_NAME',
    /**
     * The source window is busy, a resolve's wait ran out, or the caller's source budget could not be read — a `503`
     * + `Retry-After`, never a `429`.
     */
    'FETCH_UNAVAILABLE',
    /**
     * This caller reached its own limit: the per-minute cap or the hourly source budget on resolve and the remote pick —
     * a `429` + `Retry-After`. Its own code so a client never reads a busy source as the cook's limit, or the reverse
     * (row editor item 10).
     */
    'REQUESTER_LIMIT_REACHED',
    /**
     * This caller reached its per-minute limit on the split food search (plan 002 S3, R42) — a `429` + `Retry-After`.
     * Its own code because the search makes no source call, so `REQUESTER_LIMIT_REACHED`'s sentence would be wrong.
     */
    'SEARCH_RATE_LIMITED',
    /**
     * A remote hit can no longer be picked (`409`, ADR-0055 point 10): our catalog retired its item with no forward,
     * the source no longer has it, or its reference is not one this service can open. Search again for a fresh answer.
     */
    'REMOTE_FOOD_GONE',
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
            code: z.literal('NOT_EDITABLE'),
            message: z.string(),
            /** The pipeline food a caller tried to edit — catalog rows have a single writer (U10/D8). */
            details: z.object({ id: z.string() }).loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('DUPLICATE_AUTHORED_NAME'),
            message: z.string(),
            /** The already-authored food the name collides with, so a client can offer "edit that one". */
            details: z.object({ existingId: z.string() }).loose(),
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
                     * The food's OBSERVED status, not the rejected target, because the operator's next move
                     * depends on where the food actually is.
                     */
                    status: foodStatusSchema,
                })
                .loose(),
        })
        .loose(),
    z.object({ code: z.literal('REMOTE_FOOD_GONE'), message: z.string() }).loose(),
    z
        .object({
            code: z.literal('FETCH_UNAVAILABLE'),
            message: z.string(),
            /** Also sent as the `Retry-After` header; repeated here so a body-only consumer can read it. */
            details: z.object({ retryAfterSeconds: z.number() }).loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('REQUESTER_LIMIT_REACHED'),
            message: z.string(),
            /** Whole seconds until the limit lets this caller in again, also sent as `Retry-After`. */
            details: z.object({ retryAfterSeconds: z.number().int().positive() }).loose(),
        })
        .loose(),
    z
        .object({
            code: z.literal('SEARCH_RATE_LIMITED'),
            message: z.string(),
            /** Whole seconds until the search limit lets this caller in again, also sent as `Retry-After`. */
            details: z.object({ retryAfterSeconds: z.number().int().positive() }).loose(),
        })
        .loose(),
    z.object({ code: z.literal('INTERNAL_ERROR'), message: z.string() }).loose(),
]);

export type FoodError = z.infer<typeof foodErrorSchema>;
