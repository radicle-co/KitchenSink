/**
 * @module @commise/features-recipes/form — the recipe editor's EDITABLE DRAFT SHAPE, and its blank instance.
 *
 * ⛔ The draft is deliberately looser than the wire: an incoherent quantity, an unpicked ingredient and an
 * unstated difficulty are all legitimate states HERE and refused at the boundary. Parse, don't validate —
 * with the loose shape on the user's side of the parse. `wire.ts` owns the boundary; this module owns the
 * shape and depends on nothing else in the package.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) form
 * leaves and by the app container, so the two renders can never drift. No React, no platform APIs.
 */
import type {
    FoodResolutionStatus,
    RecipeDifficulty,
    RecipeMealType,
    RecipeVisibility,
    UnresolvedFoodReasonCode,
} from '@kitchensink/recipe-core';

import type { IngredientLineKey } from './lineKey.js';
import type { FoodNutritionRef } from './nutritionLookup.js';

/**
 * One editable ingredient line. `ingredientId` is `null` until the line resolves to a catalog row (via
 * food-service typeahead or a freeform create) — the wire contract REQUIRES an id, so an unresolved line
 * cannot be submitted (validation flags it). `resolutionStatus` drives the row's async nutrition badge.
 *
 * The line carries no catalog nutrition (plan 002 V1 B5): `foodRef` names the food, and the editor's one background
 * read supplies its figures. `userCalories`/`userProteinG`/`userCarbsG`/`userFatG` are the FR-007a per-line figures
 * the cook states; the aggregator decides when they count (`userStatedFiguresOf`, `./nutrition.ts`).
 */
export interface RecipeFormIngredient {
    /**
     * The line's identity in the draft (plan 002 V1): the React key of its row, and what the rebind command's stored
     * position is looked up by (`storedPositionOf`, `./lineKey.ts`). Seeded by `toRecipeFormValues`; for a line
     * added this session, minted at the edge by `mintLineKey` and carried on the append action. Never sent, never
     * edited.
     */
    readonly key: IngredientLineKey;
    readonly ingredientId: string | null;
    /**
     * The line's name as the detail read gave it, for display only — never sent (the server derives it from the
     * binding, plan 002 R9). ABSENT for a nameless line (`RESOLVED_UNAVAILABLE`, `FOOD_REMOVED`,
     * `FOOD_UNREACHABLE`); a row renders the stand-in from `lineDisplayName` (`../detail/lineName.ts`) instead.
     */
    readonly name?: string;
    /**
     * Whether this line is FREEFORM — a name the cook typed, never backed by a food.
     *
     * ⛔ It is what distinguishes "no resolution was ever looked up" from "a resolution was looked up and
     * succeeded". A freeform line carries an `ingredientId` like any other, so the id alone cannot tell the
     * two apart, and without this the editor badges a freeform line `RESOLVED` — see `toRecipeFormValues`.
     *
     * ⚠️ Sound as a discriminator rather than a cache of one: the server derives it from the line's binding (a
     * declared name, ADR-0045), and a declaration never settles into a food.
     */
    readonly isUserEntered: boolean;
    /**
     * The stated amount, or the LOWER bound when the line states a range.
     *
     * ⚠️ DELIBERATELY STILL A LOOSE NUMBER, and not `recipe-core`'s `IngredientQuantity` value object, even
     * though the wire and the column both carry the value object since U8. A DRAFT is the one place an
     * incoherent quantity is a legitimate state: it is what a half-typed numeric input holds, and it is what
     * the inline `quantityInvalid` error exists to talk about. The value object is what a coherent quantity
     * PARSES to, at the wire boundary (`toCreateRecipeInput` (`./wire.ts`) / `toUpdateRecipeInput` (`./wire.ts`)) — parse,
     * don't validate, with the loose shape on the user's side of the parse.
     */
    readonly quantity: number;
    /**
     * The UPPER bound when the line states a range (`2 to 3 cups`); absent for a single stated value.
     *
     * Rendered by U9's second numeric input, beside the lower bound and sharing the line's one unit field.
     * It was carried by the draft a unit EARLIER than that input existed, because `toRecipeFormValues` has
     * to round-trip it: without it, opening a ranged recipe in the editor and pressing save would silently
     * narrow `2–3 cups` back to `2 cups`, which is precisely the value corruption this whole change exists
     * to end.
     */
    readonly quantityHigh?: number;
    readonly unit?: string;
    /**
     * The free-form DISPLAY OVERRIDE (wire: `notes`, column `display_text`).
     *
     * ⛔ NOT the preparation, and no editor writes it — see {@link preparation}. It is carried here only so
     * that opening an IMPORTED recipe and saving it does not destroy the clause the importer stored.
     */
    readonly notes?: string;
    /**
     * How this recipe prepares the food — `finely chopped`, `at room temperature` (plan U26).
     *
     * ⛔ NEVER folded into {@link name}: the name is what the catalog says the food IS, and a name carrying a
     * preparation matches no catalog row. The vocabulary is the KTD-11b ruling implemented in
     * `@kitchensink/recipe-import-core`'s `modifierLexicon.ts` — a past participle or a temperature, never
     * an adjective (which is identity and arrives from the picker).
     */
    readonly preparation?: string;
    /**
     * The section this line sits in — `For the marinade`, `Dry` (plan U27).
     *
     * ABSENT means ungrouped, and most lines are. Sections are folded from CONSECUTIVE RUNS of equal labels
     * by `ingredientSections` (`./props.ts`), so the rendered order is always the stored order.
     */
    readonly groupLabel?: string;
    readonly resolutionStatus?: FoodResolutionStatus;
    /**
     * Why an unresolved line did not resolve, as the detail read reported it (plan 002 R1, R6). Seeded by
     * `toRecipeFormValues` and read only by `rowPresentationOf` (`./ingredientRowPolicy.ts`); never sent, because the
     * server derives it from the binding.
     */
    readonly unresolvedReason?: UnresolvedFoodReasonCode;
    /**
     * The food this line is bound to, as the nutrition read names it (plan 002 R46): seeded from the detail read's
     * `foodId`, and carried from the admitted ingredient on a pick. Absent for a declared line and for a binding the
     * read names no root food for.
     *
     * ⛔ The ref, never the figures. Nutrition does not enter the draft (blueprint Decision 3): the per-100 g figures
     * and portions come from ONE background read per editor (`useLineNutrition`), which both the row panel and the
     * running total read. They used to sit here, filled only on lines picked this session, so every opened recipe
     * totalled to nothing.
     */
    readonly foodRef?: FoodNutritionRef;
    readonly userCalories?: number;
    readonly userProteinG?: number;
    readonly userCarbsG?: number;
    readonly userFatG?: number;
}

/** One editable instruction step (the server assigns `stepNumber` from array order). */
export interface RecipeFormStep {
    readonly instruction: string;
    readonly timerSeconds?: number;
}

/** The full editable form state (create or edit). `totalTimeMinutes` is derived, never edited directly. */
export interface RecipeFormValues {
    readonly title: string;
    readonly description: string;
    readonly cuisine: string;
    /**
     * Author-stated difficulty (FR-001b). ABSENT means "not stated" — a real, first-class state, never a
     * substituted default. On an EDIT form this field is seeded from the recipe's current difficulty, so the
     * user removing it (choosing "not stated") makes the field absent, which `toUpdateRecipeInput` (`./wire.ts`)
     * turns into an explicit `null` clear on the wire (as opposed to an omit, which would leave it unchanged).
     */
    readonly difficulty?: RecipeDifficulty;
    /**
     * Author-stated meal type (plan U34). ABSENT means "not stated" — a real, first-class state, never a
     * substituted default, exactly as for {@link RecipeFormValues.difficulty} above. On an EDIT form it is
     * seeded from the recipe's current meal type, so the user choosing "not stated" makes the field absent,
     * which `toUpdateRecipeInput` (`./wire.ts`) turns into an explicit wire `null` clear (as opposed to an omit,
     * which would leave the stored value unchanged).
     *
     * ⛔ A CLOSED vocabulary, and the only one on this form: `tags` and `dietaryFlags` beside it are free
     * text and stay that way. They are three separate axes and none of them aliases another — the mockup
     * wrote its Dietary chips into the SAME array as its Categories, which is the state bug this shape
     * refuses by construction.
     */
    readonly mealType?: RecipeMealType;
    readonly tags: readonly string[];
    readonly dietaryFlags: readonly string[];
    readonly servings: number;
    readonly prepTimeMinutes: number;
    readonly cookTimeMinutes: number;
    readonly visibility: RecipeVisibility;
    readonly ingredients: readonly RecipeFormIngredient[];
    readonly steps: readonly RecipeFormStep[];
    /**
     * Photos the cook has CHOSEN but which have not been handed to the upload queue yet (U33, owner ruling
     * 2026-08-25). See {@link RecipeFormPhoto} for what is — and deliberately is not — in each entry.
     *
     * ⛔ These are PENDING PICKS, not the recipe's photo gallery. A saved recipe's photos stay owned by
     * `useRecipePhotos(recipeId)`, which the delete/reorder mutations already invalidate; duplicating them
     * here would stand up a second authority over the same rows with no way to keep the two in step.
     * `toRecipeFormValues` (`./wire.ts`) therefore seeds this EMPTY from a loaded recipe, which is not a lossy
     * projection — a loaded recipe has, by definition, no pending picks.
     *
     * ⛔ Photos are NOT a validation input. `validateRecipeForm` never reads this field and no step's error
     * map mentions it, so a photo can never block an advance or a publish — the metadata save and the photo
     * upload are two calls, and the wizard must not pretend otherwise.
     */
    readonly photos: readonly RecipeFormPhoto[];
}

/**
 * One photo a cook has picked but not yet uploaded — the draft-side half of U33's "photos behave like every
 * other field" ruling (2026-08-25).
 *
 * **Why photos needed a draft representation at all.** `RecipePhotoUploaderContainer` takes a REQUIRED
 * `recipeId` and keys every operation on it, so on its own the create path cannot show an uploader at all.
 * A "Save this recipe first" notice on step 1 would greet every new recipe with a disabled control, so the
 * pick is recorded here and FLUSHED to the upload queue the moment
 * the recipe first has an id. That flush rule is deliberately the SAME on create and edit (on edit the id is
 * already there, so the flush is immediate) — one path, not two.
 *
 * ⛔ **The BINARY is deliberately absent, and this is load-bearing.** The discard guard's dirty test is
 * `recipeFormValuesEqual`, a `JSON.stringify` comparison whose own contract says it is EXACT because every
 * field is plain data. A `File`/`Blob` serialises to `{}`, so two different pending photos would compare
 * EQUAL and swapping one for another would be reported as "no unsaved changes". The bytes therefore live in
 * a container-owned side channel keyed by {@link localId}, and only this JSON-comparable descriptor is
 * draft state. `fileName`/`contentType`/`fileSize` are carried because they are what the queue's own
 * pre-upload validation (`validatePhotoFile`) judges, and what the cook is shown while it waits.
 */
export interface RecipeFormPhoto {
    /**
     * Stable identity for this pick, minted at pick time and unique within the draft — the key the
     * container's blob side channel is keyed by, and the React list key. NOT a server id: a pending photo has
     * no server identity yet, and conflating the two is how a pick that failed to upload gets mistaken for a
     * row that exists.
     */
    readonly localId: string;
    /** The chosen file's name, shown while the upload is pending and carried to the presign call. */
    readonly fileName: string;
    /** The chosen file's MIME type, as reported by the picker — judged by `validatePhotoFile`, never trusted
     *  by the service (which re-detects it from magic bytes on confirm). */
    readonly contentType: string;
    /** The chosen file's size in bytes — judged against the upload cap before any network call is made. */
    readonly fileSize: number;
}

/**
 * An empty create form: no ingredients/steps, public visibility (free-tier default), zeroed numerics.
 *
 * @returns A blank {@link RecipeFormValues}.
 */
export const defaultRecipeFormValues = (): RecipeFormValues => ({
    title: '',
    description: '',
    cuisine: '',
    tags: [],
    dietaryFlags: [],
    servings: 1,
    prepTimeMinutes: 0,
    cookTimeMinutes: 0,
    visibility: 'public',
    ingredients: [],
    steps: [],
    photos: [],
});
