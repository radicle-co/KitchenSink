/**
 * @module @commise/features-recipes/actions/messages — user-facing copy for the recipe-action cluster.
 *
 * Shared, platform-neutral strings for the recipe-action building blocks (T068 delete dialog, T074
 * visibility toggle, T075 clone action), exported once and consumed by BOTH the web `.tsx` and native
 * `.native.tsx` leaves (via `useMessages`), so the platforms cannot drift on copy. Mirrors the shape of the
 * feature's shared `../messages.ts`; the `en` set is required and adding a locale is just another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Copy for the delete-confirmation dialog (T068). */
export interface RecipeDeleteDialogMessages {
    /** Dialog title / accessible name. */
    readonly title: string;
    /** Confirmation body naming the recipe (contains `{title}`). */
    readonly body: string;
    /** Label of the destructive confirm action. */
    readonly confirm: string;
    /** Label of the dismiss action. */
    readonly cancel: string;
    /** Busy indicator shown while the delete is in flight. */
    readonly deletingLabel: string;
}

/** Copy for the public/private visibility toggle (T074). */
export interface RecipeVisibilityToggleMessages {
    /** Accessible group label for the toggle. */
    readonly groupLabel: string;
    /** Label for the public option. */
    readonly publicLabel: string;
    /** Label for the private option. */
    readonly privateLabel: string;
}

/** Copy for the clone action (T075). */
export interface RecipeCloneActionMessages {
    /** Label of the clone action (stable across the busy state). */
    readonly clone: string;
    /** Busy indicator shown while the clone is in flight. */
    readonly cloningLabel: string;
    /** Attribution line for a cloned/imported recipe (contains `{source}`). */
    readonly attribution: string;
}

/** The shape of the recipe-action cluster's shared copy. */
export interface RecipeActionMessages {
    /** Copy for the delete-confirmation dialog. */
    readonly deleteDialog: RecipeDeleteDialogMessages;
    /** Copy for the visibility toggle. */
    readonly visibility: RecipeVisibilityToggleMessages;
    /** Copy for the clone action. */
    readonly clone: RecipeCloneActionMessages;
}

export const recipeActionMessages: LocalizedMessages<RecipeActionMessages> = {
    en: {
        deleteDialog: {
            title: 'Delete recipe',
            body: 'Permanently delete “{title}”? This can’t be undone.',
            confirm: 'Delete',
            cancel: 'Cancel',
            deletingLabel: 'Deleting…',
        },
        visibility: {
            groupLabel: 'Recipe visibility',
            publicLabel: 'Public',
            privateLabel: 'Private',
        },
        clone: {
            clone: 'Clone',
            cloningLabel: 'Cloning…',
            attribution: 'Cloned from {source}',
        },
    },
};
