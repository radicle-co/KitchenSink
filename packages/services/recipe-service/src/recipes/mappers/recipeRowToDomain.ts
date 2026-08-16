/**
 * S-R4 — the canonical row→domain **Data Mapper** (Fowler): `recipeRowToDomain` maps a persisted
 * `recipes` row to the shared `@kitchensink/recipe-core` `Recipe`, in ONE place.
 *
 * Before this module existed, the SAME field rules — `description ?? ''`, the three time columns'
 * `?? 0` fallback, the derived `usesPremiumCapability`, the null-omit rules for `difficulty` /
 * `averageRating` / `leadCaloriesPerServing` / `authorHandle` / `sourceUrl` / `sourceAttribution` /
 * `clonedFromId` / `cuisine` / `deletedAt`, and the `Date | string → ISO` coercion — were independently
 * re-encoded in THREE places, free to drift:
 *
 *   - `collections/collections.service.ts#toRecipe` now calls this directly — its Drizzle `RecipeRow`
 *     input satisfies {@link RecipeRowInput} structurally, no adapter needed.
 *   - `search/dal/search.dal.ts#rowToRecipe` normalizes its RAW snake_case CTE row (FTS/rank stay raw —
 *     the CTE is deliberately never forced through `getTableColumns`) into a {@link RecipeRowInput} and
 *     delegates here, then layers the search-only `coverPhotoUrl` (resolved from the cover LATERAL's
 *     key) on top.
 *   - `recipes/recipes.service.ts#toRecipeResponse` builds the `RecipeResponse` superset
 *     (ingredients/steps/photos/nutrition/viewerRating/coverPhotoUrl) ON TOP of this mapper's base
 *     fields — EXCEPT `description`: `RecipeResponse.description` is genuinely a different wire rule
 *     (optional, OMITTED when unset) from `Recipe.description` (required, `''` default). That is a
 *     look-alike, not a duplicate — per DRY, two rules that change for different reasons must not be
 *     merged — so `toRecipeResponse` keeps its own `description` handling rather than taking this
 *     mapper's.
 *
 * Pure: no I/O, no mutation, no external calls — a straight structural translation.
 */
import { usesPremiumCapability } from '@kitchensink/recipe-core';
import type {
    Recipe,
    RecipeDifficulty,
    RecipeSourceType,
    RecipeStatus,
    RecipeVisibility,
} from '@kitchensink/recipe-core';

/**
 * The minimal, structural shape {@link recipeRowToDomain} needs from a `recipes` row. Drizzle's inferred
 * `RecipeRow` (`../../database/schema/recipes.js`) satisfies this directly (structural typing — its extra
 * fields, e.g. `ingredientNamesText`/`searchVector`, are simply ignored). The search DAL's raw snake_case
 * CTE row is cheaply normalized into this shape (see `search.dal.ts`'s row adapter) rather than being
 * forced through `getTableColumns`, which would break the hand-written FTS CTE.
 *
 * Date fields accept `Date | string` — not just `Date` — so BOTH a real Drizzle/pg row (always a `Date`)
 * and an adapted raw row (which some tests construct with an ISO string) satisfy the same input type
 * without a lossy re-encode.
 */
export interface RecipeRowInput {
    id: string;
    ownerId: string;
    title: string;
    description: string | null;
    prepTimeMinutes: number | null;
    cookTimeMinutes: number | null;
    totalTimeMinutes: number | null;
    servings: number;
    difficulty: string | null;
    visibility: string;
    status: string;
    sourceType: string;
    sourceUrl: string | null;
    sourceAttribution: string | null;
    clonedFromId: string | null;
    hasSubstantiveEdit: boolean;
    cuisine: string | null;
    dietaryFlags: string[];
    tags: string[];
    authorHandle: string | null;
    currentVersion: number;
    averageRating: string | null;
    ratingCount: number;
    deletedAt: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
}

/** Normalize a `timestamptz` (a `Date` from pg, or an ISO string) to an ISO-8601 string. Pure. */
function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Map a persisted `recipes` row to the canonical `Recipe` domain shape — the single authoritative
 * row→domain Data Mapper (S-R4).
 *
 * Nulls are OMITTED (never a fabricated default) for every genuinely optional `Recipe` field
 * (`difficulty`, `averageRating`, `leadCaloriesPerServing`, `authorHandle`, `sourceUrl`,
 * `sourceAttribution`, `clonedFromId`, `cuisine`, `deletedAt`). `description` and the three time columns
 * fall back (`?? ''` / `?? 0`) because `Recipe` requires them non-null — the time fallback is inert in
 * practice (the columns are `NOT NULL` in the schema) but preserved verbatim from the original mappers.
 * `usesPremiumCapability` is derived via the ONE authoritative `recipe-core` rule — never re-implemented
 * here.
 *
 * @param row - The normalized row (a Drizzle `RecipeRow`, or an adapted raw row satisfying the same
 *   structural shape).
 * @param derived - The nutrition figure that is no longer STORED (plan U10): computed from food's live data
 *   rather than read from a column that froze at its last write. An EMPTY object is the honest input from a
 *   path that did not look nutrition up at all (list, search, the collection embed) — it produces a recipe
 *   with no nutrition fields, which is exactly what "we have not accounted for this" looks like on a
 *   projection. The figures themselves come from `POST /api/v1/recipes/nutrition-batch`.
 */
/**
 * The nutrition figure U10 stopped storing. Supplied by the caller, which knows the recipe's lines.
 *
 * ⛔ `hasPartialNutrition` USED TO LIVE HERE and is deliberately gone. It was a two-valued encoding of a
 * three-valued fact, and three call sites pinned it `true` to mean "not looked up" — a meaning its own
 * docstring did not carry. The discriminated `recipeNutritionStateSchema` union carries that fact now, with
 * a discriminant, so there is nothing left for this mapper to assert or to fabricate.
 */
export interface DerivedNutritionFields {
    /** Headline per-serving calories; ABSENT (never `0`) when the recipe has no accounted nutrition. */
    readonly leadCaloriesPerServing?: number;
}

export function recipeRowToDomain(row: RecipeRowInput, derived: DerivedNutritionFields = {}): Recipe {
    const visibility = row.visibility as RecipeVisibility;
    const sourceType = row.sourceType as RecipeSourceType;

    const recipe: Recipe = {
        id: row.id,
        ownerId: row.ownerId,
        title: row.title,
        description: row.description ?? '',
        prepTimeMinutes: row.prepTimeMinutes ?? 0,
        cookTimeMinutes: row.cookTimeMinutes ?? 0,
        totalTimeMinutes: row.totalTimeMinutes ?? 0,
        servings: row.servings,
        visibility,
        status: row.status as RecipeStatus,
        sourceType,
        hasSubstantiveEdit: row.hasSubstantiveEdit,
        dietaryFlags: row.dietaryFlags,
        tags: row.tags,
        ...(derived.leadCaloriesPerServing !== undefined
            ? { leadCaloriesPerServing: derived.leadCaloriesPerServing }
            : {}),
        currentVersion: row.currentVersion,
        ratingCount: row.ratingCount,
        usesPremiumCapability: usesPremiumCapability({ visibility, sourceType }),
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
    };

    return {
        ...recipe,
        ...(row.difficulty !== null ? { difficulty: row.difficulty as RecipeDifficulty } : {}),
        // Trigger-maintained aggregate: numeric average is a string|null from pg; OMITTED (not 0) when unrated.
        ...(row.averageRating !== null ? { averageRating: Number(row.averageRating) } : {}),
        // Denormalized headline per-serving calories — OMITTED when NULL (no accounted nutrition), never 0.
        ...(row.authorHandle !== null ? { authorHandle: row.authorHandle } : {}),
        ...(row.sourceUrl !== null ? { sourceUrl: row.sourceUrl } : {}),
        ...(row.sourceAttribution !== null ? { sourceAttribution: row.sourceAttribution } : {}),
        ...(row.clonedFromId !== null ? { clonedFromId: row.clonedFromId } : {}),
        ...(row.cuisine !== null ? { cuisine: row.cuisine } : {}),
        ...(row.deletedAt !== null ? { deletedAt: toIsoString(row.deletedAt) } : {}),
    };
}
