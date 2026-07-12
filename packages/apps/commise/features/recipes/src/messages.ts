/**
 * @module @commise/features-recipes/messages — user-facing copy for the recipe feature.
 *
 * Shared, platform-neutral strings live here, exported once and consumed by BOTH the web `.tsx` and the
 * mobile `.native.tsx` leaves, so the two platforms cannot drift on copy. This is the localization seam:
 * a per-locale dictionary resolves to this shape, and today it holds the single default-locale set.
 * Strings specific to the web or mobile app stay in those apps and are handled per platform.
 */
export const recipeMessages = {
    /** Title of the recent-recipes Home widget card. */
    widgetTitle: 'Recent recipes',
    /** Empty state shown in the live recipe widget when the viewer has no recipes yet. */
    emptyState: 'No recipes yet. Create your first recipe to see it here.',
} as const;
