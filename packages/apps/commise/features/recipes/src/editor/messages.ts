/**
 * @module @commise/features-recipes/editor/messages — the one-page editor's copy (`docs/design/uiOverhaul/buildSpec.md`
 * §7.2, §7.3, §7.6–§7.8, §7.11), consumed by the web and native editor leaves through `useMessages`, so the two
 * platforms cannot drift.
 *
 * Copy not in the build spec was written by `staff-ux-engineer` for slice 7: the save status for each place a draft can
 * be kept (`disk` says "on this device", `tabSession` says "in this tab", D7), the parked-write alerts, the section
 * reasons and the announcements. A count is a `{ one, other }` pair with `{count}`, chosen through `Intl.PluralRules`
 * (`pluralOf`), the way every count in this package is.
 */
import type { LocalizedMessages } from '@commise/i18n';

import type { EditorSectionId } from './sections.js';
import type { AttentionReason, InProgressReason } from './sectionStatus.js';

/** A count's two English forms, each holding `{count}`. */
export interface PluralText {
    readonly one: string;
    readonly other: string;
}

/** The editor's copy. */
export interface EditorMessages {
    /** The header title (the visible H1) for a new recipe. */
    readonly titleCreate: string;
    /** The header title for an existing recipe. */
    readonly titleEdit: string;
    /** × — leaves the editor; it never asks, because nothing is lost. */
    readonly close: string;
    /** ⋯ — the editor's menu. */
    readonly more: string;
    readonly preview: string;
    readonly previewBanner: string;
    readonly previewClose: string;
    readonly publish: string;
    readonly saveChanges: string;
    /** The action bar's polite line after a refused Publish. */
    readonly fixCount: PluralText;
    readonly ready: string;
    readonly published: string;
    readonly addToCollection: string;
    readonly changesSaved: string;
    readonly actionBarLabel: string;

    readonly index: {
        readonly label: string;
        readonly sheetTitle: string;
        /** The phone sheet's close control. */
        readonly sheetClose: string;
        readonly sections: Readonly<Record<EditorSectionId, string>>;
        /** The strip's short label for Photos & publish. */
        readonly photosShort: string;
        readonly status: {
            readonly fix: PluralText;
            readonly notStarted: string;
            readonly optional: string;
            readonly ready: string;
            readonly startHere: string;
            /** Spoken only, for a quiet complete section (its ✓ shows no words). */
            readonly complete: string;
        };
        /** Needs attention (counted) and in-progress reasons, by the reason the status names. */
        readonly reason: Readonly<
            Record<Exclude<AttentionReason, 'ingredientsUnresolved' | 'ingredientsQuantityInvalid'>, string>
        > & {
            readonly ingredientsUnresolved: PluralText;
            readonly ingredientsQuantityInvalid: PluralText;
        } & Readonly<Record<InProgressReason, string>>;
        /** Guided progress: "{done} of 4 done". */
        readonly done: string;
        /** The guided hint under each section's label, for a first recipe. */
        readonly hint: Readonly<Record<EditorSectionId, string>>;
        /** The phone bar's accessible name: "Sections. Current: {current}." */
        readonly barName: string;
        /** Appended to the bar's name when something needs action. */
        readonly barNameAttention: PluralText;
        /** Appended to the bar's name for a first recipe: " {done} of 4 done." */
        readonly barNameDone: string;
        /** The bar's visible end text: "⚠ {count}". */
        readonly barCount: string;
        /** The bar's visible guided suffix: " · {done} of 4 done". */
        readonly barDone: string;
        /** Announced politely when the cook's own edit completes a section. */
        readonly announce: Readonly<Record<EditorSectionId, string>>;
    };

    /** Save status (header caption). Keyed by where the draft is kept where that changes the words. */
    readonly status: {
        readonly saving: string;
        readonly saved: string;
        readonly savedOnDevice: string;
        readonly savedInTab: string;
        readonly changesOnDevice: string;
        readonly changesInTab: string;
        readonly deviceFailed: string;
        readonly tabFailed: string;
        readonly saveFailed: string;
        readonly conflict: string;
        readonly notSaved: string;
        readonly unconfirmed: string;
    };

    /** The published recipe's resume notice. */
    readonly resume: { readonly body: string; readonly save: string; readonly discard: string };

    readonly discard: {
        readonly menuDraft: string;
        readonly menuChanges: string;
        readonly draftTitle: string;
        readonly draftBody: string;
        readonly changesTitle: string;
        readonly changesBody: string;
        readonly confirm: string;
        readonly keep: string;
    };

    /** The inline alert above the action bar for a parked write. */
    readonly failure: {
        readonly terminalBody: string;
        readonly terminalBodyTab: string;
        readonly retry: string;
        readonly unknownBody: string;
        readonly saveAgain: string;
        readonly createUnknownBody: string;
        readonly openMyRecipes: string;
    };

    readonly details: { readonly titleLimit: string; readonly titleCounter: string };

    /** The Ingredients section's add field and its Paste a list sheet (build spec §7.5.3, §7.5.4, §7.11). */
    readonly ingredients: {
        readonly addLabel: string;
        readonly addHint: string;
        /** Under the add field after Enter with no option active: no line is ever stored as free text. */
        readonly pickFood: string;
        /**
         * The live reading's spoken parts, joined with commas: "Amount 2, unit tablespoon, food olive oil, preparation
         * for frying." Four templates rather than §7.11's one sentence, so a reading that states no unit or no
         * preparation names only what it states.
         */
        readonly reading: {
            readonly amount: string;
            readonly unit: string;
            readonly food: string;
            readonly prep: string;
        };
        readonly pasteList: string;
        readonly pasteTitle: string;
        readonly pasteLabel: string;
        readonly pasteHint: string;
        /** The live line count under the text area. */
        readonly pasteCount: PluralText;
        readonly pasteAdd: PluralText;
        readonly pasteCancel: string;
        /** Said politely once the pasted lines are in the list. */
        readonly pasteAdded: PluralText;
        /**
         * The paste could not start (offline included: the job is a write that cannot wait, blueprint A5).
         */
        readonly pasteFailed: string;
        readonly addToGroup: string;
    };

    readonly steps: {
        readonly label: string;
        readonly addTimer: string;
        readonly removeTimer: string;
        readonly timerLabel: string;
        readonly add: string;
        readonly paste: string;
        readonly pasteTitle: string;
        readonly pasteLabel: string;
        readonly pasteHint: string;
        readonly pasteAdd: PluralText;
        readonly pasteCancel: string;
        readonly empty: string;
        readonly required: string;
        readonly actions: string;
        readonly moveUp: string;
        readonly moveDown: string;
        readonly remove: string;
    };

    readonly photos: { readonly add: string; readonly cover: string; readonly empty: string };

    readonly visibility: {
        readonly legend: string;
        readonly public: string;
        readonly publicHint: string;
        readonly private: string;
        readonly privateHint: string;
    };
}

export const editorMessages: LocalizedMessages<EditorMessages> = {
    en: {
        titleCreate: 'New recipe',
        titleEdit: 'Edit recipe',
        close: 'Close editor',
        more: 'More editor actions',
        preview: 'Preview',
        previewBanner: 'Preview. This is how it looks to others.',
        previewClose: 'Close preview',
        publish: 'Publish',
        saveChanges: 'Save changes',
        fixCount: { one: 'Fix {count} thing to publish', other: 'Fix {count} things to publish' },
        ready: 'Ready to publish.',
        published: 'Recipe published.',
        addToCollection: 'Add to a collection',
        changesSaved: 'Changes saved.',
        actionBarLabel: 'Recipe actions',

        index: {
            label: 'Recipe sections',
            sheetTitle: 'Sections',
            sheetClose: 'Close sections',
            sections: {
                details: 'Details',
                ingredients: 'Ingredients',
                steps: 'Steps',
                photos: 'Photos & publish',
            },
            photosShort: 'Photos',
            status: {
                fix: { one: 'Fix {count} thing', other: 'Fix {count} things' },
                notStarted: 'Not started',
                optional: 'Optional',
                ready: 'Ready to publish',
                startHere: 'Start here',
                complete: 'Complete',
            },
            reason: {
                titleRequired: 'Title needed',
                titleTooLong: 'Title too long',
                titleTooLongToSave: 'Title too long to save',
                ingredientsPendingText: 'Add or clear the line you typed',
                ingredientsUnresolved: { one: '{count} needs a match', other: '{count} need a match' },
                ingredientsQuantityInvalid: { one: '{count} amount to fix', other: '{count} amounts to fix' },
                stepBlank: 'Fill in or remove the empty step',
                servingsPositive: 'Servings must be more than 0',
                timesNonNegative: "Times can't be negative",
            },
            done: '{done} of 4 done',
            hint: {
                details: 'Name it and say how long it takes',
                ingredients: 'Add what goes in',
                steps: 'Say how to make it',
                photos: 'Add a photo, then publish',
            },
            barName: 'Sections. Current: {current}.',
            barNameAttention: { one: ' {count} needs attention.', other: ' {count} need attention.' },
            barNameDone: ' {done} of 4 done.',
            barCount: '⚠ {count}',
            barDone: ' · {done} of 4 done',
            announce: {
                details: 'Details complete',
                ingredients: 'Ingredients complete',
                steps: 'Steps complete',
                photos: 'Photos and publish ready',
            },
        },

        status: {
            saving: 'Saving…',
            saved: 'Saved',
            savedOnDevice: 'Saved on this device',
            savedInTab: 'Saved in this tab',
            changesOnDevice: 'Changes saved on this device',
            changesInTab: 'Changes kept in this tab',
            deviceFailed: "Couldn't save on this device",
            tabFailed: "Couldn't save in this tab",
            saveFailed: "Couldn't save. Retrying.",
            conflict: 'Not saved. Choose a version.',
            notSaved: "Couldn't save",
            unconfirmed: "Couldn't confirm your save",
        },

        resume: {
            body: "You have changes from {time} that aren't saved to your recipe.",
            save: 'Save changes',
            discard: 'Discard',
        },

        discard: {
            menuDraft: 'Discard draft',
            menuChanges: 'Discard changes',
            draftTitle: 'Discard this draft?',
            draftBody: "The recipe and everything in it will be deleted. This can't be undone.",
            changesTitle: 'Discard your changes?',
            changesBody: 'Your recipe stays as it was when you last saved it.',
            confirm: 'Discard',
            keep: 'Keep editing',
        },

        failure: {
            terminalBody: "We couldn't save your latest changes. They're kept on this device.",
            terminalBodyTab: "We couldn't save your latest changes. They're kept in this tab.",
            retry: 'Try again',
            unknownBody: "We couldn't tell if your changes were saved.",
            saveAgain: 'Save again',
            createUnknownBody:
                "We couldn't tell if your recipe was saved. Check My recipes before you save again, or you may get two copies.",
            openMyRecipes: 'Check My recipes',
        },

        details: {
            titleLimit: 'Shorten the title to 120 characters or fewer.',
            titleCounter: '{count}/{max}',
        },

        ingredients: {
            addLabel: 'Add an ingredient',
            addHint: 'Type the amount first, then pick the food. For example: 2 tbsp olive oil.',
            pickFood: 'Pick a food from the list.',
            reading: {
                amount: 'Amount {amount}',
                unit: 'unit {unit}',
                food: 'food {food}',
                prep: 'preparation {prep}',
            },
            pasteList: 'Paste a list',
            pasteTitle: 'Paste a list',
            pasteLabel: 'Ingredient lines',
            pasteHint: 'One ingredient per line. You can add the steps next.',
            pasteCount: { one: '{count} line', other: '{count} lines' },
            pasteAdd: { one: 'Add {count} ingredient', other: 'Add {count} ingredients' },
            pasteCancel: 'Cancel',
            pasteAdded: { one: 'Added {count} ingredient.', other: 'Added {count} ingredients.' },
            pasteFailed: 'We couldn’t start reading that. Your text is still here — try again.',
            addToGroup: 'Add to {group}',
        },

        steps: {
            label: 'Step {n}',
            addTimer: 'Add a timer',
            removeTimer: 'Remove timer',
            timerLabel: 'Timer',
            add: 'Add step',
            paste: 'Paste steps',
            pasteTitle: 'Paste steps',
            pasteLabel: 'Steps',
            pasteHint: 'Put a blank line between steps, or number them.',
            pasteAdd: { one: 'Add {count} step', other: 'Add {count} steps' },
            pasteCancel: 'Cancel',
            empty: 'No steps yet.',
            required: 'Add at least one step.',
            actions: 'Actions for step {n}',
            moveUp: 'Move up',
            moveDown: 'Move down',
            remove: 'Remove step',
        },

        photos: {
            add: 'Add photos',
            cover: 'Cover',
            empty: 'No photo? This cover is used instead. Add one any time.',
        },

        visibility: {
            legend: 'Who can see it',
            public: 'Public',
            publicHint: 'Anyone can find it in Discover',
            private: 'Private',
            privateHint: 'Only you can see it',
        },
    },
};

/**
 * A count's localized text: the `one` or `other` form, with `{count}` filled in.
 *
 * @param text - The two forms.
 * @param count - The count.
 * @param locale - The active locale.
 * @returns The text. Pure.
 */
export function pluralOf(text: PluralText, count: number, locale: string): string {
    const form = new Intl.PluralRules(locale).select(count) === 'one' ? text.one : text.other;

    return form.replaceAll('{count}', String(count));
}
