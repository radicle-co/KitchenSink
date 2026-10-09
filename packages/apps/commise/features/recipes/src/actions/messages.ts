/**
 * @module @commise/features-recipes/actions/messages — user-facing copy for the recipe-action cluster.
 *
 * Shared, platform-neutral strings for the recipe-action building blocks (T068 delete dialog, T074
 * visibility toggle), exported once and consumed by BOTH the web `.tsx` and native
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
    /** Copy for the "More" overflow menu. */
    readonly moreMenu: RecipeMoreMenuMessages;
    /** Copy for saving a copy of another cook's recipe from a Discover card (build spec §4.1). */
    readonly saveCopy: RecipeSaveCopyMessages;
    /** Copy for the recipe page's action row and ⋯ menu (build spec §6.1, §6.4). */
    readonly detailActions: RecipeDetailActionMessages;
}

/** Saving a copy from a card: the control's names, the snackbar that follows, and the failure (build spec §4.1). */
export interface RecipeSaveCopyMessages {
    /** The idle control's accessible name (contains `{title}`, so each card's control is uniquely named). */
    readonly button: string;
    /** The control's name while the copy is being made (contains `{title}`). */
    readonly saving: string;
    /** The control's name once the copy exists (contains `{title}`). */
    readonly done: string;
    /** The snackbar that follows a saved copy. */
    readonly snackbar: string;
    /** The snackbar's action: opens the copy in the editor. */
    readonly edit: string;
    /** The inline alert when saving a copy failed. */
    readonly failed: string;
}

/** The recipe page's action row and ⋯ menu (build spec §6.1, §6.4). */
export interface RecipeDetailActionMessages {
    /** The owner's primary. */
    readonly editRecipe: string;
    /** Another cook's primary ("Clone" is retired by the glossary). */
    readonly saveCopy: string;
    /** Said while the copy is being made. */
    readonly savingCopy: string;
    readonly versionHistory: string;
    readonly makePrivate: string;
    readonly makePublic: string;
    /** Resets the cook's checks and current step; offered only while one is set. */
    readonly clearChecks: string;
    readonly deleteRecipe: string;
    /** The back link above the meta line. */
    readonly backToRecipes: string;
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
        moreMenu: {
            triggerFor: 'More actions for {title}',
            title: 'More actions',
            close: 'Close more actions',
        },
        saveCopy: {
            button: 'Save a copy of {title}',
            saving: 'Saving a copy of {title}',
            done: 'Saved a copy of {title}',
            snackbar: 'Saved a copy to My recipes.',
            edit: 'Edit',
            failed: 'Couldn’t save a copy. Try again.',
        },
        detailActions: {
            editRecipe: 'Edit recipe',
            saveCopy: 'Save a copy',
            savingCopy: 'Saving a copy…',
            versionHistory: 'Version history',
            makePrivate: 'Make private',
            makePublic: 'Make public',
            clearChecks: 'Clear checks',
            deleteRecipe: 'Delete recipe',
            backToRecipes: 'My recipes',
        },
    },
};
