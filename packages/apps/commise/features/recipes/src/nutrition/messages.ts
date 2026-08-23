/**
 * @module @commise/features-recipes/nutrition/messages — user-facing copy for the deferred calorie lookup.
 *
 * Platform-neutral strings consumed by BOTH the web `*.tsx` and native `*.native.tsx` leaves via
 * `useMessages`, so the two platforms cannot drift on what they tell a reader about a figure. Mirrors the
 * shape of the feature's shared `../messages.ts`; the `en` set is required and adding a locale is another key.
 *
 * ⚠️ WHY THE ACCESSIBLE NAMES ARE WHOLE TEMPLATES, not a figure with caveats concatenated onto it. "420 cal"
 * + ", may be out of date" reads as one sentence in English and as nonsense in a language that puts the
 * qualifier first or inflects the noun. Each of the four freshness × completeness combinations therefore gets
 * its OWN template, and a translator gets a whole sentence to translate.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the calorie chip, its loading placeholder, and the reasons a figure can be missing. */
export interface RecipeNutritionMessages {
    /**
     * Names/announces the calorie placeholder while the lookup is in flight (the Suspense fallback). This is
     * the ONLY string tied to `pending`, which exists on the client and never on the wire.
     */
    readonly loadingLabel: string;
    /** Visible calorie template for a COMPLETE reading (contains `{calories}`), e.g. "420 cal". */
    readonly calories: string;
    /**
     * Visible calorie template for an INCOMPLETE reading (contains `{calories}`), e.g. "~420 cal". The
     * approximation marker is inside the template because it is a typographic convention, not a universal
     * one — a locale that marks approximation differently changes this string, not the code.
     */
    readonly caloriesApproximate: string;
    /**
     * Accessible name for a complete but STALE reading (contains `{calories}`). A stale figure marked only by
     * styling tells a sighted reader the caveat and a screen-reader user nothing, so the caveat lives here.
     */
    readonly caloriesStaleLabel: string;
    /** Accessible name for an INCOMPLETE, fresh reading (contains `{calories}`). */
    readonly caloriesApproximateLabel: string;
    /** Accessible name for a reading that is both incomplete AND stale (contains `{calories}`). */
    readonly caloriesApproximateStaleLabel: string;
    /**
     * Accessible name for a figure computed from the LOW end of a stated range (R38, contains `{calories}`).
     *
     * ⛔ NAMES THE BOUND. "About N cal" alone would not: a reader cannot tell a figure that is missing some
     * items from one that is a third under because the recipe said `2–3 cups` and we took the 2.
     */
    readonly caloriesRangeLowLabel: string;
    /** Accessible name for a figure computed from the HIGH end of a stated range (contains `{calories}`). */
    readonly caloriesRangeHighLabel: string;
    /** Disclosure copy: nothing in the recipe is matched to a food yet (`no_resolved_ingredients`). */
    readonly unaccountedNoResolvedIngredients: string;
    /** Disclosure copy: foods matched, but none carries qualifying nutrient data (`no_nutrient_data`). */
    readonly unaccountedNoNutrientData: string;
    /** Disclosure copy: the lookup itself failed and nothing was cached (`food_unavailable`). */
    readonly unaccountedFoodUnavailable: string;
}

/**
 * The deferred-nutrition copy.
 *
 * A COMPLETE, FRESH reading deliberately has no separate accessible-name template: its visible text is
 * already the whole truth, so {@link RecipeNutritionMessages.calories} serves as both and there is no second
 * string to keep in step with the first.
 */
export const recipeNutritionMessages: LocalizedMessages<RecipeNutritionMessages> = {
    en: {
        loadingLabel: 'Loading calories',
        calories: '{calories} cal',
        caloriesApproximate: '~{calories} cal',
        caloriesStaleLabel: '{calories} cal, may be out of date',
        caloriesApproximateLabel: 'About {calories} cal, some items aren’t counted yet',
        caloriesApproximateStaleLabel: 'About {calories} cal, some items aren’t counted yet and may be out of date',
        caloriesRangeLowLabel: 'About {calories} cal, counted from the lower amount in this recipe’s range',
        caloriesRangeHighLabel: 'About {calories} cal, counted from the upper amount in this recipe’s range',
        unaccountedNoResolvedIngredients: 'No nutrition yet — none of these ingredients is matched to a food.',
        unaccountedNoNutrientData: 'No nutrition yet — the matched foods carry no nutrient data.',
        unaccountedFoodUnavailable: 'Nutrition is unavailable right now. Try again shortly.',
    },
};
