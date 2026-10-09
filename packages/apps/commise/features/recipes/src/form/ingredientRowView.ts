/**
 * @module @commise/features-recipes/form — one ingredient row's view in the field group (plan 002 V1, curated U15):
 * what each control says, whether it is invalid or busy, which control is asked to take focus, and what each action
 * does. `useIngredientsFields` builds one per row; both `RecipeIngredientsFields` leaves draw it.
 *
 * The ONE row policy (`rowPresentationOf`) decides the name's mode, the status word and its tone, slot 1's panel and
 * slot 2's actions. Everything else here is derived from the LINE at render, never stored: U28's no-food note (a row
 * restored unresolved says so before anyone presses anything, which `errors` cannot, since only a submit fills it),
 * U25's unit class (`recipe-core`'s `classifyUnit`, so the editor, the service and the leaves agree on `handful`), and
 * R9's stand-in (`namelessLineCopy.md` §6c, display only, never a field value).
 *
 * Pure: it builds handlers and calls none of them.
 *
 * @pattern Presentation Model — the row's state and commands, derived from the line and the field group's controllers
 */
import type { Locale } from '@commise/i18n';
import type { ActionMenuItem } from '@commise/ui/action-menu';
import { classifyUnit } from '@kitchensink/recipe-core';

import { isStandInName, lineDisplayName } from '../detail/lineName.js';
import { lineSummary } from '../detail/model.js';
import type { LineCommitTarget } from '../hooks/lineCommit.js';
import type { IngredientRowEditor } from '../hooks/useIngredientRowEditor.js';
import { fillTemplate } from '../list/model.js';
import type { RecipeMessages } from '../messages.js';
import type { DraftAction } from './draftAction.js';
import {
    ingredientEntryDescribedBy,
    ingredientNameDescribedBy,
    ingredientQuantityDescribedBy,
    ingredientsErrorId,
    ingredientUnitNoteId,
} from './fieldErrorIds.js';
import type { LookupRetry } from './ingredientStatus.js';
import { panelBodyOf, type RowPanelBody } from './ingredientRowPanel.js';
import {
    detailsEntryOf,
    rowPresentationOf,
    rowVariantParts,
    type IngredientRowAction,
    type IngredientRowPresentation,
} from './ingredientRowPolicy.js';
import type { RecipeFormMessages } from './messages.js';
import { rowFiguresOf, rowHasVariantsOf } from './nutritionPanel.js';
import type { IngredientNutrition } from './nutritionLookup.js';
import { applyDraftAction, parseQuantityBound, unitClassNote, unresolvedLineNote } from './props.js';
import { draftQuantity, draftQuantityVerdict } from './quantity.js';
import { removalFocusTarget } from './removalFocusTarget.js';
import { rowBusyText, rowPendingSentence, type RowCommitCopy } from './rowCommitMessage.js';
import type { RowEntryFieldInput } from './rowEntryField.js';
import { leaveEntryFocus } from './rowFocus.js';
import { shortlistSettledAt, type ShortlistPanelProps } from './shortlistPanel.model.js';
import type { ControlFocus, GlyphFocus, RowFocus } from './useRowFocus.js';
import type { RecipeFormErrors } from './validate.js';
import type { RecipeFormIngredient, RecipeFormValues } from './values.js';

/** What every row's view is derived from: the field group's props, its controllers and its copy. */
export interface IngredientRowContext {
    readonly values: RecipeFormValues;
    readonly errors: RecipeFormErrors | undefined;
    readonly onChange: (next: RecipeFormValues) => void;
    readonly nutrition: IngredientNutrition;
    readonly lookupRetry: LookupRetry;
    readonly rowEditor: IngredientRowEditor;
    readonly focus: RowFocus;
    readonly m: RecipeFormMessages;
    readonly shared: Pick<RecipeMessages, 'ingredientLineName' | 'ingredientDetails'>;
    readonly locale: Locale;
    readonly commitCopy: RowCommitCopy;
    /** The failure line a settled pick shows at `target`, unless the cook has moved past it. */
    readonly failureOf: (target: LineCommitTarget) => string | undefined;
    /**
     * The failure at `target` to say as an alert: {@link failureOf}, only when it settled after the field group mounted
     * (`docs/design/rowEditorOpenDecisions.md` E2). An alert reports an event; a failure found on return is a state.
     */
    readonly alertOf: (target: LineCommitTarget) => string | undefined;
    /** The cook moved past the settled failure: new text, Change food again, Cancel. */
    readonly moveOn: () => void;
}

/** The names of the row's glyph and `⋮`, and of their panels' close controls. */
export interface IngredientRowLabels {
    readonly glyphTrigger: string;
    readonly glyphClose: string;
    readonly actionsTrigger: string;
    readonly actionsClose: string;
}

/** What describes each of the row's fields: the ids of the notes and errors about it (WCAG 1.3.1, 3.3.1). */
export interface IngredientRowDescriptions {
    readonly name: string | undefined;
    readonly quantity: string | undefined;
    readonly quantityHigh: string | undefined;
    readonly unit: string | undefined;
}

/** The row's field edits, each taking the field's text. */
export interface IngredientRowEdits {
    readonly quantityLow: (text: string) => void;
    readonly quantityHigh: (text: string) => void;
    readonly unit: (text: string) => void;
    readonly preparation: (text: string) => void;
    readonly groupLabel: (text: string) => void;
}

/** One row, as both leaves draw it. */
export interface IngredientRowView {
    readonly line: RecipeFormIngredient;
    readonly index: number;
    /** The row's 1-based number, which names its controls. */
    readonly number: number;
    readonly presentation: IngredientRowPresentation;
    /** Slot 1's panel body. */
    readonly body: RowPanelBody;
    /** The read withheld the line's name: its stand-in shows in the name's place (plan 002 R9). */
    readonly standIn: boolean;
    readonly displayName: string;
    /**
     * The food the glyph and `⋮` name. A stand-in names nothing, so it carries the amount too, or a list of private
     * rows is a list of identical "About Private ingredient" buttons (namelessLineCopy §7, 1.1.1/2.5.3).
     */
    readonly triggerFood: string;
    /** A variant-bound line's parts, from its own binding, so a retired variant still shows them (§S1). */
    readonly variantParts: readonly [string, ...string[]] | undefined;
    readonly changing: boolean;
    /**
     * U28: the row names no food. Shown as TEXT beside the row, never a colour on it (WCAG 1.4.1, and a colour cannot
     * name the remedy), as a standing note rather than an alert, so a list of eight does not shout eight times.
     */
    readonly noFoodNote: string | undefined;
    /**
     * U25: the unit is not one the vocabulary knows. TEXT, not colour (WCAG 1.4.1), which also tells a deliberate
     * `handful` from a mistyped `blorp`; it describes the field and never marks it invalid.
     */
    readonly unitNote: string | undefined;
    readonly unitCanonical: boolean;
    /** The line is itself the reason it is invalid (B8, WCAG 3.3.1): never every row on an empty-list error. */
    readonly nameInvalid: boolean;
    /** Both bounds carry the mark: the invalid thing is the PAIR, and either half may be the correct one. */
    readonly quantityInvalid: boolean;
    readonly describedBy: IngredientRowDescriptions;
    /** Text a save or Next refused, said on its row in the row's own words (§4b, item 4, R7). */
    readonly pendingText: string | undefined;
    /** A pick on this row that did not take: shown on the row, said assertively by the field. */
    readonly failure: string | undefined;
    /** What a pick in flight on this row is doing (§S13 P11). */
    readonly busyText: string | undefined;
    /** A pick on this row runs: its other actions do nothing ("Busy and disabled", rule 2). */
    readonly busy: boolean;
    /** A Try again for the row's failed lookup runs. */
    readonly retrying: boolean;
    readonly glyphBusy: boolean;
    readonly labels: IngredientRowLabels;
    /** The entry combobox's input (`rowEntryFieldOf`), for a row whose name is in entry mode. */
    readonly entryField: RowEntryFieldInput;
    /** Slot 2's menu items, remedy first (§3a), without the destructive one. */
    readonly actions: readonly ActionMenuItem[];
    /** Slot 2's destructive menu item (Remove), which the menu draws last, after a divider. */
    readonly destructiveAction: ActionMenuItem | undefined;
    readonly glyphFocus: GlyphFocus;
    readonly actionsFocus: ControlFocus;
    /** Rows 6 and 7's panel props, closing the glyph's panel with `close`. */
    readonly shortlist: (close: () => void) => ShortlistPanelProps;
    readonly onRemove: () => void;
    readonly onRetryLookup: () => void;
    /** Leave the entry without a pick: the field puts back what the line holds, and focus goes back (item 4). */
    readonly onLeaveEntry: () => void;
    /** Focus left the row: a row in Change food with nothing new typed ends it (item 4). */
    readonly onFocusLeft: () => void;
    readonly edit: IngredientRowEdits;
}

/** The row's notes and invalid marks, from the line alone (and, for the pair, the submit's error). Pure. */
const rowMarksOf = (line: RecipeFormIngredient, index: number, ctx: IngredientRowContext) => {
    const noFoodNote = unresolvedLineNote(ctx.m, line);
    const standIn = isStandInName(line);
    const quantityInvalid =
        ctx.errors?.ingredients === 'ingredientsQuantityInvalid' && draftQuantityVerdict(line) === 'invalid';
    const unitNote = unitClassNote(ctx.m, line.unit);

    return {
        noFoodNote,
        standIn,
        quantityInvalid,
        unitNote,
        describedBy: {
            name: ingredientNameDescribedBy(
                index,
                noFoodNote !== undefined,
                ctx.errors?.ingredients === 'ingredientsUnresolved',
            ),
            quantity: ingredientQuantityDescribedBy(index, standIn, quantityInvalid),
            quantityHigh: quantityInvalid ? ingredientsErrorId : undefined,
            unit: unitNote === undefined ? undefined : ingredientUnitNoteId(index),
        },
    };
};

/**
 * The glyph's and `⋮`'s names: a variant-bound row names its parts after the food, so two rows on one root differ
 * (item 6). Pure.
 */
const rowLabelsOf = (
    m: RecipeFormMessages,
    parts: readonly string[] | undefined,
    triggerFood: string,
    displayName: string,
): IngredientRowLabels => {
    const partsLabel = parts?.join(', ');
    const labelled = (plain: string, withDetails: string, food: string): string =>
        partsLabel === undefined
            ? fillTemplate(plain, { food })
            : fillTemplate(withDetails, { food, parts: partsLabel });

    return {
        glyphTrigger: labelled(
            m.ingredientStatusPanelTriggerLabel,
            m.ingredientStatusPanelTriggerLabelWithDetails,
            triggerFood,
        ),
        glyphClose: labelled(
            m.ingredientStatusPanelCloseLabel,
            m.ingredientStatusPanelCloseLabelWithDetails,
            displayName,
        ),
        actionsTrigger: labelled(m.ingredientActionsMenuLabel, m.ingredientActionsMenuLabelWithDetails, triggerFood),
        actionsClose: labelled(
            m.ingredientActionsMenuCloseLabel,
            m.ingredientActionsMenuCloseLabelWithDetails,
            triggerFood,
        ),
    };
};

/** The row's field edits: each produces the next draft through `applyDraftAction`. Pure. */
const rowEditsOf = (index: number, ctx: IngredientRowContext): IngredientRowEdits => {
    const apply = (action: DraftAction): void => ctx.onChange(applyDraftAction(ctx.values, action));

    return {
        quantityLow: (text) => apply({ kind: 'setIngredientQuantityLow', index, value: parseQuantityBound(text) }),
        quantityHigh: (text) => apply({ kind: 'setIngredientQuantityHigh', index, value: parseQuantityBound(text) }),
        unit: (text) => apply({ kind: 'updateIngredientAt', index, patch: { unit: text } }),
        preparation: (text) => apply({ kind: 'updateIngredientAt', index, patch: { preparation: text } }),
        groupLabel: (text) => apply({ kind: 'updateIngredientAt', index, patch: { groupLabel: text } }),
    };
};

/** What one of slot 2's actions does on this row. */
interface RowActionTarget {
    readonly line: RecipeFormIngredient;
    readonly target: LineCommitTarget & { readonly kind: 'line' };
    readonly displayName: string;
    readonly onRemove: () => void;
}

/**
 * Slot 2's menu: its actions in policy order, with Remove taken out as the menu's destructive item. Pure.
 *
 * @param actions - The policy's actions for the row.
 * @param itemOf - Builds one menu item.
 * @returns The menu's actions and its destructive one.
 */
const menuOf = (
    actions: readonly IngredientRowAction[],
    itemOf: (action: IngredientRowAction) => ActionMenuItem,
): Pick<IngredientRowView, 'actions' | 'destructiveAction'> => ({
    actions: actions.filter((action) => action !== 'remove').map(itemOf),
    destructiveAction: actions.includes('remove') ? itemOf('remove') : undefined,
});

/** One of slot 2's menu items. Pure. */
const actionItemOf = (action: IngredientRowAction, row: RowActionTarget, ctx: IngredientRowContext): ActionMenuItem => {
    const { m, rowEditor, focus } = ctx;
    const { entry } = rowEditor;
    const { line, target } = row;

    switch (action) {
        case 'changeFood':
            return {
                id: action,
                label: m.statusActionChangeFood,
                onSelect: () => {
                    ctx.moveOn();
                    entry.beginChange(line.key);
                    focus.request(line.key, 'name');
                },
            };
        case 'findFood':
            return {
                id: action,
                label: m.statusActionFindFood,
                onSelect: () => {
                    entry.focus(target);
                    focus.request(line.key, 'name');
                },
            };
        case 'createOwnFood':
            return {
                id: action,
                label: m.createCustomFoodIconLabel,
                // §5a: the form shows the name it will create, the text the cook typed or the line's own.
                onSelect: () => rowEditor.authoredFood.open(entry.textOf(target).trim(), target),
            };
        case 'addDetails':
        case 'editDetails':
            return {
                id: action,
                label:
                    action === 'addDetails'
                        ? ctx.shared.ingredientDetails.actionAdd
                        : ctx.shared.ingredientDetails.actionEdit,
                onSelect: () => {
                    // The policy offers these only on a line bound to a root (its own, or its variant's).
                    if (line.foodId === undefined) {
                        return;
                    }

                    rowEditor.details.open({
                        key: line.key,
                        rootId: line.foodId,
                        foodName: row.displayName,
                        entry: detailsEntryOf(action, line.variant),
                    });
                },
            };
        case 'remove':
            return { id: action, label: m.statusActionRemove, onSelect: row.onRemove };
    }
};

/**
 * One row's view.
 *
 * @param line - The line.
 * @param index - Its position in the draft.
 * @param ctx - The field group's props, controllers and copy.
 * @returns The row's view. Pure: its handlers run only when a control calls them.
 */
export const ingredientRowViewOf = (
    line: RecipeFormIngredient,
    index: number,
    ctx: IngredientRowContext,
): IngredientRowView => {
    const { m, rowEditor, focus, lookupRetry } = ctx;
    const { entry } = rowEditor;
    const number = index + 1;
    const target = { kind: 'line', key: line.key } as const satisfies LineCommitTarget;
    const marks = rowMarksOf(line, index, ctx);
    const changing = entry.changing.has(line.key);
    const facts = {
        figures: rowFiguresOf(line, ctx.nutrition.lookup),
        hasVariants: rowHasVariantsOf(line, ctx.nutrition.lookup),
    };
    const presentation = rowPresentationOf(line, { ...facts, changing });
    const body = panelBodyOf(presentation.panel, presentation.standIn);
    const variantParts = rowVariantParts(line);
    const inFlight = rowEditor.pickInFlight(target);
    const busy = inFlight !== undefined;
    const retrying = line.ingredientId !== null && lookupRetry.retrying.has(line.ingredientId);
    const displayName = lineDisplayName(line, ctx.shared.ingredientLineName);
    const triggerFood = presentation.standIn
        ? lineSummary({ ...line, quantity: draftQuantity(line) }, ctx.locale, ctx.shared.ingredientLineName)
        : displayName;
    const failure = ctx.failureOf(target);
    const pendingText = rowPendingSentence(
        {
            refused: rowEditor.pendingRefused,
            pending: entry.isPending(target),
            changing,
            text: entry.textOf(target),
            food: displayName,
        },
        m,
    );
    const nameFocus = focus.name(line.key);

    const onRemove = (): void => {
        if (busy) {
            return;
        }

        const removal = removalFocusTarget(ctx.values.ingredients, index);

        rowEditor.dispatch({ kind: 'removeIngredient', key: line.key });

        // V1 sign-off item 11: hand focus on rather than drop it to the page.
        if (removal.kind === 'glyph') {
            focus.request(removal.key, 'glyph');
        } else {
            focus.requestTrailing();
        }
    };

    // Item 4: focus goes back to the control the cook came from. Rows 1 and 2 are always entry fields, so their field
    // keeps focus.
    const onLeaveEntry = (): void => {
        ctx.moveOn();
        entry.abandon(target);

        if (changing) {
            focus.request(line.key, leaveEntryFocus(rowPresentationOf(line, { ...facts, changing: false }).slot2));
        }
    };

    return {
        line,
        index,
        number,
        presentation,
        body,
        standIn: marks.standIn,
        displayName,
        triggerFood,
        variantParts,
        changing,
        noFoodNote: marks.noFoodNote,
        unitNote: marks.unitNote,
        unitCanonical: classifyUnit(line.unit ?? '') === 'canonical',
        nameInvalid: marks.noFoodNote !== undefined,
        quantityInvalid: marks.quantityInvalid,
        describedBy: marks.describedBy,
        pendingText,
        failure,
        busyText: rowBusyText(inFlight, ctx.commitCopy, rowEditor.naming),
        busy,
        retrying,
        glyphBusy: retrying || ((body.kind === 'candidates' || body.kind === 'shortlist') && busy),
        labels: rowLabelsOf(m, variantParts, triggerFood, displayName),
        entryField: {
            target,
            number,
            entry,
            changing,
            food: displayName,
            invalid: marks.noFoodNote !== undefined || pendingText !== undefined,
            pickFailure: ctx.alertOf(target),
            refusal: undefined,
            describedBy: ingredientEntryDescribedBy(index, line.key, {
                noFoodNote: marks.noFoodNote !== undefined,
                unresolvedError: ctx.errors?.ingredients === 'ingredientsUnresolved',
                pending: pendingText !== undefined,
                failure: failure !== undefined,
            }),
            focusRequested: nameFocus.requested,
            listRequested: nameFocus.listRequested,
            refusalOccurrence: 0,
            onFocusRequestHandled: nameFocus.onHandled,
            onCancel: onLeaveEntry,
            onAbandon: onLeaveEntry,
            onTextChange: ctx.moveOn,
            naming: rowEditor.naming,
            limitRefusals: rowEditor.limitRefusals,
        },
        ...menuOf(presentation.slot2.kind === 'menu' ? presentation.slot2.actions : [], (action) =>
            actionItemOf(action, { line, target, displayName, onRemove }, ctx),
        ),
        glyphFocus: focus.glyph(line.key),
        actionsFocus: focus.actions(line.key),
        shortlist: (close) => ({
            reason: body.kind === 'candidates' ? 'unresolved' : 'ambiguous',
            food: displayName,
            phrase: line.name ?? '',
            inFlight,
            lastPick: shortlistSettledAt(rowEditor.settled, line.key),
            limitRefusals: rowEditor.limitRefusals,
            holdLimit: rowEditor.sourceLimit.hold,
            naming: rowEditor.naming,
            onPick: (pick) => rowEditor.pickFromShortlist(line.key, pick),
            onSettled: close,
            onNoneOfThese: () => {
                focus.requestAfterGlyphPanel({ key: line.key, control: 'name' });
                entry.beginChange(line.key);
                close();
            },
        }),
        onRemove,
        onRetryLookup: () => {
            if (line.ingredientId !== null) {
                lookupRetry.retry(line.ingredientId, line.key);
            }
        },
        onLeaveEntry,
        onFocusLeft: () => {
            if (changing) {
                entry.leave(target);
            }
        },
        edit: rowEditsOf(index, ctx),
    };
};
