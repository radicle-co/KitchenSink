/**
 * @module @commise/features-recipes/form — the trailing add row as an entry field: the combobox props both leaves render
 * after the last line, in place of the Add ingredient button (plan 002 V1 B8; `docs/design/rowEditorOpenDecisions.md`
 * items 1 and 3; `docs/design/ingredientStatusExplanation.md` §4 and §4b).
 *
 * The cook types, picks, and the line appends; the field empties and keeps focus (§2d, the F1 loop). Its text lives in
 * the hoisted entry (`useIngredientEntry`) as the `newLine` target, never in the draft, so nothing enters the draft
 * until a pick (U28). What the list holds and says is `entryCombobox.ts`'s; its list alone ends with Create my own food
 * (owner ruling 2026-10-02, answering item 1's O3). A platform adds only its own mechanism: the leading glyph, and
 * native's clear button.
 *
 * Pure: the returned handlers call the entry and the host's callbacks, and do nothing else.
 *
 * @pattern Presentation Model — the trailing row's entry wired to the combobox's props
 */
import type { ComboboxProps } from '@commise/ui/combobox';

import type { LineCommitTarget } from '../hooks/lineCommit.js';
import type { IngredientEntry } from '../hooks/useIngredientEntry.js';
import { fillTemplate } from '../list/model.js';
import { entryComboboxOf, type EntryComboboxCopy } from './entryCombobox.js';
import type { RecipeFormMessages } from './messages.js';
import type { SourceNaming } from './progressiveNotes.js';
import { chooseEntryOption } from './rowEntryField.js';

/** The copy the trailing field reads, already localised. */
export interface TrailingEntryFieldCopy extends EntryComboboxCopy {
    readonly form: EntryComboboxCopy['form'] &
        Pick<RecipeFormMessages, 'addIngredientRowLabel' | 'ingredientSuggestionsLabel' | 'ingredientNameEditableHint'>;
}

/** The trailing field, as its host sees it. */
export interface TrailingEntryFieldInput {
    readonly entry: IngredientEntry;
    /** The number the next line takes: the list is named for the ingredient it will add. */
    readonly nextNumber: number;
    /** The field holds text a save refused. */
    readonly invalid: boolean;
    /** A pick on the trailing row that did not take, already worded; said assertively. */
    readonly pickFailure: string | undefined;
    /** Native: the sentence a refusal pointed at, said assertively (`EntryComboboxInput.refusal`). */
    readonly refusal: string | undefined;
    /** Web: the id of an element that describes the field (its pending sentence, its failure). */
    readonly describedBy: string | undefined;
    readonly focusRequested: boolean;
    /** With the focus request: open the list too, because a refusal points at this field (R7). */
    readonly listRequested: boolean;
    /** The refusals said in this field's alert (native, R8). */
    readonly refusalOccurrence: number;
    readonly onFocusRequestHandled: () => void;
    /** The cook typed or cleared the field (a failed pick's message is then stale). */
    readonly onTextChange: () => void;
    /** Create my own food was chosen, on the field's trimmed text. */
    readonly onCreateOwnFood: (text: string) => void;
    /** How the row names a remote source and says a time and a list (`useSourceNaming`). */
    readonly naming: SourceNaming;
    /** The remote picks the session's limit refused (`IngredientRowEditor.limitRefusals`): each says it again (R8). */
    readonly limitRefusals: number;
}

/** The combobox props the leaves spread, less the platform's own mechanism. */
export type TrailingEntryFieldProps = Omit<ComboboxProps, 'clear' | 'leadingIcon'>;

const TRAILING: LineCommitTarget = { kind: 'newLine' };

/**
 * The combobox props for the trailing add row. Pure.
 *
 * @param input - The entry and the host's callbacks.
 * @param copy - The localised copy.
 * @returns The props.
 */
export const trailingEntryFieldOf = (
    input: TrailingEntryFieldInput,
    copy: TrailingEntryFieldCopy,
): TrailingEntryFieldProps => {
    const { entry } = input;
    const text = entry.textOf(TRAILING);
    const view = entryComboboxOf(
        {
            active: entry.isActive(TRAILING),
            text,
            view: entry.view,
            databaseSaidEarly: entry.databaseSaidEarly,
            pickFailure: input.pickFailure,
            refusal: input.refusal,
            offersCreateOwnFood: true,
            ...input.naming,
        },
        copy,
    );

    return {
        label: copy.form.addIngredientRowLabel,
        listLabel: fillTemplate(copy.form.ingredientSuggestionsLabel, { number: input.nextNumber }),
        placeholder: copy.form.addIngredientRowLabel,
        value: text,
        onValueChange: (next) => {
            input.onTextChange();
            entry.setText(TRAILING, next);
        },
        groups: view.groups,
        ...(view.status === undefined ? {} : { status: view.status }),
        trailingStatus: view.trailingStatus,
        onSelect: (key) =>
            chooseEntryOption(view.optionFor(key), entry, text, { onCreateOwnFood: input.onCreateOwnFood }),
        countAnnouncement: view.countAnnouncement,
        alertAnnouncement: view.alertAnnouncement,
        onFocus: () => entry.focus(TRAILING),
        // Item 4: Escape with the list closed abandons the entry; on the trailing row that clears the text.
        onAbandon: () => {
            input.onTextChange();
            entry.abandon(TRAILING);
        },
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
