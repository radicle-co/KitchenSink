/**
 * @module @commise/features-recipes/form — what an editor row says once a pick on it settles. Success is polite and
 * lands with the list closed, in the row's own region (`docs/design/rowEditorOpenDecisions.md` R3). A failure the row
 * shows, and its combobox says assertively (items 1 and 4).
 *
 * A remote pick's own outcomes say what the S7 list contract's P8 names (`progressiveNotes.ts`), and its caption names
 * the source it adds from.
 *
 * Pure and platform-agnostic: both row leaves read it.
 *
 * @pattern Visitor — the binding's state picks the sentence
 */
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { DetailsDialogEntry } from '../details/detailsDialogMachine.js';
import type { IngredientPick, LineCommitTarget } from '../hooks/lineCommit.js';
import type { SettledRowCommit } from '../hooks/useIngredientRowEditor.js';
import { fillTemplate } from '../list/model.js';
import type { IngredientDetailsMessages, IngredientRemoteSearchMessages } from '../messages.js';
import type { LineBinding } from './lineBinding.js';
import type { RecipeFormMessages } from './messages.js';
import { remotePickFailureOf, sourceDisplayName, type SourceNaming } from './progressiveNotes.js';

/** The copy a row's commit sentences read, already localised. */
export interface RowCommitCopy {
    readonly form: Pick<
        RecipeFormMessages,
        | 'statusResolvedConfirmation'
        | 'ingredientAddedNeedsChoice'
        | 'changeFoodFailed'
        | 'ingredientEntryFindByNameFailed'
        | 'statusAuthoredAndLinked'
        | 'statusAuthoredDuplicateLinked'
        | 'ingredientEntryAddingByName'
        | 'ingredientEntryAddingFromCatalog'
        | 'ingredientEntryAddingFromSource'
        | 'ingredientRemotePickFailed'
        | 'ingredientRemotePickGone'
    >;
    /** `ingredientPickerStatus.added`: a line was added, and no match is claimed. */
    readonly added: string;
    readonly details: Pick<
        IngredientDetailsMessages,
        'matchedWithDetails' | 'statusAdded' | 'statusChanged' | 'statusRemoved' | 'saveRejected'
    >;
    /** What a remote pick says (P8). */
    readonly remote: Pick<IngredientRemoteSearchMessages, 'sourceUnnamed' | 'busy' | 'sourceLimitReached'>;
}

/**
 * The polite sentence for a pick that committed. Pure.
 *
 * - A matched food: its nutrition now counts (§4 "Entry, selected"); a variant names its parts (§S2).
 * - `UNRESOLVED`: it names the glyph the cook chooses with (item 1).
 * - A declaration, or a food still being looked up: added, and no match claimed.
 *
 * @param binding - The binding the line now names.
 * @param food - The row's display name, the glyph label's own value (item 1).
 * @param copy - The localised copy.
 * @returns The sentence.
 */
export const rowCommittedMessage = (binding: LineBinding, food: string, copy: RowCommitCopy): string => {
    if (binding.isUserEntered) {
        return fillTemplate(copy.added, { name: food });
    }

    // ⚠️ A bound line the read said nothing about is `RESOLVED`: `toRecipeFormValues` seeds exactly that default.
    switch (binding.resolutionStatus ?? FoodResolutionStatus.RESOLVED) {
        case FoodResolutionStatus.RESOLVED:
            return binding.variant === undefined
                ? fillTemplate(copy.form.statusResolvedConfirmation, { food })
                : fillTemplate(copy.details.matchedWithDetails, {
                      food,
                      parts: binding.variant.parts.map((part) => part.text).join(', '),
                  });
        case FoodResolutionStatus.UNRESOLVED:
            return fillTemplate(copy.form.ingredientAddedNeedsChoice, { name: food });
        default:
            return fillTemplate(copy.added, { name: food });
    }
};

/** What the row knew when its pick failed. */
export interface RowPickFailure {
    /** The row is in Change food. */
    readonly changing: boolean;
    /** The food the line still uses. */
    readonly food: string;
    /** The field's text. */
    readonly text: string;
}

/**
 * The sentence for a pick that did not take. Pure.
 *
 * @param failure - The row's state when it failed.
 * @param copy - The localised copy.
 * @returns In Change food, that the line still uses its food (item 4); otherwise, the typed text (item 1).
 */
export const rowPickFailedMessage = (failure: RowPickFailure, copy: RowCommitCopy): string =>
    failure.changing
        ? fillTemplate(copy.form.changeFoodFailed, { food: failure.food })
        : fillTemplate(copy.form.ingredientEntryFindByNameFailed, { query: failure.text.trim() });

/** What a settled commit makes its row say. */
export interface RowSettledView {
    /** The polite sentence, for the field group's region. */
    readonly polite: string;
    /** A failure, and the field that shows it and says it assertively: a row's, or the trailing row's. */
    readonly failure: { readonly at: LineCommitTarget; readonly text: string } | undefined;
}

const SAYS_NOTHING: RowSettledView = { polite: '', failure: undefined };

/** A settled commit that is neither a conflict nor refused as busy: the ones a row speaks for. */
type SpokenCommit = SettledRowCommit & {
    readonly outcome: Exclude<SettledRowCommit['outcome'], { readonly kind: 'conflict' | 'busy' }>;
};

/** What an entry pick says: the committed sentence, or the failure its field shows. Pure. */
const entrySettledView = (
    { target, outcome, pick }: SpokenCommit,
    field: RowPickFailure,
    copy: RowCommitCopy,
    naming: SourceNaming,
): RowSettledView => {
    if (outcome.kind === 'committed') {
        return { polite: rowCommittedMessage(outcome.binding, field.food, copy), failure: undefined };
    }

    const text =
        pick.kind === 'remoteFood'
            ? remotePickFailureOf(pick, outcome, naming, copy)
            : rowPickFailedMessage(field, copy);

    return text === undefined ? SAYS_NOTHING : { polite: '', failure: { at: target, text } };
};

/** What a details commit says: the parts it bound, or that the details went; a refused write on the row. Pure. */
const detailsSettledView = (
    { target, outcome }: SpokenCommit,
    mode: DetailsDialogEntry['mode'],
    copy: RowCommitCopy,
): RowSettledView => {
    if (outcome.kind !== 'committed') {
        return { polite: '', failure: { at: target, text: copy.details.saveRejected } };
    }

    const parts = outcome.binding.variant?.parts.map((part) => part.text).join(', ');

    if (parts === undefined) {
        return { polite: copy.details.statusRemoved, failure: undefined };
    }

    return {
        polite: fillTemplate(mode === 'add' ? copy.details.statusAdded : copy.details.statusChanged, { parts }),
        failure: undefined,
    };
};

/**
 * What a settled commit makes its row say, by the surface it came from. Pure.
 *
 * - The entry: the committed sentence, or the failure the row shows (items 1 and 4). A commit on the trailing row
 *   speaks for the row it appended (§2d, the F1 loop); its failure shows at the trailing field.
 * - The authored-food form: created or reused, politely (SPECIFY.2). Its failure stays in its Sheet, with the draft.
 * - The details dialog: the parts it bound, or that the details went (§S8.8); a refused write, `saveRejected` on the
 *   row with no Retry (§S8.9).
 * - A conflict says nothing at the row: the editor shows its conflict view.
 *
 * @param settled - The last settled commit (`IngredientRowEditor.settled`).
 * @param fieldOf - The field a target names, as it reads now: a row, or the trailing row; `undefined` once a row has
 *   gone.
 * @param copy - The localised copy.
 * @param naming - How the rows name a source and say a time, for a remote pick's failure.
 * @returns What it says, and where its failure shows.
 */
export const rowSettledView = (
    settled: SettledRowCommit | undefined,
    fieldOf: (target: LineCommitTarget) => RowPickFailure | undefined,
    copy: RowCommitCopy,
    naming: SourceNaming,
): RowSettledView => {
    if (settled === undefined || settled.outcome.kind === 'conflict' || settled.outcome.kind === 'busy') {
        return SAYS_NOTHING;
    }

    const spoken: SpokenCommit = { ...settled, outcome: settled.outcome };
    const { origin, target, outcome } = spoken;
    // A committed trailing pick names the row it appended; any other commit names its own field.
    const field = fieldOf(
        target.kind === 'newLine' && outcome.kind === 'committed' ? { kind: 'line', key: outcome.key } : target,
    );

    if (field === undefined) {
        return SAYS_NOTHING;
    }

    switch (origin.kind) {
        case 'entry':
            return entrySettledView(spoken, field, copy, naming);
        case 'shortlist':
            // A failed pick is said in row 7's own panel, which keeps the list to choose again.
            return outcome.kind === 'committed'
                ? { polite: rowCommittedMessage(outcome.binding, field.food, copy), failure: undefined }
                : SAYS_NOTHING;
        case 'authoredFood':
            if (outcome.kind !== 'committed') {
                return SAYS_NOTHING;
            }

            return {
                polite:
                    origin.outcome === 'created'
                        ? copy.form.statusAuthoredAndLinked
                        : copy.form.statusAuthoredDuplicateLinked,
                failure: undefined,
            };
        case 'details':
            return detailsSettledView(spoken, origin.mode, copy);
    }
};

/**
 * The failure a settled view shows at `target`: only at the field it names. Pure.
 *
 * @param view - The settled view (`rowSettledView`).
 * @param target - A field: a row, or the trailing row.
 * @returns The failure's sentence, or `undefined`.
 */
export const failureAt = (view: RowSettledView, target: LineCommitTarget): string | undefined => {
    const at = view.failure?.at;
    const isHere =
        at !== undefined &&
        (at.kind === 'newLine' ? target.kind === 'newLine' : target.kind === 'line' && target.key === at.key);

    return isHere ? view.failure?.text : undefined;
};

/**
 * What a pick in flight on a row is doing (§S13 P11; `docs/design/rowEditorOpenDecisions.md` item 1). Pure.
 *
 * @param pick - The pick in flight, if any.
 * @param copy - The localised copy.
 * @param naming - How the rows name a source, for a remote pick (P8).
 * @returns The caption, or `undefined` when nothing is in flight or the pick looks nothing up (a declaration).
 */
export const rowBusyText = (
    pick: IngredientPick | undefined,
    copy: RowCommitCopy,
    naming: Pick<SourceNaming, 'sourceName'>,
): string | undefined => {
    switch (pick?.kind) {
        case undefined:
        case 'declared':
            return undefined;
        case 'name':
            return copy.form.ingredientEntryAddingByName;
        case 'catalogFood':
        case 'catalogVariant':
            return copy.form.ingredientEntryAddingFromCatalog;
        case 'remoteFood':
            return fillTemplate(copy.form.ingredientEntryAddingFromSource, {
                source: sourceDisplayName(pick.source, naming, copy),
            });
    }
};

/** What a row's pending sentence depends on (R7). */
export interface RowPendingInput {
    /** A save or Next was refused for pending text (`useIngredientRowEditor`'s `pendingRefused`). */
    readonly refused: boolean;
    /** This row's field holds the text that refused it. */
    readonly pending: boolean;
    /** The row is in Change food, so the way back is Cancel, not clearing the box. */
    readonly changing: boolean;
    /** The field's text. */
    readonly text: string;
    /** The food the line still uses. */
    readonly food: string;
}

/**
 * The row sentence a refused save or Next shows under a pending field (`docs/design/rowEditorOpenDecisions.md` R7).
 * Pure.
 *
 * @param row - The refusal and the row.
 * @param copy - The localised copy.
 * @returns The sentence, or `undefined` when this row has nothing to say.
 */
export const rowPendingSentence = (
    row: RowPendingInput,
    copy: Pick<RecipeFormMessages, 'ingredientEntryPending' | 'ingredientEntryPendingChange'>,
): string | undefined => {
    if (!row.refused || !row.pending) {
        return undefined;
    }

    const text = row.text.trim();

    return row.changing
        ? fillTemplate(copy.ingredientEntryPendingChange, { text, food: row.food })
        : fillTemplate(copy.ingredientEntryPending, { text });
};
