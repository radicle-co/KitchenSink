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
    IngredientVariant,
    RecipeDifficulty,
    RecipeMealType,
    RecipeVisibility,
    UnresolvedFoodReasonCode,
} from '@kitchensink/recipe-core';

import type { IngredientLineKey } from './lineKey.js';

/**
 * One editable ingredient line. `ingredientId` is `null` until the line resolves to a catalog row (via
 * food-service typeahead or a freeform create) — the wire contract REQUIRES an id, so an unresolved line
 * cannot be submitted (validation flags it). `resolutionStatus` drives the row's async nutrition badge.
 *
 * The line carries no catalog nutrition (plan 002 V1 B5): `foodId` and `variant` name the food, and the editor's one
 * background read supplies its figures (`foodRefOf`, `./nutritionLookup.ts`, derives what it asks for). `userCalories`/`userProteinG`/`userCarbsG`/`userFatG` are the FR-007a per-line figures
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
     * The food text the line SHOWS (the cook's own words); absent shows the bound food's name (wire: `displayText`).
     * ⛔ NOT the preparation (see {@link preparation}), and never a food name: the row editor's "Name on the recipe".
     */
    readonly displayText?: string;
    /** A dimension the cook wrote in parentheses after the amount ("9 inch"), shown beside the food (wire: `note`). */
    readonly note?: string;
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
     * Whether the line's food is private to its author or public, from food's LIVE answer (ADR-0029 section 4). Seeded by
     * `toRecipeFormValues` and set on a pick or a created food; read only by `privateFoodRowIndexes`. Never sent: the
     * server derives it. Absent when food could not be asked, and on a declared line.
     */
    readonly foodVisibility?: 'private' | 'public';
    /**
     * Why an unresolved line did not resolve, as the detail read reported it (plan 002 R1, R6). Seeded by
     * `toRecipeFormValues` and read only by `rowPresentationOf` (`./ingredientRowPolicy.ts`); never sent, because the
     * server derives it from the binding.
     */
    readonly unresolvedReason?: UnresolvedFoodReasonCode;
    /**
     * The LIVE ROOT this line is bound to (plan 002 R46; curated U9): on a variant-bound line, that variant's root.
     * Seeded from the detail read's `foodId`, and carried from the admitted ingredient on a pick. Absent for a declared
     * line and for a binding the read names no food for.
     */
    readonly foodId?: string;
    /**
     * The variant this line is bound to, parts and all (curated U9, R25): the row's dotted line, and the `current` the
     * details dialog opens on. From the line's own binding, never a fresh catalog read, so a retired variant still
     * shows (R29). Absent on a root-bound line.
     *
     * ⛔ The food, never its figures. Nutrition does not enter the draft (blueprint Decision 3): the per-100 g figures
     * come from ONE background read per editor (`useLineNutrition`), asked for by `foodRefOf(line)` — the variant when
     * there is one, else the root — which the row panel and the running total both read.
     */
    readonly variant?: IngredientVariant;
    /**
     * The pasted line this line was read from, verbatim (blueprint A5). Set only for a line pasted while the recipe has
     * no server row, and sent only on the CREATE (`toCreateRecipeInput`): the wire field is create-only (ADR-0023's
     * shape), so `toUpdateRecipeInput` drops it, and a line pasted into a stored recipe is an authored line. A
     * typed-then-picked line never has one (A2).
     */
    readonly sourceLine?: string;
    /** The ingredient phrase the parse lifted out of {@link sourceLine}: the cross-user memo's key. Create-only too. */
    readonly sourcePhrase?: string;
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
     * The web page the cook says this recipe was copied from, as typed or pasted (ADR-0089). ABSENT means none: an emptied
     * field REMOVES the key (`setSourceLink`), so a draft without one compares equal to a recipe that has none.
     *
     * ⛔ The text, not a proved link. `draftSourceOf` (`./sourceLink.ts`) reads it, and a refused or half-typed text stays
     * in the draft (and on the device) but is never sent. Optional and LAST on purpose: an old device draft has none and
     * still parses (`LOCAL_SCHEMA_VERSION` does not move), and `recipeFormValuesEqual` reads key order.
     */
    readonly sourceLink?: string;
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
});

/**
 * Structural equality over {@link RecipeFormValues}: whether two drafts carry the same data. Every builder in this
 * package (`defaultRecipeFormValues`, `toRecipeFormValues`, the `props.ts` transitions) omits absent optional fields
 * rather than storing `undefined`, and builds object keys in a stable order, so a `JSON.stringify` comparison is exact
 * here. `NaN` (the draft's "no amount") serialises as `null` on both sides, so two amount-less lines compare equal.
 *
 * The editor reads it to decide whether the server already holds the draft (a checkpoint with nothing new is not
 * sent; Save changes is disabled while there is nothing to save). Pure.
 *
 * @param a - One draft.
 * @param b - The other draft.
 * @returns Whether `a` and `b` carry the same data.
 */
export function recipeFormValuesEqual(a: RecipeFormValues, b: RecipeFormValues): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
