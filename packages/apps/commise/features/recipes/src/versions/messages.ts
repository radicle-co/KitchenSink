/**
 * @module @commise/features-recipes/versions/messages — user-facing copy for the recipe version-history
 * (T069) and concurrent-edit conflict (T070) building blocks.
 *
 * Shared, platform-neutral strings kept as a {@link LocalizedMessages} dictionary, exported once and
 * consumed by BOTH the web `.tsx` and native `.native.tsx` leaves (via `useMessages`), so the platforms
 * cannot drift on copy. The `en` set is required; adding a locale is just another key. These live here
 * (not in the feature's shared `messages.ts`) so the version surface owns its own copy.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the recipe version-history list (T069). */
export interface RecipeVersionListMessages {
    /** Heading for the version-history panel. */
    readonly heading: string;
    /** Empty state shown when the recipe has no version history yet. */
    readonly empty: string;
    /** Per-version label template (contains `{version}`). */
    readonly versionLabel: string;
    /** Marker shown on the recipe's current (non-restorable) version. */
    readonly currentBadge: string;
    /** Visible label of the restore action. */
    readonly restore: string;
    /** Accessible name of the restore action, disambiguated per version (contains `{version}`). */
    readonly restoreAction: string;
    /** Busy status announced while a version is being restored (contains `{version}`). */
    readonly restoringStatus: string;
}

/** Shared copy for the concurrent-edit conflict resolution view (T070 / C-005). */
export interface RecipeConflictMessages {
    /** Heading for the conflict panel. */
    readonly heading: string;
    /** Explanatory copy describing why the conflict is shown. */
    readonly explanation: string;
    /** Heading for the user's own (in-progress) version column. */
    readonly mineHeading: string;
    /** Heading for the latest saved (their) version column. */
    readonly theirsHeading: string;
    /** Label of the "keep my version" choice. */
    readonly keepMine: string;
    /** Label of the "use the latest version" choice. */
    readonly useTheirs: string;
    /** Field label: recipe title. */
    readonly titleLabel: string;
    /** Field label: servings. */
    readonly servingsLabel: string;
    /** Field label: prep time. */
    readonly prepLabel: string;
    /** Field label: cook time. */
    readonly cookLabel: string;
    /** Field label: total time. */
    readonly totalLabel: string;
    /** Field label: ingredients. */
    readonly ingredientsLabel: string;
    /** Field label: steps. */
    readonly stepsLabel: string;
    /** Duration template (contains `{minutes}`). */
    readonly minutes: string;
    /** Singular ingredient-count template (contains `{count}`). */
    readonly ingredientCountOne: string;
    /** Plural ingredient-count template (contains `{count}`). */
    readonly ingredientCountOther: string;
    /** Singular step-count template (contains `{count}`). */
    readonly stepCountOne: string;
    /** Plural step-count template (contains `{count}`). */
    readonly stepCountOther: string;
}

/** The shape of the version surface's shared copy. */
export interface RecipeVersionMessages {
    /** Copy for the version-history list (T069). */
    readonly versionList: RecipeVersionListMessages;
    /** Copy for the concurrent-edit conflict view (T070). */
    readonly conflict: RecipeConflictMessages;
}

export const recipeVersionMessages: LocalizedMessages<RecipeVersionMessages> = {
    en: {
        versionList: {
            heading: 'Version history',
            empty: 'No earlier versions yet.',
            versionLabel: 'Version {version}',
            currentBadge: 'Current version',
            restore: 'Restore',
            restoreAction: 'Restore version {version}',
            restoringStatus: 'Restoring version {version}…',
        },
        conflict: {
            heading: 'This recipe changed while you were editing',
            explanation: 'Someone saved a new version while you were making changes. Choose which version to keep.',
            mineHeading: 'Your version',
            theirsHeading: 'Latest saved version',
            keepMine: 'Keep my version',
            useTheirs: 'Use the latest version',
            titleLabel: 'Title',
            servingsLabel: 'Servings',
            prepLabel: 'Prep time',
            cookLabel: 'Cook time',
            totalLabel: 'Total time',
            ingredientsLabel: 'Ingredients',
            stepsLabel: 'Steps',
            minutes: '{minutes} min',
            ingredientCountOne: '{count} ingredient',
            ingredientCountOther: '{count} ingredients',
            stepCountOne: '{count} step',
            stepCountOther: '{count} steps',
        },
    },
};
