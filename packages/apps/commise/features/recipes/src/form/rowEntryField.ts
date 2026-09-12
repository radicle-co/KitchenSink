/**
 * @module @commise/features-recipes/form — an editor row's name as an entry field: the combobox props both row leaves
 * render for SPECIFY.1 rows 1 and 2 and for a row in Change food (`docs/design/ingredientStatusExplanation.md` §2a, §2d;
 * `docs/design/rowEditorOpenDecisions.md` items 1, 4 and 5).
 *
 * The field's text lives in the hoisted entry (`useIngredientEntry`), never in the draft, so typing changes no line
 * (§4b); a choice goes to the entry, which commits it through the host's port. What the list holds and says is
 * `entryCombobox.ts`'s. A platform adds only its own mechanism: native's clear button.
 *
 * Pure: the returned handlers call the entry and the row's callbacks, and do nothing else.
 *
 * @pattern Presentation Model — one row's entry wired to the combobox's props
 */
import type { ComboboxProps } from '@commise/ui/combobox';

import type { LineCommitTarget } from '../hooks/lineCommit.js';
import type { IngredientEntry } from '../hooks/useIngredientEntry.js';
import { fillTemplate } from '../list/model.js';
import { entryComboboxOf, type EntryComboboxCopy, type EntryOption } from './entryCombobox.js';
import type { RecipeFormMessages } from './messages.js';
import type { SourceNaming } from './progressiveNotes.js';

/** The copy the field reads, already localised. */
export interface RowEntryFieldCopy extends EntryComboboxCopy {
    readonly form: EntryComboboxCopy['form'] &
        Pick<
            RecipeFormMessages,
            | 'ingredientNameLabel'
            | 'ingredientSuggestionsLabel'
            | 'ingredientNameEditableHint'
            | 'ingredientEntryCancel'
            | 'ingredientEntryCancelLabel'
        >;
}

/** One row's entry field. */
export interface RowEntryFieldInput {
    readonly target: LineCommitTarget & { readonly kind: 'line' };
    /** The row's 1-based number, which names its controls. */
    readonly number: number;
    readonly entry: IngredientEntry;
    /** The row is in Change food: it has `Cancel`, never a clear button (item 4). */
    readonly changing: boolean;
    /** The food the line still uses: `Cancel` says it keeps it. */
    readonly food: string;
    /** The field is marked invalid: the row names no food, or it holds text a save refused. */
    readonly invalid: boolean;
    /** A pick on this row that did not take, already worded by the row; said assertively. */
    readonly pickFailure: string | undefined;
    /** Native: the row sentence a refusal pointed at, fixed when it was made (`EntryComboboxInput.refusal`). */
    readonly refusal: string | undefined;
    /** Web: the id of a row element that describes the field (its note or its pending sentence). */
    readonly describedBy: string | undefined;
    readonly focusRequested: boolean;
    /** With the focus request: open the list too, because a refusal points at this field (R7). */
    readonly listRequested: boolean;
    /**
     * The refusals that pointed at this field and were said in its alert (native, R7); each one says the sentence
     * again. Web passes `0`: there the sentence is the field's description.
     */
    readonly refusalOccurrence: number;
    readonly onFocusRequestHandled: () => void;
    /** `Cancel`: leave Change food. */
    readonly onCancel: () => void;
    /** Web: Escape with the list closed. */
    readonly onAbandon: () => void;
    /** The cook typed (a failed pick's message is then stale). */
    readonly onTextChange: () => void;
    /** How the row names a remote source and says a time and a list (`useSourceNaming`). */
    readonly naming: SourceNaming;
    /** The remote picks the session's limit refused (`IngredientRowEditor.limitRefusals`): each says it again (R8). */
    readonly limitRefusals: number;
}

/** What a field does beyond the entry's own actions when an option is chosen. */
export interface EntryChoiceHandlers {
    /** Create my own food was chosen, on the field's trimmed text. Only the trailing row's list offers it. */
    readonly onCreateOwnFood: (text: string) => void;
}

/**
 * Carry a chosen option to the entry action it stands for. Both entry fields, a row's and the trailing row's, choose
 * through this one switch.
 *
 * @param option - The chosen option, or `undefined` for a key the field did not list.
 * @param entry - The hoisted entry.
 * @param text - The field's text.
 * @param handlers - What the field adds.
 * @sideEffect Calls the entry action, or the field's handler, the option stands for.
 */
export function chooseEntryOption(
    option: EntryOption | undefined,
    entry: IngredientEntry,
    text: string,
    handlers: EntryChoiceHandlers,
): void {
    switch (option?.kind) {
        case undefined:
            return;
        case 'food':
            entry.selectFood(option.food);

            return;
        case 'remoteFood':
            entry.selectRemoteFood(option.food);

            return;
        case 'findByName':
            entry.findByName();

            return;
        case 'useAsWritten':
            entry.declareAsWritten();

            return;
        case 'createOwnFood':
            handlers.onCreateOwnFood(text.trim());
    }
}

/** The combobox props a row leaf spreads, less the platform's own mechanism. */
export type RowEntryFieldProps = Omit<ComboboxProps, 'clear' | 'placeholder'>;

/**
 * The combobox props for one row's entry field. Pure.
 *
 * @param input - The row, the entry and the row's callbacks.
 * @param copy - The localised copy.
 * @returns The props.
 */
export const rowEntryFieldOf = (input: RowEntryFieldInput, copy: RowEntryFieldCopy): RowEntryFieldProps => {
    const { target, entry } = input;
    const text = entry.textOf(target);
    const view = entryComboboxOf(
        {
            active: entry.isActive(target),
            text,
            view: entry.view,
            databaseSaidEarly: entry.databaseSaidEarly,
            pickFailure: input.pickFailure,
            refusal: input.refusal,
            offersCreateOwnFood: false,
            ...input.naming,
        },
        copy,
    );

    return {
        label: fillTemplate(copy.form.ingredientNameLabel, { number: input.number }),
        listLabel: fillTemplate(copy.form.ingredientSuggestionsLabel, { number: input.number }),
        value: text,
        onValueChange: (next) => {
            input.onTextChange();
            entry.setText(target, next);
        },
        groups: view.groups,
        ...(view.status === undefined ? {} : { status: view.status }),
        trailingStatus: view.trailingStatus,
        // A row's list never offers Create my own food: a line reaches it through its `⋮`.
        onSelect: (key) => chooseEntryOption(view.optionFor(key), entry, text, { onCreateOwnFood: () => undefined }),
        countAnnouncement: view.countAnnouncement,
        alertAnnouncement: view.alertAnnouncement,
        onFocus: () => entry.focus(target),
        onAbandon: input.onAbandon,
        ...(input.changing
            ? {
                  cancel: {
                      text: copy.form.ingredientEntryCancel,
                      name: fillTemplate(copy.form.ingredientEntryCancelLabel, { food: input.food }),
                      onPress: input.onCancel,
                  },
              }
            : {}),
        hint: copy.form.ingredientNameEditableHint,
        invalid: input.invalid,
        ...(input.describedBy === undefined ? {} : { describedBy: input.describedBy }),
        focusRequested: input.focusRequested,
        listRequested: input.listRequested,
        // R8: every remote pick the cook's limit refused, and every refusal said here, speaks the alert again.
        alertOccurrence: input.limitRefusals + input.refusalOccurrence,
        onFocusRequestHandled: input.onFocusRequestHandled,
    };
};
