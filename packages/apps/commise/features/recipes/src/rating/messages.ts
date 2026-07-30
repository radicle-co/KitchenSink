/**
 * @module @commise/features-recipes/rating/messages — user-facing copy for the interactive rating control.
 *
 * Shared, platform-neutral strings for the FR-013 rating control, exported once and consumed by BOTH the web
 * `.tsx` and native `.native.tsx` leaves (via `useMessages`), so the platforms cannot drift on copy. Mirrors
 * the shape of the feature's other clusters (`../messages.ts`, `../actions/messages.ts`); the `en` set is
 * required and adding a locale is just another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the interactive rating control (FR-013). */
export interface RecipeRatingMessages {
    /** Accessible label for the whole rating region. */
    readonly regionLabel: string;
    /** Heading for the community aggregate. */
    readonly communityHeading: string;
    /** Accessible summary template for a rated recipe (contains `{average}` and `{ratings}`). */
    readonly communitySummary: string;
    /** Singular rating-count template (contains `{count}`). */
    readonly ratingCountOne: string;
    /** Plural rating-count template (contains `{count}`). */
    readonly ratingCountOther: string;
    /** Shown/announced for a recipe with no ratings yet (never a fabricated 0-star score). */
    readonly unrated: string;
    /** Heading / call to action for the interactive input. */
    readonly rateHeading: string;
    /** Accessible group label for the star radiogroup. */
    readonly groupLabel: string;
    /** Singular star-option label template (contains `{count}`), e.g. "Rate 1 star". */
    readonly rateStarOne: string;
    /** Plural star-option label template (contains `{count}`), e.g. "Rate 4 stars". */
    readonly rateStarOther: string;
    /** Label of the remove-my-rating action (Sc10). */
    readonly removeLabel: string;
    /** Busy status shown/announced while a rating write is in flight. */
    readonly submittingLabel: string;
    /** Reason shown on the viewer's own recipe, where rating is withheld (Sc8). */
    readonly ownRecipeNote: string;
    /** Honest surface for a not-found response on a recipe the viewer cannot read (Sc9). */
    readonly errorNotAvailable: string;
    /** Surface for any other failed rating write. */
    readonly errorGeneric: string;
}

export const recipeRatingMessages: LocalizedMessages<{ rating: RecipeRatingMessages }> = {
    en: {
        rating: {
            regionLabel: 'Recipe rating',
            communityHeading: 'Community rating',
            communitySummary: 'Rated {average} out of 5, {ratings}',
            ratingCountOne: '{count} rating',
            ratingCountOther: '{count} ratings',
            unrated: 'Not yet rated',
            rateHeading: 'Rate this recipe',
            groupLabel: 'Your rating',
            rateStarOne: 'Rate {count} star',
            rateStarOther: 'Rate {count} stars',
            removeLabel: 'Remove my rating',
            submittingLabel: 'Saving your rating…',
            ownRecipeNote: 'You can’t rate your own recipe.',
            errorNotAvailable: 'This recipe isn’t available.',
            errorGeneric: 'We couldn’t save your rating. Please try again.',
        },
    },
};
