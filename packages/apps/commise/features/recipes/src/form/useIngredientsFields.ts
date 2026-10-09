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
import { useContext, useState } from 'react';

import { lineDisplayName } from '../detail/lineName.js';
import { editorMessages } from '../editor/messages.js';
import { SectionPresenceContext } from '../editor/sectionPresence.js';
import { rangeDerivedNotice } from '../detail/model.js';
import { commitTargetOf } from '../hooks/ingredientEntry.model.js';
import type { LineCommitTarget } from '../hooks/lineCommit.js';
import type { RowDetailsTarget } from '../hooks/useIngredientRowEditor.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { trailingEntryDescribedBy } from './fieldErrorIds.js';
import { ingredientRowViewOf, type IngredientRowContext, type IngredientRowView } from './ingredientRowView.js';
import { readLeadingMeasure } from './leadingMeasure.js';
import { liveReadingOf } from './liveReading.js';
import { lookupSettledMessage } from './lookupSettledMessage.js';
import { recipeFormMessages } from './messages.js';
import { nutritionCountOf, recipeNutritionTotal } from './nutrition.js';
import { ingredientSections, type RecipeIngredientsFieldsProps } from './props.js';
import { failureAt, rowBusyText, rowPendingSentence, rowSettledView, type RowCommitCopy } from './rowCommitMessage.js';
import type { RowEntryFieldCopy } from './rowEntryField.js';
import type { TrailingEntryFieldCopy, TrailingEntryFieldInput } from './trailingEntryField.js';
import { useRowFocus, type RowFocus } from './useRowFocus.js';

/** The trailing add row's target in the entry. */
const TRAILING = { kind: 'newLine' } as const satisfies LineCommitTarget;

/** How long the cook pauses before the live reading is said: never per keystroke (build spec §7.5.3). */
export const LIVE_READING_PAUSE_MS = 500;

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
    /** How the text was read ("2 tbsp · olive oil · for frying"); `undefined` for a food alone (§7.5.3). */
    readonly readingShown: string | undefined;
    /** The reading as a screen reader hears it, politely, once the cook pauses; `''` until then. */
    readonly readingSpoken: string;
    /** "Pick a food from the list.", after Enter with no option active, until the cook types again. */
    readonly pickFoodNotice: string | undefined;
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
    /**
     * The total's one line (build spec §7.5.6): "612 cal per serving · 7 of 9 counted", or, while no line is counted,
     * "Nutrition appears as you match ingredients." — never "0 cal" (F7).
     */
    readonly totalLine: string;
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
    const { ingredients: addCopy } = useMessages(editorMessages);
    const { entry, naming } = rowEditor;
    const focus = useRowFocus(rowEditor);
    const trailingText = entry.textOf(TRAILING);
    const reading = liveReadingOf(trailingText, locale, addCopy.reading);
    // Said once the cook pauses: the debounced text's reading, and only while it is still the field's text.
    const pausedText = useDebouncedValue(trailingText, LIVE_READING_PAUSE_MS);
    const readingSpoken = pausedText === trailingText ? (reading?.spoken ?? '') : '';
    // The text Enter was pressed on with no choice: the notice shows while the field still holds it.
    const [submittedWithoutChoice, setSubmittedWithoutChoice] = useState<string | undefined>(undefined);
    // The last commit that settled while the cook was not here: before this field group mounted, or while the cook was
    // in another section of the page. Such a failure is a state, said by its line and never by an alert, on return too
    // (`docs/design/rowEditorOpenDecisions.md` E2). Whether the cook moved past it is the host's.
    const present = useContext(SectionPresenceContext);
    const [unheard, setUnheard] = useState(rowEditor.settled);

    if (!present && rowEditor.settled !== unheard) {
        setUnheard(rowEditor.settled);
    }

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
        rowEditor.settled === unheard ? undefined : failureOf(target);
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
    const count = nutritionCountOf(values, nutrition.lookup);

    return {
        entryCopy: {
            form: m,
            add: addCopy,
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
                // Item 1 (O3 ruling): the form opens on the food the cook typed, and they can edit it (§5a); the line it
                // adds carries the measure typed in front of the food (A1).
                onCreateOwnFood: (text) =>
                    rowEditor.authoredFood.open(readLeadingMeasure(text).search, commitTargetOf(TRAILING, text)),
                onSubmitWithoutChoice: () => setSubmittedWithoutChoice(trailingText),
                naming,
                limitRefusals: rowEditor.limitRefusals,
            },
            pendingText: trailingPending,
            failure: trailingFailure,
            busyText: rowBusyText(rowEditor.pickInFlight(TRAILING), commitCopy, naming),
            readingShown: reading?.shown,
            readingSpoken,
            pickFoodNotice:
                submittedWithoutChoice !== undefined && submittedWithoutChoice === trailingText
                    ? addCopy.pickFood
                    : undefined,
        },
        lookupSettledMessage: lookupSettledMessage(m, values, lookupRetry.settled, shared.ingredientLineName),
        settledMessage: settledView.polite,
        listError: errors?.ingredients === undefined ? undefined : m.errors[errors.ingredients],
        total,
        totalLine:
            count.counted === 0
                ? m.nutritionEmpty
                : fillTemplate(m.nutritionCounted, {
                      cal: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(total.calories),
                      counted: count.counted,
                      total: count.total,
                  }),
        rangeNotice: rangeDerivedNotice(total, { low: m.nutritionRangeDerivedLow, high: m.nutritionRangeDerivedHigh }),
        details: {
            open: rowEditor.details.target !== undefined,
            foodName: detailsLine?.foodName ?? '',
            line: detailsLine,
        },
        focus,
    };
}
