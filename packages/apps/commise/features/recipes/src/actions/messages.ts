/**
 * @module @commise/features-recipes/actions/messages — user-facing copy for the recipe-action cluster.
 *
 * Shared, platform-neutral strings for the recipe-action building blocks (T068 delete dialog, T074
 * visibility toggle), exported once and consumed by BOTH the web `.tsx` and native
 * `.native.tsx` leaves (via `useMessages`), so the platforms cannot drift on copy. Mirrors the shape of the
 * feature's shared `../messages.ts`; the `en` set is required and adding a locale is just another key.
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { PrivateRefusal } from './privateGate.js';

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

/**
 * Copy for the confirm a cook sees before a private recipe goes public (UX SPECIFY 2026-10-15, amended by owner ruling
 * 2026-10-26 / ADR-0073). The body states the cost plainly and per reason (`recipeMakePublicConsequence`), describes public
 * recipes in general (a public DRAFT is still the owner's alone), and offers nothing to buy: two verbs, no third choice.
 *
 * ⛔ Public is NEVER final, so there is no "you won't be able to" body: going public frees a private slot, and a free slot
 * is all it takes to make the recipe private again.
 */
interface RecipeMakePublicDialogMessages {
    readonly title: string;
    /** A free cook's recipe going public: it frees one of their private slots. */
    readonly bodyFrees: string;
    /** An imported public-web recipe under the upsell, where Premium is still the rule. */
    readonly bodyPremium: string;
    readonly confirm: string;
    /** The safe action; focus opens on it. */
    readonly keep: string;
    /** Said politely while the recipe page's change is in flight. */
    readonly busy: string;
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
    /**
     * In place of `error` when a Private is refused (`visibilityNoticeOf`): the server refused it as `INVALID_VISIBILITY`
     * (`useServerRefusedPrivate`), or the editor withheld it because the server would. Trying again cannot succeed, so it
     * is not offered. `premium` under the upsell; otherwise `final`.
     */
    readonly privateRefused: Readonly<Record<PrivateRefusal, string>>;
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
    /** Copy for the make-public confirm. */
    readonly makePublicDialog: RecipeMakePublicDialogMessages;
    /** Copy for the visibility toggle. */
    readonly visibility: RecipeVisibilityToggleMessages;
    /** Copy for the "More" overflow menu. */
    readonly moreMenu: RecipeMoreMenuMessages;
    /** Copy for saving a copy of another cook's recipe from a Discover card (build spec §4.1). */
    readonly saveCopy: RecipeSaveCopyMessages;
    /** Copy for the recipe page's action row and ⋯ menu (build spec §6.1, §6.4). */
    readonly detailActions: RecipeDetailActionMessages;
    /** Copy for the Premium sheet "Private" opens for a free-tier cook (build spec §6.4, §7.7). */
    readonly upsell: RecipeUpsellMessages;
    /** Copy for the refusal of a copy that would be private when every private slot is in use. */
    readonly cloneNoSlot: RecipeCloneNoSlotMessages;
}

/**
 * Saving a copy refused for want of a private slot (ADR-0073; redesign canvas v44, `RecipeSaveCopyNoSlot`). The body comes
 * in two whole strings, with and without the Premium sentence: where paid features are hidden nothing sells (DSA Art. 25),
 * and a sentence is never sliced or joined at run time.
 */
export interface RecipeCloneNoSlotMessages {
    readonly title: string;
    /** `{total}` is the server's limit. Ends with the Premium sentence. */
    readonly body: string;
    /** `{total}` is the server's limit. No Premium sentence. */
    readonly bodyNoPremium: string;
    readonly notNow: string;
    readonly seePremium: string;
    /** The single action where paid features are hidden. */
    readonly ok: string;
    /** The sheet's Close control name. */
    readonly close: string;
}

/** One variant of the Premium sheet: its title and the plain fact under it. */
export interface RecipeUpsellVariantMessages {
    readonly title: string;
    readonly body: string;
}

/** The Premium sheet for "Private": the plain fact, then two equal choices (DSA Art. 25). */
export interface RecipeUpsellMessages {
    /** A full set of private slots (`{total}` is the server's limit): how to free one, and that Premium has no limit. */
    readonly noSlot: RecipeUpsellVariantMessages;
    /** An imported public-web recipe, where Premium and a change of the cook's own are still the rule. */
    readonly webImport: RecipeUpsellVariantMessages;
    readonly seePremium: string;
    readonly notNow: string;
    /** The sheet's Close control name. */
    readonly close: string;
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
    /**
     * Why Delete cannot be used while a write of the recipe is on the wire (owner ruling 2026-10-17, "Don't allow users to
     * delete while saving"). Said by the menu item and the open confirm.
     */
    readonly saving: string;
    readonly versionHistory: string;
    readonly makePrivate: string;
    readonly makePublic: string;
    /** Resets the cook's checks and current step; offered only while one is set. */
    readonly clearChecks: string;
    readonly deleteRecipe: string;
    /** The snackbar on the screen the cook lands on after a delete (owner 2026-10-13). */
    readonly recipeDeleted: string;
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
        makePublicDialog: {
            title: 'Make this recipe public?',
            bodyFrees:
                'Anyone can see a public recipe and save a copy. It frees one of your private slots, and you can make it private again while you have a free slot.',
            bodyPremium:
                "Anyone can see a public recipe and save a copy. To make this one private again, you'll need Premium.",
            confirm: 'Make public',
            keep: 'Keep private',
            busy: 'Making public…',
        },
        visibility: {
            groupLabel: 'Recipe visibility',
            publicLabel: 'Public',
            privateLabel: 'Private',
            error: 'We couldn’t change who can see this recipe. Please try again.',
            privateRefused: {
                final: 'This recipe is still public: it couldn’t be made private.',
                premium: 'This recipe is still public. Private recipes are part of Premium.',
                // `recipe.visibility.slotsFull`: the editor board's words, now the recipe page's too. `{total}` is the SERVER's
                // limit (`visibilityNoticeOf` fills it); this package states no number of its own.
                slots: 'Not available. All {total} of your private slots are in use.',
            },
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
            saving: 'Saving…',
            versionHistory: 'Version history',
            makePrivate: 'Make private',
            makePublic: 'Make public',
            clearChecks: 'Clear checks',
            deleteRecipe: 'Delete recipe',
            recipeDeleted: 'Recipe deleted',
            backToRecipes: 'My recipes',
        },
        upsell: {
            noSlot: {
                title: 'Keep more recipes private',
                body: 'All {total} of your private slots are in use. Premium has no limit. To free a slot, make a private recipe public or delete one.',
            },
            webImport: {
                title: 'Private needs Premium for this recipe',
                body: 'This recipe is from a public web page. To keep it private, you need Premium and a change of your own to the recipe.',
            },
            seePremium: 'See Premium',
            notNow: 'Not now',
            close: 'Close',
        },
        cloneNoSlot: {
            title: 'No private slot for this copy',
            body: 'This copy would be private, and all {total} of your private slots are in use. To free a slot, make a private recipe public or delete one. Premium has no limit.',
            bodyNoPremium:
                'This copy would be private, and all {total} of your private slots are in use. To free a slot, make a private recipe public or delete one.',
            notNow: 'Not now',
            seePremium: 'See Premium',
            ok: 'OK',
            close: 'Close',
        },
    },
};
