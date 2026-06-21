/**
 * Runtime zod schemas validating USDA FoodData Central responses at the external-API boundary.
 *
 * The USDA API is untrusted: these schemas catch upstream shape drift the moment a body arrives,
 * so malformed/`undefined` data can never flow downstream into `@kitchensink/food-service`.
 *
 * These schemas model the **raw upstream wire shape** — the body as USDA sends it — NOT the
 * normalized {@link import('./types.js').UsdaFoodDetail} the client returns. The public type
 * carries a synthesized `raw` field and flattened nutrients produced by `UsdaApiClient.toFoodDetail`,
 * neither of which exists on the wire, so the validator and the public interface deliberately differ.
 * The client validates with these schemas first, then normalizes the validated body.
 *
 * Tolerance: USDA returns many fields we do not model. Every object schema uses `.passthrough()`
 * so unknown extra keys are preserved rather than rejected; only the fields the client actually
 * consumes are constrained.
 */
import { z } from 'zod';

/**
 * A single raw nutrient entry. USDA varies this shape by dataset: some records expose flat
 * `nutrientId`/`nutrientName`/`unitName`/`value`, others nest under `nutrient` and use `amount`.
 * Every field is optional because the client (`toFoodDetail`) tolerates and normalizes each
 * variant; we only assert the *types* of the fields we read, not their presence.
 */
export const RawUsdaNutrientSchema = z
    .object({
        nutrientId: z.number().optional(),
        nutrientName: z.string().optional(),
        unitName: z.string().optional(),
        value: z.number().optional(),
        amount: z.number().optional(),
        nutrient: z
            .object({
                id: z.number().optional(),
                name: z.string().optional(),
                unitName: z.string().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

/** Inferred raw-nutrient type, kept in lock-step with {@link RawUsdaNutrientSchema}. */
export type RawUsdaNutrient = z.infer<typeof RawUsdaNutrientSchema>;

/**
 * A raw food-detail object from `GET /v1/food/{fdcId}` and each element of `POST /v1/foods`.
 *
 * Required (the client depends on these): `fdcId` and `description`. `foodNutrients` defaults to
 * an empty array when absent so downstream nutrient extraction always has an array to map over.
 * Everything else is optional and only type-constrained.
 */
export const RawUsdaFoodSchema = z
    .object({
        fdcId: z.number(),
        description: z.string(),
        dataType: z.string().optional(),
        foodNutrients: z.array(RawUsdaNutrientSchema).default([]),
        brandOwner: z.string().optional(),
        brandName: z.string().optional(),
        gtinUpc: z.string().optional(),
        publicationDate: z.string().optional(),
    })
    .passthrough();

/** Inferred raw-food type, kept in lock-step with {@link RawUsdaFoodSchema}. */
export type RawUsdaFood = z.infer<typeof RawUsdaFoodSchema>;

/** The `POST /v1/foods` batch response: an array of raw food-detail objects. */
export const RawUsdaFoodArraySchema = z.array(RawUsdaFoodSchema);

/** Inferred batch-response type. */
export type RawUsdaFoodArray = z.infer<typeof RawUsdaFoodArraySchema>;

/**
 * A single raw search hit from `GET /v1/foods/search`. `fdcId` and `description` are required
 * (the client surfaces them directly); `dataType` is optional.
 */
export const RawUsdaSearchHitSchema = z
    .object({
        fdcId: z.number(),
        description: z.string(),
        dataType: z.string().optional(),
    })
    .passthrough();

/** Inferred search-hit type. */
export type RawUsdaSearchHit = z.infer<typeof RawUsdaSearchHitSchema>;

/**
 * The `GET /v1/foods/search` result envelope. `foods` defaults to `[]` and `totalHits` to `0`
 * when USDA omits them, matching the client's existing fallback behaviour.
 */
export const RawUsdaSearchResultSchema = z
    .object({
        foods: z.array(RawUsdaSearchHitSchema).default([]),
        totalHits: z.number().default(0),
    })
    .passthrough();

/** Inferred search-result type. */
export type RawUsdaSearchResult = z.infer<typeof RawUsdaSearchResultSchema>;

/**
 * Schema for a single detailed food record (`getFood` / each element of `getFoodsBatch`).
 * Alias of {@link RawUsdaFoodSchema} under the name the task references.
 */
export const UsdaFoodDetailSchema = RawUsdaFoodSchema;

/**
 * Schema for the `searchFoods` result envelope. Alias of {@link RawUsdaSearchResultSchema} under
 * the name the task references.
 */
export const UsdaSearchResultSchema = RawUsdaSearchResultSchema;
