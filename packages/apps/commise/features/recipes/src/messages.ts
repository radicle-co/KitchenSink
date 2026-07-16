/**
 * @module @commise/features-recipes/messages — user-facing copy for the recipe feature.
 *
 * Shared, platform-neutral strings live here as a {@link LocalizedMessages} dictionary, exported once and
 * consumed by BOTH the web `.tsx` and mobile `.native.tsx` leaves (via `useMessages`), so the platforms
 * cannot drift on copy. The `en` set is required; adding a locale is just another key. Strings specific to
 * the web or mobile app stay in those apps and are handled per platform.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the recipe-list screen (T065), rendered by both the web and native list views. */
export interface RecipeListMessages {
    /** Page/section heading for the recipe list. */
    readonly heading: string;
    /** Accessible name for the search field. */
    readonly searchLabel: string;
    /** Placeholder shown inside the search field. */
    readonly searchPlaceholder: string;
    /** Singular result-count template (contains `{count}`). */
    readonly countOne: string;
    /** Plural result-count template (contains `{count}`). */
    readonly countOther: string;
    /** Total-time unit template (contains `{minutes}`). */
    readonly durationMinutes: string;
    /** Accessible label for the loading state. */
    readonly loadingLabel: string;
    /** Heading of the empty state (a successful load with no recipes). */
    readonly emptyTitle: string;
    /** Body copy of the empty state. */
    readonly emptyBody: string;
    /** Heading of the no-match state (the caller HAS recipes, but none match the active search). */
    readonly noMatchTitle: string;
    /** Body copy of the no-match state. */
    readonly noMatchBody: string;
    /** Label of the create-recipe call to action. */
    readonly createCta: string;
    /** Message shown when the list fails to load. */
    readonly errorTitle: string;
    /** Label of the retry action in the error state. */
    readonly retry: string;
}

/** Shared copy for the recipe-detail screen (T066), rendered by both the web and native detail views. */
export interface RecipeDetailMessages {
    /** Label for the prep-time meta stat. */
    readonly prepLabel: string;
    /** Label for the cook-time meta stat. */
    readonly cookLabel: string;
    /** Label for the total-time meta stat. */
    readonly totalLabel: string;
    /** Label for the servings meta stat. */
    readonly servingsLabel: string;
    /** Accessible name for the photo gallery. */
    readonly photosLabel: string;
    /** Photo alt-text template (contains `{title}` and `{index}`). */
    readonly photoAlt: string;
    /** Heading for the ingredients section. */
    readonly ingredientsHeading: string;
    /** Badge shown on a user-entered (freeform) ingredient. */
    readonly userEnteredBadge: string;
    /** Heading for the instructions section. */
    readonly instructionsHeading: string;
    /** Timer template for a step (contains `{seconds}`). */
    readonly stepTimer: string;
    /** Heading for the nutrition section. */
    readonly nutritionHeading: string;
    /** Notice shown when per-serving nutrition is incomplete (FR-007 partial nutrition). */
    readonly nutritionPartial: string;
    /** Label for calories. */
    readonly caloriesLabel: string;
    /** Label for protein. */
    readonly proteinLabel: string;
    /** Label for carbohydrates. */
    readonly carbsLabel: string;
    /** Label for fat. */
    readonly fatLabel: string;
    /** Grams unit template (contains `{grams}`). */
    readonly gramsUnit: string;
}

/**
 * Shared copy for the mockup-parity recipe card (CR-001) — rendered identically by the Home widget and the
 * recipe list, on both web and native. Visible strings match the mockup; the rest are accessible names that
 * convey what a sighted user reads from the icons/pills/stars so the card is not color- or icon-only.
 */
export interface RecipeCardMessages {
    /** Visible "PRO" badge text (FR-003a). */
    readonly proBadge: string;
    /** Accessible name for the PRO badge (icon/short-text is not self-describing to assistive tech). */
    readonly proBadgeLabel: string;
    /** Visible difficulty pill labels, keyed by difficulty. */
    readonly difficultyEasy: string;
    readonly difficultyMedium: string;
    readonly difficultyHard: string;
    /** Accessible difficulty template (contains `{difficulty}`), e.g. "Difficulty: Easy". */
    readonly difficultyLabel: string;
    /** Accessible total-time template (contains `{minutes}`), e.g. "45 minutes total time". */
    readonly timeLabel: string;
    /** Accessible servings template (contains `{count}`), e.g. "Serves 4". */
    readonly servingsLabel: string;
    /** Accessible rating-summary template (contains `{average}` and `{ratings}`). */
    readonly ratingSummary: string;
    /** Singular rating-count template (contains `{count}`). */
    readonly ratingCountOne: string;
    /** Plural rating-count template (contains `{count}`). */
    readonly ratingCountOther: string;
    /** Shown/announced for a recipe that has no ratings yet (never a fabricated 0-star score). */
    readonly unrated: string;
    /** Accessible label for the cover-image placeholder shown when a recipe has no photo. */
    readonly noPhotoLabel: string;
}

/** The shape of the recipe feature's shared copy. */
export interface RecipeMessages {
    /** Title of the recent-recipes Home widget card. */
    readonly widgetTitle: string;
    /** Empty state shown in the live recipe widget when the viewer has no recipes yet. */
    readonly emptyState: string;
    /** Copy for the recipe-list screen. */
    readonly list: RecipeListMessages;
    /** Copy for the recipe-detail screen. */
    readonly detail: RecipeDetailMessages;
    /** Copy for the shared recipe card (Home widget + list). */
    readonly card: RecipeCardMessages;
}

export const recipeMessages: LocalizedMessages<RecipeMessages> = {
    en: {
        widgetTitle: 'Recent recipes',
        emptyState: 'No recipes yet. Create your first recipe to see it here.',
        list: {
            heading: 'Recipes',
            searchLabel: 'Search recipes',
            searchPlaceholder: 'Search recipes...',
            countOne: '{count} recipe',
            countOther: '{count} recipes',
            durationMinutes: '{minutes} min',
            loadingLabel: 'Loading recipes',
            emptyTitle: 'No recipes yet',
            emptyBody: 'Create your first recipe to see it here.',
            noMatchTitle: 'No matching recipes',
            noMatchBody: 'No recipes match your search. Try a different term.',
            createCta: 'New recipe',
            errorTitle: 'We couldn’t load your recipes.',
            retry: 'Try again',
        },
        detail: {
            prepLabel: 'Prep',
            cookLabel: 'Cook',
            totalLabel: 'Total',
            servingsLabel: 'Serves',
            photosLabel: 'Recipe photos',
            photoAlt: '{title} photo {index}',
            ingredientsHeading: 'Ingredients',
            userEnteredBadge: 'Custom',
            instructionsHeading: 'Instructions',
            stepTimer: '{seconds}s timer',
            nutritionHeading: 'Nutrition (per serving)',
            nutritionPartial: 'Estimated — some items aren’t counted yet',
            caloriesLabel: 'Calories',
            proteinLabel: 'Protein',
            carbsLabel: 'Carbs',
            fatLabel: 'Fat',
            gramsUnit: '{grams} g',
        },
        card: {
            proBadge: 'PRO',
            proBadgeLabel: 'Premium recipe',
            difficultyEasy: 'Easy',
            difficultyMedium: 'Medium',
            difficultyHard: 'Hard',
            difficultyLabel: 'Difficulty: {difficulty}',
            timeLabel: '{minutes} minutes total time',
            servingsLabel: 'Serves {count}',
            ratingSummary: 'Rated {average} out of 5, {ratings}',
            ratingCountOne: '{count} rating',
            ratingCountOther: '{count} ratings',
            unrated: 'Not yet rated',
            noPhotoLabel: 'No photo yet',
        },
    },
};
