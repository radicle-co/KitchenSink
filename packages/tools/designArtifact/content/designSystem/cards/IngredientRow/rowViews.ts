/**
 * @module IngredientRow/rowViews — the rows the IngredientRow card shows, typed as the product's own `IngredientRowView`.
 *
 * A row is drawn from a view model (`ingredientRowViewOf` builds it from hook state), so a card has no props to hand it
 * but a whole view: every field below is the real contract, and a field the product adds or renames fails `tsc` here.
 * Nothing is cast. The one value only the product can mint is the branded line key, which the card gets from the
 * surface (`seedLineKey`) and passes in.
 *
 * Type-only imports of the product (`#commise/*`, see `tsconfig.json`): nothing here reaches the bundle.
 */
import type { IngredientRowView } from '#commise/features/recipes/src/form/ingredientRowView';
import type { seedLineKey } from '#commise/features/recipes/src/form/lineKey';

const noop = (): void => undefined;
const focus = { requested: false, onHandled: noop };

const naming: IngredientRowView['entryField']['naming'] = {
    sourceName: () => undefined,
    formatTime: () => '',
    formatList: (items) => items.join(', '),
};

/** The hoisted entry, idle: no field is searching and nothing is pending. */
const entry: IngredientRowView['entryField']['entry'] = {
    textOf: () => '',
    setText: noop,
    focus: noop,
    active: undefined,
    isActive: () => false,
    view: { kind: 'idle' },
    databaseSaidEarly: false,
    changing: new Set(),
    beginChange: noop,
    abandon: noop,
    leave: noop,
    pending: undefined,
    isPending: () => false,
    pendingEntryText: '',
    placement: undefined,
    place: noop,
    selectFood: noop,
    selectRemoteFood: noop,
    findByName: noop,
    declareAsWritten: noop,
};

/** The facts that differ from row to row; everything else is the quiet, healthy row. */
export interface RowFacts {
    readonly name: string;
    readonly amount: string;
    readonly prep?: string;
    readonly variantParts?: IngredientRowView['variantParts'];
    readonly tone?: IngredientRowView['presentation']['tone'];
    readonly secondLine?: IngredientRowView['secondLine'];
    readonly working?: boolean;
    readonly failure?: string;
}

/**
 * One row's view.
 *
 * @param seed - The product's line-key factory (`seedLineKey`), from the surface.
 * @param number - The row's 1-based number.
 * @param facts - What this row says.
 * @returns A complete `IngredientRowView`.
 */
function rowView(seed: typeof seedLineKey, number: number, facts: RowFacts): IngredientRowView {
    const key = seed(1, number - 1);
    const openLabel = `Edit ${facts.amount} ${facts.name}`.replace('  ', ' ');
    const remove = { id: 'rm', label: 'Remove ingredient', icon: 'trash', onSelect: noop } as const;

    return {
        line: { key, ingredientId: null, isUserEntered: false, quantity: 1, name: facts.name },
        index: number - 1,
        number,
        presentation: {
            nameMode: 'record',
            standIn: false,
            glyph: facts.secondLine?.kind === 'attention' ? 'alert' : 'info',
            panel: 'nutrition',
            slot2: { kind: 'menu', actions: ['changeFood', 'remove'] },
            statusWord: undefined,
            tone: facts.tone ?? 'neutral',
        },
        body: { kind: 'nutrition' },
        standIn: false,
        displayName: facts.name,
        triggerFood: facts.name,
        variantParts: facts.variantParts,
        changing: false,
        amountText: facts.amount,
        prepText: facts.prep,
        openLabel,
        secondLine: facts.secondLine ?? { kind: 'none' },
        amountInvalidNote: undefined,
        inEntry: false,
        editorOpen: false,
        lineEditor: {
            title: facts.name,
            closeLabel: 'Close',
            food: facts.name,
            ids: {
                amount: `a${String(number)}`,
                amountHigh: `h${String(number)}`,
                unit: `u${String(number)}`,
                prep: `p${String(number)}`,
            },
            amountLow: '',
            amountHigh: '',
            rangeShown: false,
            amountInvalid: false,
            amountNote: undefined,
            unit: '',
            unitSuggestions: [],
            unitNote: undefined,
            prep: facts.prep ?? '',
            describedBy: { quantity: undefined, quantityHigh: undefined, unit: undefined },
            detailsOffered: false,
            detailsOpen: false,
            onAmountLow: noop,
            onAmountHigh: noop,
            onAddRange: noop,
            onRemoveRange: noop,
            onUnit: noop,
            onPrep: noop,
            onChangeFood: undefined,
            onToggleDetails: noop,
            onDone: noop,
        },
        noFoodNote: undefined,
        unitNote: undefined,
        quantityInvalid: false,
        describedBy: { quantity: undefined, quantityHigh: undefined, unit: undefined },
        pendingText: undefined,
        failure: facts.failure,
        busyText: facts.working === true ? 'Looking up nutrition' : undefined,
        busy: facts.working === true,
        retrying: false,
        labels: {
            panelClose: 'Close',
            actionsTrigger: `Actions for ${facts.name}`,
            actionsClose: `Close actions for ${facts.name}`,
        },
        entryField: {
            target: { kind: 'line', key },
            number,
            entry,
            changing: false,
            food: facts.name,
            invalid: false,
            pickFailure: undefined,
            refusal: undefined,
            describedBy: undefined,
            focusRequested: false,
            listRequested: false,
            refusalOccurrence: 0,
            onFocusRequestHandled: noop,
            onCancel: noop,
            onAbandon: noop,
            onTextChange: noop,
            naming,
            limitRefusals: 0,
        },
        actions: [
            { id: 'e', label: 'Edit amount', icon: 'pencilLine', onSelect: noop },
            { id: 'c', label: 'Change food', icon: 'search', onSelect: noop },
        ],
        destructiveAction: remove,
        openFocus: focus,
        actionsFocus: focus,
        shortlist: () => ({
            reason: 'ambiguous',
            food: facts.name,
            phrase: facts.name,
            inFlight: undefined,
            lastPick: undefined,
            limitRefusals: 0,
            holdLimit: noop,
            naming,
            onPick: () => Promise.resolve({ kind: 'failed' }),
            onSettled: noop,
            onNoneOfThese: noop,
        }),
        onRemove: noop,
        onRetryLookup: noop,
        onOpen: noop,
        onBeginEntry: noop,
        onLeaveEntry: noop,
        onFocusLeft: noop,
        edit: { quantityLow: noop, quantityHigh: noop, unit: noop, preparation: noop },
    };
}

/**
 * The six rows of the card: a plain row, a prep note, variant parts, a working line, two attention lines (one opening
 * the panel, one opening entry) and a failure.
 *
 * @param seed - The product's line-key factory (`seedLineKey`), from the surface.
 * @returns The rows, in order.
 */
export function rowViews(seed: typeof seedLineKey): readonly IngredientRowView[] {
    return [
        rowView(seed, 1, { name: 'all-purpose flour', amount: '2 cups', prep: 'sifted' }),
        rowView(seed, 2, { name: 'smoked paprika', amount: '1 tsp', variantParts: ['Hungarian', 'sweet'] }),
        rowView(seed, 3, {
            name: 'olive oil',
            amount: '2–3 tbsp',
            secondLine: { kind: 'working', text: 'Looking up nutrition' },
            working: true,
        }),
        rowView(seed, 4, {
            name: 'tomatoes',
            amount: '400 g',
            tone: 'caution',
            secondLine: {
                kind: 'attention',
                text: 'Choose the right tomatoes',
                label: 'Choose the right tomatoes for tomatoes',
                opens: 'panel',
            },
        }),
        rowView(seed, 5, {
            name: 'a pinch of saffron',
            amount: '',
            tone: 'caution',
            secondLine: {
                kind: 'attention',
                text: 'Find a food',
                label: 'Find a food for a pinch of saffron',
                opens: 'entry',
            },
        }),
        rowView(seed, 6, {
            name: 'garlic',
            amount: '3 cloves',
            failure: 'Could not save this food. Try again.',
        }),
    ];
}
