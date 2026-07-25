/**
 * @module @commise/features-recipes/filters/messages — user-facing copy for the recipe filter bar (FR-006).
 *
 * Shared, platform-neutral strings for the filter bar as a {@link LocalizedMessages} dictionary, consumed by
 * BOTH the web `.tsx` and native `.native.tsx` leaves (via `useMessages`), so the platforms cannot drift on
 * copy. The `en` set is required; adding a locale is just another key. Scoped to filters so it can grow
 * independently of the shared recipe-feature copy in `../messages.ts` (per the per-area message-file pattern).
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the recipe filter bar (FR-006), rendered by both the web and native bars. */
export interface FilterMessages {
    /** Accessible name for the whole filter bar (its outer group). */
    readonly barLabel: string;
    /** Group label for the dietary-flag facet. */
    readonly dietaryLabel: string;
    /** Group label for the tag facet. */
    readonly tagsLabel: string;
    /** Group label for the single-select Cuisine facet (S2). */
    readonly cuisineLabel: string;
    /** Group label for the max-prep-time bound (S2). */
    readonly maxPrepTimeLabel: string;
    /** Group label for the max-cook-time bound (REQ-030f). */
    readonly maxCookTimeLabel: string;
    /** Group label for the max-total-time bound. */
    readonly maxTotalTimeLabel: string;
    /** Time-bucket button template (contains `{minutes}`). */
    readonly timeBucket: string;
    /** Singular chip-count template, folded into a chip's accessible name (contains `{count}`). */
    readonly chipCountOne: string;
    /** Plural chip-count template, folded into a chip's accessible name (contains `{count}`). */
    readonly chipCountOther: string;
    /** Singular clear-all template (contains `{count}`). */
    readonly clearOne: string;
    /** Plural clear-all template (contains `{count}`). */
    readonly clearOther: string;
}

export const filterMessages: LocalizedMessages<FilterMessages> = {
    en: {
        barLabel: 'Filter recipes',
        dietaryLabel: 'Dietary',
        tagsLabel: 'Tags',
        cuisineLabel: 'Cuisine',
        maxPrepTimeLabel: 'Prep time',
        maxCookTimeLabel: 'Cook time',
        maxTotalTimeLabel: 'Total time',
        timeBucket: 'Under {minutes} min',
        chipCountOne: '{count} recipe',
        chipCountOther: '{count} recipes',
        clearOne: 'Clear {count} filter',
        clearOther: 'Clear {count} filters',
    },
};
