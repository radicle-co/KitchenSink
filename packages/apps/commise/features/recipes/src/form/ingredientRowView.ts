/**
 * @module @commise/features-recipes/form — one ingredient row's view in the field group (plan 002 V1, curated U15; the
 * UI overhaul's read row and row editor, build spec §7.5.1 and §7.5.2): what each control says, whether it is invalid
 * or busy, which control is asked to take focus, and what each action does. `useIngredientsFields` builds one per row;
 * both `RecipeIngredientsFields` leaves draw it.
 *
 * A row READS quietly: its amount, its name and preparation, its `⋯`, and a second line only when the cook must act
 * (`rowSecondLineOf`). Its fields live in the row editor (`lineEditor`), opened by the row's open control or `⋯` Edit.
 * The row's food search (Change food, Find a food, a line with no food) still turns the name into the entry field.
 *
 * The ONE row policy (`rowPresentationOf`) decides the state's remedies and its panel; `rowMenuOf` composes them with the
 * row's own and its position's `⋯` items. Everything else here is derived from the LINE at render, never stored: U28's
 * no-food note (a row restored unresolved says so before anyone presses anything, which `errors` cannot, since only a
 * submit fills it), U25's unit class (`recipe-core`'s `classifyUnit`, so the editor, the service and the leaves agree
 * on `handful`), and R9's stand-in (`namelessLineCopy.md` §6c, display only, never a field value).
 *
 * Pure: it builds handlers and calls none of them.
 *
 * @pattern Presentation Model — the row's state and commands, derived from the line and the field group's controllers
 */
import type { Locale } from '@commise/i18n';
import type { ActionMenuItem } from '@commise/ui/action-menu';

import { isStandInName, lineDisplayName } from '../detail/lineName.js';
import { formatQuantity, lineSummary } from '../detail/model.js';
import type { LineCommitTarget } from '../hooks/lineCommit.js';
import type { IngredientRowEditor } from '../hooks/useIngredientRowEditor.js';
import { fillTemplate } from '../list/model.js';
import type { RecipeMessages } from '../messages.js';
import type { DraftAction } from './draftAction.js';
import {
    ingredientEntryDescribedBy,
    ingredientQuantityDescribedBy,
    ingredientsErrorId,
    ingredientUnitNoteId,
} from './fieldErrorIds.js';
import { ingredientEditorFieldId, type IngredientEditorField } from './fieldIds.js';
import { canMoveIngredient, groupLabelOf } from './ingredientGroups.js';
import type { IngredientLineKey } from './lineKey.js';
import type { LookupRetry } from './ingredientStatus.js';
import { panelBodyOf, type RowPanelBody } from './ingredientRowPanel.js';
import {
    detailsEntryOf,
    namesAFood,
    rowPresentationOf,
    rowVariantParts,
    type IngredientRowAction,
    type IngredientRowPresentation,
} from './ingredientRowPolicy.js';
import type { RecipeFormMessages } from './messages.js';
import { nutritionPanelOf, rowFiguresOf, rowHasVariantsOf } from './nutritionPanel.js';
import type { IngredientNutrition } from './nutritionLookup.js';
import {
    applyDraftAction,
    parseQuantityBound,
    quantityInputValue,
    unitClassNote,
    unresolvedLineNote,
} from './props.js';
import { draftQuantity, draftQuantityVerdict } from './quantity.js';
import { removalFocusTarget } from './removalFocusTarget.js';
import { rowBusyText, rowPendingSentence, type RowCommitCopy } from './rowCommitMessage.js';
import type { RowEntryFieldInput } from './rowEntryField.js';
import { rowMenuOf, type RowMenuAction } from './rowMenu.js';
import { rowSecondLineOf } from './rowSecondLine.js';
import { shortlistSettledAt, type ShortlistPanelProps } from './shortlistPanel.model.js';
import { unitSuggestionsOf } from './unitSuggestions.js';
import type { ControlFocus, RowFocus } from './useRowFocus.js';
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
    /** Which row's editor is open, and the editor's own view state (`useIngredientsFields`). */
    readonly lineEditor: LineEditorState;
    /** Open the Food details sheet for a row (`⋯` Food details). */
    readonly openFoodDetails: (key: IngredientLineKey) => void;
    /** Open the Move to group sheet for a row (`⋯` Move to group…). */
    readonly openMoveToGroup: (key: IngredientLineKey) => void;
    /** How many named groups the list has: its lines' and the cook's new, empty ones. */
    readonly groupCount: number;
}

/**
 * The row editor's view state, held by the field group: one editor open at a time (build spec §7.5.2), which rows
 * have their range shown before it has an upper bound, and whether the open editor shows its food's details.
 */
export interface LineEditorState {
    readonly openKey: IngredientLineKey | undefined;
    /** Open a row's editor; another open one closes, keeping its values (they are the draft's already). */
    readonly open: (key: IngredientLineKey) => void;
    readonly close: () => void;
    /** "+ Add a range" was pressed on this row, before it holds an upper bound. */
    readonly rangeShown: (key: IngredientLineKey) => boolean;
    readonly showRange: (key: IngredientLineKey) => void;
    readonly hideRange: (key: IngredientLineKey) => void;
    /** The open editor shows its food's details. */
    readonly detailsOpen: boolean;
    readonly toggleDetails: () => void;
}

/** The names of the row's `⋯` and of the close controls of what it and the attention line open. */
export interface IngredientRowLabels {
    /** The close control of the row's panel (the attention line's, or Food details'). */
    readonly panelClose: string;
    readonly actionsTrigger: string;
    readonly actionsClose: string;
}

/** What describes each of the row editor's amount and unit fields: the ids of the notes and errors about them. */
export interface IngredientRowDescriptions {
    readonly quantity: string | undefined;
    readonly quantityHigh: string | undefined;
    readonly unit: string | undefined;
}

/** The row's field edits, each taking the field's text. No group: groups are set at the section level (§7.5.2). */
export interface IngredientRowEdits {
    readonly quantityLow: (text: string) => void;
    readonly quantityHigh: (text: string) => void;
    readonly unit: (text: string) => void;
    readonly preparation: (text: string) => void;
}

/** A read row's second line, worded (`rowSecondLineOf`). */
export type RowSecondLineView =
    | { readonly kind: 'none' }
    | { readonly kind: 'working'; readonly text: string }
    | {
          readonly kind: 'attention';
          readonly text: string;
          /** The control's name: its words, then the food (SC 2.5.3). */
          readonly label: string;
          /** The row's panel, or the food search for a line with no food. */
          readonly opens: 'panel' | 'entry';
      };

/** The row editor (build spec §7.5.2), as both frames draw it: the phone sheet and the inline panel. */
export interface RowLineEditorView {
    /** The phone sheet's title: the row's food. */
    readonly title: string;
    readonly closeLabel: string;
    /** The food as one line: its name, and its calories per 100 g when food publishes them. */
    readonly food: string;
    readonly ids: Readonly<Record<IngredientEditorField, string>>;
    /** The amount fields' text: empty for no amount, never "0" or "NaN" (R40). */
    readonly amountLow: string;
    readonly amountHigh: string;
    readonly rangeShown: boolean;
    readonly amountInvalid: boolean;
    readonly unit: string;
    readonly unitSuggestions: readonly string[];
    /** U25: the unit is not one the vocabulary knows; text that describes the field, never an invalid mark. */
    readonly unitNote: string | undefined;
    readonly prep: string;
    readonly describedBy: IngredientRowDescriptions;
    /** The food's details can be shown (the row is quiet and food has something to say). */
    readonly detailsOffered: boolean;
    readonly detailsOpen: boolean;
    readonly onAmountLow: (text: string) => void;
    readonly onAmountHigh: (text: string) => void;
    readonly onAddRange: () => void;
    readonly onRemoveRange: () => void;
    readonly onUnit: (text: string) => void;
    readonly onPrep: (text: string) => void;
    /** Change, beside the food; absent where the row's state forbids it (a shortlist row's panel is the remedy). */
    readonly onChangeFood: (() => void) | undefined;
    readonly onToggleDetails: () => void;
    /** Done or Escape: the editor closes and focus returns to the row. */
    readonly onDone: () => void;
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
    /** The amount column's text ("2–2.5 kg"); `''` for no amount, never an invented "1" (F5). */
    readonly amountText: string;
    /** The preparation after the name, or `undefined` when there is none. */
    readonly prepText: string | undefined;
    /** The open control's name: "Edit {amount} {food}" (§7.5.1). */
    readonly openLabel: string;
    /** The second line: none for a healthy row (§7.5.1). */
    readonly secondLine: RowSecondLineView;
    /** U9: the submit refused this row's amounts; the list's error says the rule. */
    readonly amountInvalidNote: string | undefined;
    /** The row's food search is open: the name is the entry field (Change food, Find a food, no food). */
    readonly inEntry: boolean;
    /** This row's editor is open. */
    readonly editorOpen: boolean;
    readonly lineEditor: RowLineEditorView;
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
    readonly labels: IngredientRowLabels;
    /** The entry combobox's input (`rowEntryFieldOf`), for a row whose name is in entry mode. */
    readonly entryField: RowEntryFieldInput;
    /** The `⋯` items (`rowMenuOf`), without the destructive one. */
    readonly actions: readonly ActionMenuItem[];
    /** The `⋯`'s destructive item (Remove), which the menu draws last, after a divider. */
    readonly destructiveAction: ActionMenuItem | undefined;
    readonly openFocus: ControlFocus;
    readonly actionsFocus: ControlFocus;
    /** Rows 6 and 7's panel props, closing the glyph's panel with `close`. */
    readonly shortlist: (close: () => void) => ShortlistPanelProps;
    readonly onRemove: () => void;
    readonly onRetryLookup: () => void;
    /** The open control: open this row's editor. */
    readonly onOpen: () => void;
    /** Start the row's food search (a line with no food's attention line, Find a food, Change food, Change). */
    readonly onBeginEntry: () => void;
    /** Leave the entry without a pick: the field puts back what the line holds, and focus returns to the row. */
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
            quantity: ingredientQuantityDescribedBy(index, standIn, quantityInvalid),
            quantityHigh: quantityInvalid ? ingredientsErrorId : undefined,
            unit: unitNote === undefined ? undefined : ingredientUnitNoteId(index),
        },
    };
};

/**
 * The `⋯`'s and the panel close's names: a variant-bound row names its parts after the food, so two rows on one root
 * differ (item 6). Pure.
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
        panelClose: labelled(
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
    };
};

/** What one of the `⋯`'s items does on this row. */
interface RowActionTarget {
    readonly line: RecipeFormIngredient;
    readonly target: LineCommitTarget & { readonly kind: 'line' };
    readonly displayName: string;
    readonly onRemove: () => void;
    readonly onBeginEntry: () => void;
}

/**
 * The `⋯`: its items in `rowMenuOf`'s order, with Remove taken out as the menu's destructive item. Pure.
 *
 * @param actions - The row's `⋯` items.
 * @param itemOf - Builds one menu item.
 * @returns The menu's actions and its destructive one.
 */
const menuOf = (
    actions: readonly RowMenuAction[],
    itemOf: (action: RowMenuAction) => ActionMenuItem,
): Pick<IngredientRowView, 'actions' | 'destructiveAction'> => ({
    actions: actions.filter((action) => action !== 'remove').map(itemOf),
    destructiveAction: actions.includes('remove') ? itemOf('remove') : undefined,
});

/** One of the `⋯`'s items. Pure. */
const actionItemOf = (action: RowMenuAction, row: RowActionTarget, ctx: IngredientRowContext): ActionMenuItem => {
    const { m, rowEditor, focus } = ctx;
    const { line, target } = row;

    const move = (direction: 'up' | 'down'): void => {
        ctx.onChange(applyDraftAction(ctx.values, { kind: 'moveIngredient', key: line.key, direction }));
        // The row moved under the `⋯`: focus stays on it, wherever it went (native moves its cursor explicitly).
        focus.request(line.key, 'actions');
    };

    switch (action) {
        case 'edit':
            return { id: action, label: m.rowEdit, onSelect: () => ctx.lineEditor.open(line.key) };
        case 'foodDetails':
            return { id: action, label: m.rowFoodDetails, onSelect: () => ctx.openFoodDetails(line.key) };
        case 'moveToGroup':
            return { id: action, label: m.rowMoveToGroup, onSelect: () => ctx.openMoveToGroup(line.key) };
        case 'moveUp':
            return { id: action, label: m.rowMoveUp, onSelect: () => move('up') };
        case 'moveDown':
            return { id: action, label: m.rowMoveDown, onSelect: () => move('down') };
        case 'changeFood':
            return { id: action, label: m.statusActionChangeFood, onSelect: row.onBeginEntry };
        case 'findFood':
            // The quiet row has no field of its own: Find a food opens its food search on the cook's own words.
            return { id: action, label: m.statusActionFindFood, onSelect: row.onBeginEntry };
        case 'createOwnFood':
            return {
                id: action,
                label: m.createCustomFoodIconLabel,
                // §5a: the form shows the name it will create, the text the cook typed or the line's own.
                onSelect: () => rowEditor.authoredFood.open(rowEditor.entry.textOf(target).trim(), target),
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

/** The `⋯` items the row's state and position allow (`rowMenuOf`). Pure. */
const rowMenuActionsOf = (
    line: RecipeFormIngredient,
    presentation: IngredientRowPresentation,
    foodDetails: boolean,
    ctx: IngredientRowContext,
): readonly RowMenuAction[] => {
    const { slot2 } = presentation;

    return rowMenuOf(slot2.kind === 'menu' ? slot2.actions : [slot2.action], {
        foodDetails,
        canMoveUp: canMoveIngredient(ctx.values, line.key, 'up'),
        canMoveDown: canMoveIngredient(ctx.values, line.key, 'down'),
        canMoveToGroup: ctx.groupCount > 0 || groupLabelOf(line) !== undefined,
    });
};

/** The food as the row editor names it: with its calories per 100 g when food publishes them. Pure. */
const editorFoodLine = (line: RecipeFormIngredient, displayName: string, ctx: IngredientRowContext): string => {
    const panel = nutritionPanelOf(line, ctx.nutrition.lookup);
    const calories = panel.kind === 'figures' ? panel.figures.calories : undefined;

    return calories === undefined
        ? displayName
        : fillTemplate(ctx.m.rowFoodCalories, {
              food: displayName,
              cal: new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 0 }).format(calories),
          });
};

/** What the row editor's view is built from, beyond the context. */
interface LineEditorInput {
    readonly line: RecipeFormIngredient;
    readonly index: number;
    readonly displayName: string;
    readonly marks: ReturnType<typeof rowMarksOf>;
    readonly detailsOffered: boolean;
    readonly onChangeFood: (() => void) | undefined;
}

/** The row editor's view (build spec §7.5.2). Pure: its handlers run only when a control calls them. */
const lineEditorOf = (input: LineEditorInput, ctx: IngredientRowContext): RowLineEditorView => {
    const { line, index, displayName, marks } = input;
    const { m, lineEditor, focus } = ctx;
    const edit = rowEditsOf(index, ctx);
    const unit = line.unit ?? '';

    return {
        title: displayName,
        closeLabel: fillTemplate(m.rowEditorClose, { food: displayName }),
        food: editorFoodLine(line, displayName, ctx),
        ids: {
            amount: ingredientEditorFieldId(line.key, 'amount'),
            amountHigh: ingredientEditorFieldId(line.key, 'amountHigh'),
            unit: ingredientEditorFieldId(line.key, 'unit'),
            prep: ingredientEditorFieldId(line.key, 'prep'),
        },
        amountLow: quantityInputValue(line.quantity),
        amountHigh: quantityInputValue(line.quantityHigh),
        rangeShown: line.quantityHigh !== undefined || lineEditor.rangeShown(line.key),
        amountInvalid: marks.quantityInvalid,
        unit,
        unitSuggestions: unitSuggestionsOf(unit),
        unitNote: marks.unitNote,
        prep: line.preparation ?? '',
        describedBy: marks.describedBy,
        detailsOffered: input.detailsOffered,
        detailsOpen: input.detailsOffered && lineEditor.detailsOpen,
        onAmountLow: edit.quantityLow,
        // Typing in the upper bound keeps it shown: emptying it mid-edit must not take the field away.
        onAmountHigh: (text) => {
            lineEditor.showRange(line.key);
            edit.quantityHigh(text);
        },
        onAddRange: () => lineEditor.showRange(line.key),
        onRemoveRange: () => {
            edit.quantityHigh('');
            lineEditor.hideRange(line.key);
        },
        onUnit: edit.unit,
        onPrep: edit.preparation,
        onChangeFood: input.onChangeFood,
        onToggleDetails: lineEditor.toggleDetails,
        onDone: () => {
            lineEditor.close();
            focus.request(line.key, 'open');
        },
    };
};

/** The second line, worded. Pure. */
const secondLineViewOf = (
    line: RecipeFormIngredient,
    inEntry: boolean,
    retrying: boolean,
    triggerFood: string,
    m: RecipeFormMessages,
): RowSecondLineView => {
    const second = inEntry ? ({ kind: 'none' } as const) : rowSecondLineOf(line, retrying);

    switch (second.kind) {
        case 'none':
            return second;
        case 'working':
            return { kind: 'working', text: m[second.text] };
        case 'attention':
            return {
                kind: 'attention',
                text: m[second.text],
                label: fillTemplate(m.rowAttentionLabel, { state: m[second.text], food: triggerFood }),
                opens: second.opens,
            };
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
    // A row with no food searches to FIND one: its copy and its Cancel never say a food is kept.
    const changingFood = changing && namesAFood(line);
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
    const amountText = formatQuantity(draftQuantity(line), ctx.locale, line.unit);
    const triggerFood = presentation.standIn
        ? lineSummary({ ...line, quantity: draftQuantity(line) }, ctx.locale, ctx.shared.ingredientLineName)
        : displayName;
    const failure = ctx.failureOf(target);
    const pendingText = rowPendingSentence(
        {
            refused: rowEditor.pendingRefused,
            pending: entry.isPending(target),
            changing: changingFood,
            text: entry.textOf(target),
            food: displayName,
        },
        m,
    );
    const nameFocus = focus.name(line.key);
    const secondLine = secondLineViewOf(line, changing, retrying, triggerFood, m);
    const foodDetails = secondLine.kind === 'none' && !changing && facts.figures !== 'unpublished';
    const stateActions: readonly IngredientRowAction[] =
        presentation.slot2.kind === 'menu' ? presentation.slot2.actions : [presentation.slot2.action];
    const prep = line.preparation?.trim();

    const onRemove = (): void => {
        if (busy) {
            return;
        }

        const removal = removalFocusTarget(ctx.values.ingredients, index);

        rowEditor.dispatch({ kind: 'removeIngredient', key: line.key });

        // §7.5.1: hand focus on to the next row rather than drop it to the page.
        if (removal.kind === 'open') {
            focus.request(removal.key, 'open');
        } else {
            focus.requestTrailing();
        }
    };

    const onBeginEntry = (): void => {
        ctx.moveOn();
        entry.beginChange(line.key);
        focus.request(line.key, 'name');
    };

    // Item 4: the entry ends without a pick and focus returns to the row, as the row editor's does (§7.5.2).
    const onLeaveEntry = (): void => {
        ctx.moveOn();
        entry.abandon(target);
        focus.request(line.key, 'open');
    };

    const canChangeFood =
        stateActions.includes('changeFood') ||
        stateActions.includes('findFood') ||
        (secondLine.kind === 'attention' && secondLine.opens === 'entry');

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
        amountText,
        prepText: prep === undefined || prep === '' ? undefined : prep,
        openLabel: fillTemplate(m.rowOpenLabel, {
            item: presentation.standIn ? triggerFood : `${amountText} ${displayName}`.trim(),
        }),
        secondLine,
        amountInvalidNote: marks.quantityInvalid ? m.rowAmountInvalid : undefined,
        inEntry: changing,
        editorOpen: ctx.lineEditor.openKey === line.key,
        lineEditor: lineEditorOf(
            {
                line,
                index,
                displayName,
                marks,
                detailsOffered: foodDetails,
                onChangeFood: canChangeFood
                    ? () => {
                          ctx.lineEditor.close();
                          onBeginEntry();
                      }
                    : undefined,
            },
            ctx,
        ),
        noFoodNote: marks.noFoodNote,
        unitNote: marks.unitNote,
        quantityInvalid: marks.quantityInvalid,
        describedBy: marks.describedBy,
        pendingText,
        failure,
        busyText: rowBusyText(inFlight, ctx.commitCopy, rowEditor.naming),
        busy,
        retrying,
        labels: rowLabelsOf(m, variantParts, triggerFood, displayName),
        entryField: {
            target,
            number,
            entry,
            changing: changingFood,
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
        ...menuOf(rowMenuActionsOf(line, presentation, foodDetails, ctx), (action) =>
            actionItemOf(action, { line, target, displayName, onRemove, onBeginEntry }, ctx),
        ),
        openFocus: focus.open(line.key),
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
                // The attention line and its panel go as the row enters its search, so there is no focus return to wait
                // for: the field asks for focus at once.
                entry.beginChange(line.key);
                focus.request(line.key, 'name');
                close();
            },
        }),
        onRemove,
        onRetryLookup: () => {
            if (line.ingredientId !== null) {
                lookupRetry.retry(line.ingredientId, line.key);
                // The attention line that opened the panel gives way to "Looking it up…" while the ask runs, so focus
                // goes to the control that stays: the row's open control (§2d: never dropped to the page).
                focus.request(line.key, 'open');
            }
        },
        onOpen: () => ctx.lineEditor.open(line.key),
        onBeginEntry,
        onLeaveEntry,
        onFocusLeft: () => {
            if (changing) {
                entry.leave(target);
            }
        },
        edit: rowEditsOf(index, ctx),
    };
};
