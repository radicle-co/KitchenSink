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
    /** Label of the create-recipe call to action. */
    readonly createCta: string;
    /** Message shown when the list fails to load. */
    readonly errorTitle: string;
    /** Label of the retry action in the error state. */
    readonly retry: string;
}

/** The shape of the recipe feature's shared copy. */
export interface RecipeMessages {
    /** Title of the recent-recipes Home widget card. */
    readonly widgetTitle: string;
    /** Empty state shown in the live recipe widget when the viewer has no recipes yet. */
    readonly emptyState: string;
    /** Copy for the recipe-list screen. */
    readonly list: RecipeListMessages;
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
            createCta: 'New recipe',
            errorTitle: 'We couldn’t load your recipes.',
            retry: 'Try again',
        },
    },
};
