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
    /** Label of the safe action, a verb naming what is kept (spec §6.5); focus opens on it. */
    readonly keep: string;
    /** Busy indicator shown while the delete is in flight. */
    readonly deletingLabel: string;
    /** Error shown inside the dialog when the delete fails, so it never silently stops (B17). */
    readonly error: string;
}

/** Copy for the public/private visibility toggle (T074). */
export interface RecipeVisibilityToggleMessages {
    /** Accessible group label for the toggle. */
    readonly groupLabel: string;
    /** Label for the public option. */
    readonly publicLabel: string;
    /** Label for the private option. */
    readonly privateLabel: string;
    /** Error shown when a visibility change fails and the toggle snaps back, so it never does so silently (B17). */
    readonly error: string;
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

/** Copy for the "More actions" overflow (C4) that groups the detail header's secondary owner actions. */
export interface RecipeMoreMenuMessages {
    /**
     * The `⋯` trigger's accessible name, naming the recipe (contains `{title}`; spec key `detail.moreActions`). A bare
     * "More" repeated down a list is unusable by voice control and a screen-reader rotor.
     */
    readonly triggerFor: string;
    /** The open panel's heading, which names it. */
    readonly title: string;
    /** The open panel's Close control name (house form "Close {thing}"). */
    readonly close: string;
}

/** The shape of the recipe-action cluster's shared copy. */
export interface RecipeActionMessages {
    /** Copy for the delete-confirmation dialog. */
    readonly deleteDialog: RecipeDeleteDialogMessages;
    /** Copy for the visibility toggle. */
    readonly visibility: RecipeVisibilityToggleMessages;
    /** Copy for the clone action. */
    readonly clone: RecipeCloneActionMessages;
    /** Copy for the "More" overflow menu. */
    readonly moreMenu: RecipeMoreMenuMessages;
}

export const recipeActionMessages: LocalizedMessages<RecipeActionMessages> = {
    en: {
        deleteDialog: {
            title: 'Delete this recipe?',
            body: '“{title}” and its version history will be deleted. You can’t undo this.',
            confirm: 'Delete recipe',
            keep: 'Keep recipe',
            deletingLabel: 'Deleting…',
            error: 'We couldn’t delete this recipe. Try again.',
        },
        visibility: {
            groupLabel: 'Recipe visibility',
            publicLabel: 'Public',
            privateLabel: 'Private',
            error: 'We couldn’t change who can see this recipe. Please try again.',
        },
        clone: {
            clone: 'Clone',
            cloningLabel: 'Cloning…',
            attribution: 'Cloned from {source}',
        },
        moreMenu: {
            triggerFor: 'More actions for {title}',
            title: 'More actions',
            close: 'Close more actions',
        },
    },
};
