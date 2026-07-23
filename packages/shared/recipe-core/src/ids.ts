/**
 * @module @kitchensink/recipe-core/ids — branded id value objects (DA6).
 *
 * A bare `string` id lets a caller pass a `RecipeId` where a `UserId` is expected (and vice versa) and the
 * compiler stays silent — the exact class of bug this module exists to make unrepresentable. Each id here
 * is a Zod-branded nominal type: structurally still a `string` at runtime (so it serializes/logs/compares
 * exactly like one), but a DIFFERENT type at compile time, so `fn(userId('u'), recipeId('r'))` against a
 * `fn(id: RecipeId, owner: UserId)` signature is a compile error, not a silent transposition.
 *
 * Each id has a smart constructor (`recipeId`, `userId`, …) that PARSES + brands a raw string, throwing at
 * the boundary on an empty value, and a matching `is*Id` guard for narrowing an already-typed value. Pure —
 * the constructors throw on invalid input rather than perform any I/O.
 */
import { z } from 'zod';

const recipeIdSchema = z.string().min(1).brand<'RecipeId'>();
const userIdSchema = z.string().min(1).brand<'UserId'>();
const ingredientIdSchema = z.string().min(1).brand<'IngredientId'>();
const foodIdSchema = z.string().min(1).brand<'FoodId'>();
const s3KeySchema = z.string().min(1).brand<'S3Key'>();

/** A recipe's id, branded so it cannot be silently substituted for another entity's id. */
export type RecipeId = z.infer<typeof recipeIdSchema>;
/** An app-user's ULID, branded so it cannot be silently substituted for another entity's id. */
export type UserId = z.infer<typeof userIdSchema>;
/** An ingredient catalog id, branded so it cannot be silently substituted for another entity's id. */
export type IngredientId = z.infer<typeof ingredientIdSchema>;
/** A food-service id, branded so it cannot be silently substituted for another entity's id. */
export type FoodId = z.infer<typeof foodIdSchema>;
/** An S3 object key, branded so it cannot be silently substituted for another entity's id. */
export type S3Key = z.infer<typeof s3KeySchema>;

/**
 * Smart constructor for {@link RecipeId} — parses and brands a raw string, throwing at the boundary when it
 * is empty.
 *
 * @param raw - The raw recipe id string.
 * @returns The branded {@link RecipeId}.
 * @throws {z.ZodError} When `raw` is empty.
 */
export function recipeId(raw: string): RecipeId {
    return recipeIdSchema.parse(raw);
}

/**
 * Smart constructor for {@link UserId} — parses and brands a raw string, throwing at the boundary when it
 * is empty.
 *
 * @param raw - The raw app-user id string.
 * @returns The branded {@link UserId}.
 * @throws {z.ZodError} When `raw` is empty.
 */
export function userId(raw: string): UserId {
    return userIdSchema.parse(raw);
}

/**
 * Smart constructor for {@link IngredientId} — parses and brands a raw string, throwing at the boundary
 * when it is empty.
 *
 * @param raw - The raw ingredient id string.
 * @returns The branded {@link IngredientId}.
 * @throws {z.ZodError} When `raw` is empty.
 */
export function ingredientId(raw: string): IngredientId {
    return ingredientIdSchema.parse(raw);
}

/**
 * Smart constructor for {@link FoodId} — parses and brands a raw string, throwing at the boundary when it
 * is empty.
 *
 * @param raw - The raw food-service id string.
 * @returns The branded {@link FoodId}.
 * @throws {z.ZodError} When `raw` is empty.
 */
export function foodId(raw: string): FoodId {
    return foodIdSchema.parse(raw);
}

/**
 * Smart constructor for {@link S3Key} — parses and brands a raw string, throwing at the boundary when it is
 * empty.
 *
 * @param raw - The raw S3 object key string.
 * @returns The branded {@link S3Key}.
 * @throws {z.ZodError} When `raw` is empty.
 */
export function s3Key(raw: string): S3Key {
    return s3KeySchema.parse(raw);
}

/**
 * Type guard for {@link RecipeId}.
 *
 * @param value - The value to check.
 * @returns True when `value` is a non-empty string (a valid `RecipeId`).
 */
export const isRecipeId = (value: unknown): value is RecipeId => recipeIdSchema.safeParse(value).success;

/**
 * Type guard for {@link UserId}.
 *
 * @param value - The value to check.
 * @returns True when `value` is a non-empty string (a valid `UserId`).
 */
export const isUserId = (value: unknown): value is UserId => userIdSchema.safeParse(value).success;

/**
 * Type guard for {@link IngredientId}.
 *
 * @param value - The value to check.
 * @returns True when `value` is a non-empty string (a valid `IngredientId`).
 */
export const isIngredientId = (value: unknown): value is IngredientId => ingredientIdSchema.safeParse(value).success;

/**
 * Type guard for {@link FoodId}.
 *
 * @param value - The value to check.
 * @returns True when `value` is a non-empty string (a valid `FoodId`).
 */
export const isFoodId = (value: unknown): value is FoodId => foodIdSchema.safeParse(value).success;

/**
 * Type guard for {@link S3Key}.
 *
 * @param value - The value to check.
 * @returns True when `value` is a non-empty string (a valid `S3Key`).
 */
export const isS3Key = (value: unknown): value is S3Key => s3KeySchema.safeParse(value).success;
