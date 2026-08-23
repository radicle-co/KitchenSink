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
    /** Heading of the Community-tab empty state (no community recipes) — distinct from the owner's empty. */
    readonly emptyCommunityTitle: string;
    /** Body copy of the Community-tab empty state. */
    readonly emptyCommunityBody: string;
    /** Heading of the no-match state (the caller HAS recipes, but none match the active search). */
    readonly noMatchTitle: string;
    /** Body copy of the no-match state. */
    readonly noMatchBody: string;
    /** Label of the "My Recipes" source tab (L5). */
    readonly tabMine: string;
    /** Label of the "Community" source tab (L5). */
    readonly tabCommunity: string;
    /** Accessible name for the source-tab control. */
    readonly tabsLabel: string;
    /** Accessible name for the quick-filter chip row (L4). */
    readonly filtersLabel: string;
    /** Label of the leading "All" chip that clears every active quick-filter (L4). */
    readonly filterAll: string;
    /** Visible label of the "Quick (<30m)" time-bucket quick-filter chip (recipe-list wireframe). */
    readonly filterQuick: string;
    /** Label of the create-recipe call to action (the pinned FAB). */
    readonly createCta: string;
    /** Label of the empty-state create call to action (the sole create control when the list is empty). */
    readonly emptyCreateCta: string;
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
    /** Accessible name for the carousel's slide-activation button (contains `{title}` and `{index}`). */
    readonly photoOpen: string;
    /** Accessible name for the carousel's dot-navigation strip. */
    readonly photoDotsLabel: string;
    /** Accessible name for a single navigation dot (contains `{title}` and `{index}`). */
    readonly photoDot: string;
    /** Accessible name for the lightbox close control. */
    readonly lightboxClose: string;
    /** Heading for the ingredients section. */
    readonly ingredientsHeading: string;
    /** Badge shown on a user-entered (freeform) ingredient. */
    readonly userEnteredBadge: string;
    /**
     * Badge shown on a line the U11 verification gate CONTRADICTED (plan U14 / R15).
     *
     * ⛔ NOT interchangeable with {@link nutritionPartial}. That caveat says the catalog had nothing for a
     * line; this badge says the catalog HAD it and we withheld the figure because a check against the cook's
     * own source text disagreed with our match. A cook who cannot tell those apart cannot act on either.
     */
    readonly needsReviewBadge: string;
    /**
     * Whole-sentence disclosure for a recipe carrying exactly ONE doubted line.
     *
     * A separate string from the plural template rather than a template with a `1` in it, for the reason
     * every count string in this package is: English pluralization is not a substitution, and a locale that
     * inflects differently changes the string rather than the code.
     */
    readonly needsReviewNoticeOne: string;
    /** The same disclosure for two or more doubted lines (contains `{count}`). */
    readonly needsReviewNoticeMany: string;
    /** Heading for the instructions section. */
    readonly instructionsHeading: string;
    /** Timer template for a step (contains `{seconds}`). */
    readonly stepTimer: string;
    /** Accessible name for a step's completion checkbox (contains `{step}`). */
    readonly stepToggleLabel: string;
    /** Accessible name for a tappable tag chip that filters search (contains `{tag}`). */
    readonly tagFilterLabel: string;
    /** Heading for the nutrition section. */
    readonly nutritionHeading: string;
    /** Notice shown when per-serving nutrition is incomplete (FR-007 partial nutrition). */
    readonly nutritionPartial: string;
    /**
     * Disclosure shown when the figure was computed from the LOWER bound of an ingredient's stated range
     * (R38). Distinct from {@link nutritionPartial}: that one says some lines were left out, this one says a
     * counted line was counted at one end of the amount the recipe actually states.
     */
    readonly nutritionRangeDerivedLow: string;
    /** The same disclosure for a figure computed from the UPPER bound (R38). */
    readonly nutritionRangeDerivedHigh: string;
    /** Always-present standing note explaining the nutrition source + the Custom marker (D8). */
    readonly nutritionSourceNote: string;
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
    /** Visible version-badge text, shown only past v1 (contains `{version}`). */
    readonly versionBadge: string;
    /** Accessible name for the version badge (contains `{version}`). */
    readonly versionLabel: string;
    /** Visibility-badge text for a public recipe. */
    readonly visibilityPublic: string;
    /** Visibility-badge text for a private recipe. */
    readonly visibilityPrivate: string;
    /** Accessible name for the badges footer region. */
    readonly badgesLabel: string;
    /** Label for the recipe-source (provenance) region — where an imported recipe came from. */
    readonly sourceHeading: string;
    /** Accessible name for the serving-count input/readout of the scaling control. */
    readonly servingsAdjustLabel: string;
    /** Accessible name for the "one fewer serving" control. */
    readonly servingsDecrease: string;
    /** Accessible name for the "one more serving" control. */
    readonly servingsIncrease: string;
    /** Notice shown while the view is scaled away from the recipe's own yield (contains `{original}`). */
    readonly scaledNotice: string;
    /**
     * The SAFETY disclosure that rides with {@link scaledNotice}: cook times and step timers are shown
     * unscaled, because thermal cooking time is not proportional to batch size.
     */
    readonly scaledTimingCaveat: string;
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
    /*
     * ⛔ NO `caloriesLabel` here any more (deferred calorie lookup). The card no longer renders a calorie
     * line of its own — the figure arrives after the card through the `nutrition` SLOT — so this key had no
     * consumer and duplicated `nutrition/messages.ts`'s `calories` verbatim. Two authoritative spellings of
     * one string, one of them unreachable. The nutrition module owns the calorie copy.
     */
    /** Visible version-badge text, shown only past v1 (contains `{version}`). */
    readonly versionBadge: string;
    /** Accessible name for the version badge (contains `{version}`). */
    readonly versionLabel: string;
    /** Visibility-badge text for a public recipe. */
    readonly visibilityPublic: string;
    /** Visibility-badge text for a private recipe. */
    readonly visibilityPrivate: string;
    /** Badge shown on the owner's own draft — REPLACES the visibility badge (never "Public" on a draft). */
    readonly draftBadge: string;
    /** Relative-timestamp template for a revised recipe (contains `{time}`), e.g. "Edited 2d ago" (CR-002). */
    readonly editedRelative: string;
    /** Relative-timestamp template for a never-revised recipe (contains `{time}`), e.g. "Created 1w ago". */
    readonly createdRelative: string;
    /** Localized term rendered in place of `{time}` for a sub-minute-old (or future) instant. */
    readonly justNow: string;
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
            emptyCommunityTitle: 'No community recipes',
            emptyCommunityBody: 'There are no public recipes to explore yet. Check back soon.',
            noMatchTitle: 'No matching recipes',
            noMatchBody: 'No recipes match your search. Try a different term.',
            createCta: 'New recipe',
            emptyCreateCta: 'Create your first recipe',
            tabMine: 'My Recipes',
            tabCommunity: 'Community',
            tabsLabel: 'Recipe source',
            filtersLabel: 'Quick filters',
            filterAll: 'All',
            filterQuick: 'Quick (<30m)',
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
            photoOpen: 'Open {title} photo {index} full screen',
            photoDotsLabel: 'Photo navigation',
            photoDot: 'Go to {title} photo {index}',
            lightboxClose: 'Close photo',
            ingredientsHeading: 'Ingredients',
            userEnteredBadge: 'Custom',
            needsReviewBadge: 'Needs review',
            needsReviewNoticeOne:
                'One ingredient didn’t match its original wording, so it isn’t counted here. Check it and pick the right food.',
            needsReviewNoticeMany:
                '{count} ingredients didn’t match their original wording, so they aren’t counted here. Check them and pick the right foods.',
            instructionsHeading: 'Instructions',
            stepTimer: '{seconds}s timer',
            stepToggleLabel: 'Mark step {step} complete',
            tagFilterLabel: 'Find recipes tagged {tag}',
            nutritionHeading: 'Nutrition (per serving)',
            nutritionPartial: 'Estimated — some items aren’t counted yet',
            nutritionRangeDerivedLow: 'Estimated from the lower amount of each stated range',
            nutritionRangeDerivedHigh: 'Estimated from the upper amount of each stated range',
            nutritionSourceNote: 'Nutrition includes USDA database items; user-entered ingredients are marked Custom.',
            caloriesLabel: 'Calories',
            proteinLabel: 'Protein',
            carbsLabel: 'Carbs',
            fatLabel: 'Fat',
            gramsUnit: '{grams} g',
            versionBadge: 'v{version}',
            versionLabel: 'Version {version}',
            visibilityPublic: 'Public',
            visibilityPrivate: 'Private',
            badgesLabel: 'Recipe status',
            sourceHeading: 'Source',
            servingsAdjustLabel: 'Servings',
            servingsDecrease: 'Fewer servings',
            servingsIncrease: 'More servings',
            scaledNotice: 'Adjusted from {original} servings — ingredient amounts and prep time are scaled.',
            scaledTimingCaveat:
                'Cook times and step timers are shown unchanged: cooking time does not scale with batch size. Check for doneness.',
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
            versionBadge: 'v{version}',
            versionLabel: 'Version {version}',
            visibilityPublic: 'Public',
            visibilityPrivate: 'Private',
            draftBadge: 'Draft',
            editedRelative: 'Edited {time}',
            createdRelative: 'Created {time}',
            justNow: 'just now',
        },
    },
};
