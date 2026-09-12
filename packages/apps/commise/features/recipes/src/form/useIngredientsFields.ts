/**
 * @module @commise/features-recipes/form — the ingredients field group's orchestration, shared by the web and native
 * `RecipeIngredientsFields` leaves (step 2 of the recipe form; plan 002 V1 B7 and B8, curated U15).
 *
 * The host owns the row editor's controllers (`useIngredientRowEditor`, `docs/design/rowEditorBlueprint.md`
 * decision 1). This hook owns the rest of the group's state: where focus goes next (`useRowFocus`), which settled
 * failure the cook has moved past, and the details dialog's line while it closes. It derives every row's view
 * (`ingredientRowViewOf`), the trailing add row's, the sections, the polite sentences and the running total, so each
 * leaf only draws.
 *
 * U27's sections are the ONE fold (`ingredientSections`): an ungrouped recipe folds to one unlabelled section, which
 * the leaves draw with no heading at all. They are interleaved in ONE list, never a wrapper per run: a per-run wrapper
 * is the ancestor of its rows, so typing the first character of a new label resplits the runs and unmounts the row
 * holding the focused field, and the caret, or on native the keyboard, goes with it.
 *
 * @pattern Headless hook — the field group's state and derived views, which each leaf draws
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { RecipeNutrition } from '@kitchensink/recipe-core';
import { useState } from 'react';

import { lineDisplayName } from '../detail/lineName.js';
import { rangeDerivedNotice } from '../detail/model.js';
import type { LineCommitTarget } from '../hooks/lineCommit.js';
import type { RowDetailsTarget } from '../hooks/useIngredientRowEditor.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import { recipeMessages } from '../messages.js';
import { trailingEntryDescribedBy } from './fieldErrorIds.js';
import { ingredientRowViewOf, type IngredientRowContext, type IngredientRowView } from './ingredientRowView.js';
import { lookupSettledMessage } from './lookupSettledMessage.js';
import { recipeFormMessages } from './messages.js';
import { recipeNutritionTotal } from './nutrition.js';
import { ingredientSections, type RecipeIngredientsFieldsProps } from './props.js';
import { failureAt, rowBusyText, rowPendingSentence, rowSettledView, type RowCommitCopy } from './rowCommitMessage.js';
import type { RowEntryFieldCopy } from './rowEntryField.js';
import type { TrailingEntryFieldCopy, TrailingEntryFieldInput } from './trailingEntryField.js';
import { useRowFocus, type RowFocus } from './useRowFocus.js';

/** The trailing add row's target in the entry. */
const TRAILING = { kind: 'newLine' } as const satisfies LineCommitTarget;

/** One run of rows under a section label; `undefined` for an unlabelled run, which draws no heading. */
export interface IngredientsSectionView {
    /** A stable key for the heading: the first row's line key. */
    readonly key: string;
    readonly label: string | undefined;
    readonly rows: readonly IngredientRowView[];
}

/** The trailing add row: its entry field and its own sentences (§4b, R7, item 1, §S13 P11). */
export interface TrailingRowView {
    /** The entry combobox's input (`trailingEntryFieldOf`). */
    readonly entryField: TrailingEntryFieldInput;
    readonly pendingText: string | undefined;
    readonly failure: string | undefined;
    readonly busyText: string | undefined;
}

/** The details dialog, as the leaves render it. */
export interface IngredientsDetailsView {
    readonly open: boolean;
    /** The root's name, kept while the dialog closes, so it never shows a blank heading. */
    readonly foodName: string;
    /** The line whose `⋮` opened the dialog, kept while it closes. */
    readonly line: RowDetailsTarget | undefined;
}

/** What the leaves draw. */
export interface IngredientsFieldsModel {
    /** The entry fields' copy, for `rowEntryFieldOf` and `trailingEntryFieldOf`. */
    readonly entryCopy: RowEntryFieldCopy & TrailingEntryFieldCopy;
    readonly sections: readonly IngredientsSectionView[];
    readonly trailing: TrailingRowView;
    /** The settled lookup retry's outcome, said politely; focus does not move (V1 sign-off 3c). */
    readonly lookupSettledMessage: string;
    /** What a row's settled pick did, said politely with the list closed (R3). */
    readonly settledMessage: string;
    /** The list's own error, from the last submit. */
    readonly listError: string | undefined;
    /** The total and every row's panel read the SAME background read (plan 002 V1 B5, blueprint decision 3). */
    readonly total: RecipeNutrition;
    /** R38: the disclosure the total owes when a line states a range. */
    readonly rangeNotice: string | undefined;
    readonly details: IngredientsDetailsView;
    readonly focus: RowFocus;
}

/**
 * The ingredients field group's state and views.
 *
 * @param props - The field group's props.
 * @returns What the leaves draw.
 * @sideEffect Commits and removes lines through the host's row editor, and edits the draft through `onChange`, when a
 *   control calls the handlers it returns.
 */
export function useIngredientsFields(props: RecipeIngredientsFieldsProps): IngredientsFieldsModel {
    const { values, errors, nutrition, lookupRetry, rowEditor } = props;
    const m = useMessages(recipeFormMessages);
    const shared = useMessages(recipeMessages);
    const { readOffline } = useMessages(offlineNoticeMessages);
    const locale = useLocale();
    const { entry, naming } = rowEditor;
    const focus = useRowFocus(rowEditor);
    // What had settled when this field group mounted: a failure found on return is a state, said by its line and
    // never by an alert (`docs/design/rowEditorOpenDecisions.md` E2). Whether the cook moved past it is the host's.
    const [settledAtMount] = useState(rowEditor.settled);
    const detailsLine = useLastDefined(rowEditor.details.target);
    const commitCopy: RowCommitCopy = {
        form: m,
        added: shared.ingredientPickerStatus.added,
        details: shared.ingredientDetails,
        remote: shared.ingredientRemoteSearch,
    };
    const settledView = rowSettledView(
        rowEditor.settled,
        (target) => {
            if (target.kind === 'newLine') {
                return { food: '', changing: false, text: entry.textOf(target) };
            }

            const line = values.ingredients.find((each) => each.key === target.key);

            return line === undefined
                ? undefined
                : {
                      food: lineDisplayName(line, shared.ingredientLineName),
                      changing: entry.changing.has(target.key),
                      text: entry.textOf(target),
                  };
        },
        commitCopy,
        naming,
    );
    const { moveOn } = rowEditor;
    const failureOf = (target: LineCommitTarget): string | undefined =>
        rowEditor.movedPast ? undefined : failureAt(settledView, target);
    const alertOf = (target: LineCommitTarget): string | undefined =>
        rowEditor.settled === settledAtMount ? undefined : failureOf(target);
    const ctx: IngredientRowContext = {
        ...props,
        errors,
        focus,
        m,
        shared,
        locale,
        commitCopy,
        failureOf,
        alertOf,
        moveOn,
    };
    const trailingPending = rowPendingSentence(
        {
            refused: rowEditor.pendingRefused,
            pending: entry.isPending(TRAILING),
            changing: false,
            text: entry.textOf(TRAILING),
            food: '',
        },
        m,
    );
    const trailingFailure = failureOf(TRAILING);
    const total = recipeNutritionTotal(values, nutrition.lookup);

    return {
        entryCopy: {
            form: m,
            search: shared.ingredientSearch,
            pickerSearch: shared.ingredientPickerSearch,
            remote: shared.ingredientRemoteSearch,
            details: shared.ingredientDetails,
            readOffline,
        },
        sections: ingredientSections(values).map((section) => ({
            key: `section-${section.lines[0]?.line.key ?? 'none'}`,
            label: section.label,
            rows: section.lines.map(({ line, index }) => ingredientRowViewOf(line, index, ctx)),
        })),
        trailing: {
            entryField: {
                entry,
                nextNumber: values.ingredients.length + 1,
                invalid: trailingPending !== undefined,
                pickFailure: alertOf(TRAILING),
                refusal: undefined,
                describedBy: trailingEntryDescribedBy({
                    pending: trailingPending !== undefined,
                    failure: trailingFailure !== undefined,
                }),
                focusRequested: focus.trailing.requested,
                listRequested: focus.trailing.listRequested,
                refusalOccurrence: 0,
                onFocusRequestHandled: focus.trailing.onHandled,
                onTextChange: moveOn,
                // Item 1 (O3 ruling): the form opens on the name the cook typed, and they can edit it (§5a).
                onCreateOwnFood: (text) => rowEditor.authoredFood.open(text, TRAILING),
                naming,
                limitRefusals: rowEditor.limitRefusals,
            },
            pendingText: trailingPending,
            failure: trailingFailure,
            busyText: rowBusyText(rowEditor.pickInFlight(TRAILING), commitCopy, naming),
        },
        lookupSettledMessage: lookupSettledMessage(m, values, lookupRetry.settled, shared.ingredientLineName),
        settledMessage: settledView.polite,
        listError: errors?.ingredients === undefined ? undefined : m.errors[errors.ingredients],
        total,
        rangeNotice: rangeDerivedNotice(total, { low: m.nutritionRangeDerivedLow, high: m.nutritionRangeDerivedHigh }),
        details: {
            open: rowEditor.details.target !== undefined,
            foodName: detailsLine?.foodName ?? '',
            line: detailsLine,
        },
        focus,
    };
}
