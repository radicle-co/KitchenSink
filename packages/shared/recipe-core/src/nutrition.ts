/**
 * Per-serving recipe nutrition aggregation (FR-007 / FR-007a). Pure — no I/O.
 *
 * Each ingredient line contributes its macros in one of two ways, in priority order:
 *   1. **User-entered override** (FR-007a) — an absolute, per-line value the user typed for a freeform
 *      ingredient. When a line carries `userCalories`, its user values are authoritative (any macro the
 *      user left blank counts as 0).
 *   2. **Food-database per-100g** — the resolved catalog nutrition, scaled by the line's mass. This
 *      requires a MASS unit (g/kg/mg/oz/lb) so the quantity can be converted to grams; a volumetric or
 *      count unit (cup/tbsp/clove/…) has no known gram weight here and so cannot be scaled.
 *
 * A line the aggregator cannot account for — a food still resolving (no per-100g yet), a freeform line
 * with no user nutrition, or a catalog line whose unit has neither a mass conversion nor a matching stored
 * portion — is EXCLUDED from the sum and flips `isComplete` to `false`, so the UI presents the total as a
 * partial estimate rather than a false-precise number. Volumetric/count units (cup/tbsp/clove) are
 * converted via the ingredient's household-measure `portions` when the food service supplied one (#11).
 */
import { quantityLowerBound, type IngredientQuantity } from './ingredientQuantity.js';
import type { IngredientPortion, RecipeIngredientView, RecipeNutrition } from './recipe.types.js';
import { unitToGrams } from './units.js';

/**
 * Which bound of a stated range a computed figure was taken from (R38).
 *
 * A fact ABOUT a number, in the same shape as R35's historical-unit marker — which is
 * `HistoricalUnitConversion` in `@kitchensink/cookbook-import`'s `unitEquivalence.ts`, and which likewise
 * makes its disclosure by BEING PRESENT rather than by carrying a "not applicable" value.
 *
 * ⚠️ The two markers live at different layers, and the asymmetry is the answer to the question this
 * sentence otherwise invites. A range is PERSISTED and collapsed at READ time, here, so its marker has to
 * travel on THIS wire — the response a cook is shown. A historical unit is restated at IMPORT time, and its
 * marker travels on the REQUEST wire and into three columns of `recipe_ingredients` instead
 * (`0027_ingredient_stated_measure.sql`), because its reader is the verification gate rather than a cook.
 *
 * ⛔ AN EARLIER VERSION OF THIS NOTE ARGUED THERE WAS NO READER AT ALL, and it was wrong. It said a
 * historical unit "is restated at IMPORT time, upstream of the wire and by a tool, so there is no read-time
 * step to disclose and no column to disclose it in", and refused a column as "a persisted column plus a
 * `CONTRACT_HASH` move (ADR-0014) for a fact with one producer and no reader". U11's gate IS that reader:
 * it builds its question from the persisted `quantity`/`unit`, so without the stated pair it was shown
 * `one gill of milk` beside `0.5 cup` and correctly disagreed with a line we had parsed RIGHT. The premise
 * is false; the marker crosses a wire, and the `CONTRACT_HASH` moved.
 *
 * ⚠️ WHAT IS STILL REFUSED, and this half of the old note stands: do NOT add a historical-unit provenance
 * field to {@link RecipeNutrition} or to `RecipeIngredient` to "restore the symmetry". Neither carries
 * `sourceLine` either. Both are write-side provenance the gate reads; the disclosure a COOK gets is the
 * sentence `describeConversions` writes into the recipe's own description.
 *
 * The domain of "a bound" is the pair `quantityLowerBound`/`quantityUpperBound` answer, so both members are
 * named here even though today's policy only ever collapses to `low` — a client renders the bound it is
 * TOLD, rather than hard-coding the word "lower" against a policy it cannot see.
 */
export type RangeDerivedBound = 'low' | 'high';

/**
 * The bound a collapsed range contributes from.
 *
 * ⛔ LOW, not high, and not a midpoint. Understating an ingredient understates the nutrition figure, and of
 * the two directions to be wrong that is the one a cook is not harmed by trusting. A midpoint would be a
 * number the source never stated at all. The choice is disclosed rather than hidden — see
 * {@link RecipeNutrition.rangeDerivedBound}.
 */
const COLLAPSE_RANGE_TO: RangeDerivedBound = 'low';

/** One ingredient line's nutrition inputs: its measure, any user override, the catalog per-100g, + portions. */
export interface NutritionLine {
    readonly quantity: IngredientQuantity;
    readonly unit: string;
    readonly userCalories?: number;
    readonly userProteinG?: number;
    readonly userCarbsG?: number;
    readonly userFatG?: number;
    readonly caloriesPer100g?: number;
    readonly proteinGPer100g?: number;
    readonly carbsGPer100g?: number;
    readonly fatGPer100g?: number;
    /** The catalog ingredient's household-measure portions (for converting a volumetric/count unit). */
    readonly portions?: readonly IngredientPortion[];
}

/** The absolute macro contribution of one line, or `null` when it cannot be accounted for. */
interface Macros {
    readonly calories: number;
    readonly proteinG: number;
    readonly carbsG: number;
    readonly fatG: number;
}

/**
 * Which of the two accounting routes produced a line's macros: the per-line user override (FR-007a), or the
 * catalog per-100g figure scaled by mass.
 *
 * It is a fact ABOUT a number, and two consumers need it. A reading assembled entirely from `user` lines drew
 * on no food data, so a food outage cannot have made it stale; a reading with any `catalog` line can have.
 */
export type LineNutritionSource = 'user' | 'catalog';

/** One line's macro contribution together with the route that produced it. */
type SourcedMacros = Macros & { readonly source: LineNutritionSource };

/** One recipe line's measure + per-line user override — its non-catalog nutrition inputs (already normalized). */
export interface LineMeasure {
    readonly quantity: IngredientQuantity;
    readonly unit: string;
    readonly userCalories?: number;
    readonly userProteinG?: number;
    readonly userCarbsG?: number;
    readonly userFatG?: number;
}

/** The resolved catalog nutrition a line may carry (per-100g macros + household-measure portions). */
export interface LineCatalogNutrition {
    readonly caloriesPer100g?: number;
    readonly proteinGPer100g?: number;
    readonly carbsGPer100g?: number;
    readonly fatGPer100g?: number;
    readonly portions?: readonly IngredientPortion[];
}

/**
 * Assemble the {@link NutritionLine} for one recipe line from its measure and its resolved catalog nutrition
 * — the SINGLE place a line's nutrition inputs are merged. Both the recipe DETAIL read and the deferred
 * per-recipe batch (`POST /api/v1/recipes/nutrition-batch`) route through this, so the figure on a card and
 * the figure on the detail are computed from byte-identical inputs and can never disagree. Only defined
 * fields are carried (an absent macro stays absent, not `0`). Pure.
 *
 * @param measure - The line's quantity/unit and any per-line user override (FR-007a), already normalized.
 * @param catalog - The line's resolved catalog per-100g nutrition + portions, or `undefined` when unresolved.
 */
export function toNutritionLine(measure: LineMeasure, catalog: LineCatalogNutrition | undefined): NutritionLine {
    return {
        quantity: measure.quantity,
        unit: measure.unit,
        ...(measure.userCalories !== undefined ? { userCalories: measure.userCalories } : {}),
        ...(measure.userProteinG !== undefined ? { userProteinG: measure.userProteinG } : {}),
        ...(measure.userCarbsG !== undefined ? { userCarbsG: measure.userCarbsG } : {}),
        ...(measure.userFatG !== undefined ? { userFatG: measure.userFatG } : {}),
        ...(catalog?.caloriesPer100g !== undefined ? { caloriesPer100g: catalog.caloriesPer100g } : {}),
        ...(catalog?.proteinGPer100g !== undefined ? { proteinGPer100g: catalog.proteinGPer100g } : {}),
        ...(catalog?.carbsGPer100g !== undefined ? { carbsGPer100g: catalog.carbsGPer100g } : {}),
        ...(catalog?.fatGPer100g !== undefined ? { fatGPer100g: catalog.fatGPer100g } : {}),
        ...(catalog?.portions !== undefined ? { portions: catalog.portions } : {}),
    };
}

/** The macro contribution of a single line (user override first, else scaled per-100g), or `null`. Pure. */
function lineMacros(line: NutritionLine): SourcedMacros | null {
    if (line.userCalories !== undefined) {
        return {
            source: 'user',
            calories: line.userCalories,
            proteinG: line.userProteinG ?? 0,
            carbsG: line.userCarbsG ?? 0,
            fatG: line.userFatG ?? 0,
        };
    }

    if (line.caloriesPer100g !== undefined) {
        // ⛔ R40. A line the source left unquantified has no mass, so it is UNACCOUNTED — never `0` (which
        // would report a complete total silently missing an ingredient) and never a fabricated `1`.
        const amount = quantityLowerBound(line.quantity);

        if (amount === null) {
            return null;
        }

        const grams = unitToGrams(amount, line.unit, line.portions);

        if (grams === null) {
            return null; // catalog nutrition, but a unit we can't convert (no mass factor, no portion)
        }

        const factor = grams / 100;

        return {
            source: 'catalog',
            calories: line.caloriesPer100g * factor,
            proteinG: (line.proteinGPer100g ?? 0) * factor,
            carbsG: (line.carbsGPer100g ?? 0) * factor,
            fatG: (line.fatGPer100g ?? 0) * factor,
        };
    }

    return null; // no user override and no resolved catalog nutrition
}

/**
 * Which source accounted for a line, or `null` when the line could not be accounted for at all — the SAME
 * decision {@link computeRecipeNutrition} makes when it excludes a line and flips `isComplete`, exposed so a
 * caller can ask it per line instead of re-deriving it. Pure.
 *
 * Two answers the aggregate totals structurally cannot give: whether ANY line contributed (a recipe that
 * genuinely sums to `0` and one where nothing could be accounted for both report `calories: 0`), and whether
 * the figure drew on FOOD data (a reading built only from user overrides cannot have gone stale in a food
 * outage). Both are load-bearing for the deferred-nutrition contract's `known` / `unaccounted` split.
 *
 * @param line - The assembled line.
 * @returns `'user'` | `'catalog'` when the line contributes, `null` when it is unaccounted for.
 */
export function lineNutritionSource(line: NutritionLine): LineNutritionSource | null {
    return lineMacros(line)?.source ?? null;
}

/** Round to one decimal place (nutrition wire precision). Pure. */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Aggregate the per-serving {@link RecipeNutrition} for a recipe's ingredient lines.
 *
 * @param lines - The recipe's ingredient lines with their measures + nutrition inputs.
 * @param servings - The recipe's serving count (REQUIRED positive — the recipe contract guarantees it).
 * @returns Per-serving calories/protein/carbs/fat, and `isComplete=false` if any line was unaccounted.
 */
export function computeRecipeNutrition(lines: readonly NutritionLine[], servings: number): RecipeNutrition {
    let calories = 0;
    let proteinG = 0;
    let carbsG = 0;
    let fatG = 0;
    let isComplete = true;
    let collapsedARange = false;

    for (const line of lines) {
        const macros = lineMacros(line);

        if (macros === null) {
            isComplete = false;
            continue;
        }

        // Only a CATALOG line derives its macros from the quantity. A per-line user override (FR-007a) is
        // absolute for the line, so a range on it collapses nothing and there is nothing to disclose — and
        // an unaccounted line never reaches here at all.
        collapsedARange = collapsedARange || (macros.source === 'catalog' && line.quantity.kind === 'range');

        calories += macros.calories;
        proteinG += macros.proteinG;
        carbsG += macros.carbsG;
        fatG += macros.fatG;
    }

    return {
        calories: round1(calories / servings),
        proteinG: round1(proteinG / servings),
        carbsG: round1(carbsG / servings),
        fatG: round1(fatG / servings),
        isComplete,
        // R38 — present ONLY when a range was actually collapsed, so its presence IS the disclosure and its
        // value names the bound. An always-present field carrying a "not applicable" would put the burden of
        // that distinction back on every reader.
        ...(collapsedARange ? { rangeDerivedBound: COLLAPSE_RANGE_TO } : {}),
    };
}

/*
 * ⛔ `leadCaloriesPerServing(lines, servings)` STOOD HERE AND WAS DELETED. Do not reintroduce it, under any
 * name, as a second way to ask this module for a recipe's calories.
 *
 * It was the write-time denormalization source (W8-a.1) for `recipes.lead_calories_per_serving`. Migration
 * 0019 dropped that column, ADR-0021 moved a card's figure to `POST /api/v1/recipes/nutrition-batch`, and
 * this repo's follow-up removed the field from the wire — leaving a function with no caller anywhere.
 *
 * It is worth recording WHY dead-and-harmless was the wrong reading of it. Its body was
 * `calories > 0 ? calories : undefined`, i.e. a SECOND, DIFFERENT rule for "is there a figure here" that
 * disagreed with the one the system actually ships: `toRecipeNutritionState` (recipe service) decides that
 * from whether any LINE contributed, so a genuinely zero-calorie recipe — water, black coffee — is
 * `known { caloriesPerServing: 0 }`, whereas this function erased it as if the data were missing. Anyone
 * reaching for the convenient-looking helper would have silently adopted the losing rule.
 *
 * Per-serving calories have exactly one derivation: `computeRecipeNutrition`. Whether that figure is
 * REPORTABLE is a separate question, answered once, by the classifier.
 */

/**
 * Whether the partial-nutrition disclosure notice (REQ-034, FR-007a) should render for a recipe — `true`
 * iff at least one ingredient line is user-entered (a freeform line not resolved from the food database,
 * REQ-032b). The ONE authoritative predicate for this gate, shared by the web and native recipe-detail
 * views, so a recipe composed entirely of resolved catalog ingredients never carries the inapplicable
 * "nutrition includes USDA database items; user-entered ingredients are marked Custom" disclosure. Pure.
 *
 * @param ingredients - The recipe's ingredient lines.
 * @returns `true` when at least one ingredient is user-entered.
 */
export function hasUserEnteredIngredients(ingredients: readonly RecipeIngredientView[]): boolean {
    return ingredients.some((ingredient) => ingredient.isUserEntered);
}
