/**
 * @module @commise/features-recipes/form — the row editor's view state (build spec §7.5.2): which row's editor is open
 * (one at a time), which rows show their range before it holds an upper bound, whether the open editor shows its
 * food's details, and the text the cook is typing in its Amount field. View state only: every value the editor edits is
 * the draft's already. The one thing closing it drops is Amount text that states no amount: the field marks it while
 * the editor is open, and the draft keeps the last amount it could read.
 *
 * @pattern Headless hook — the row editor's open state, which `ingredientRowViewOf` reads through `LineEditorState`
 */
import { useState } from 'react';

import type { AmountBound, LineEditorState } from './ingredientRowView.js';
import { captureLineFields, type LineFieldsMemento } from './lineFieldsMemento.js';
import type { IngredientLineKey } from './lineKey.js';
import type { RecipeFormIngredient } from './values.js';

/** What the state is held over. */
interface LineEditorStateState {
    readonly openKey: IngredientLineKey | undefined;
    readonly ranges: ReadonlySet<IngredientLineKey>;
    readonly detailsOpen: boolean;
    /** The Amount field's typed text, by line and bound, for the editor that is open. */
    readonly amountTexts: ReadonlyMap<string, string>;
    /** What the open editor's Cancel puts back: the line as it was when the editor opened, and whether its range showed. */
    readonly opened:
        | { readonly key: IngredientLineKey; readonly memento: LineFieldsMemento; readonly rangeShown: boolean }
        | undefined;
}

const CLOSED: LineEditorStateState = {
    openKey: undefined,
    ranges: new Set(),
    detailsOpen: false,
    amountTexts: new Map(),
    opened: undefined,
};

/** `state` with `line`'s editor open: its restore point taken, its details closed, its Amount text fresh. Pure. */
const openedState = (state: LineEditorStateState, line: RecipeFormIngredient): LineEditorStateState => ({
    ...state,
    openKey: line.key,
    detailsOpen: false,
    amountTexts: new Map(),
    opened: { key: line.key, memento: captureLineFields(line), rangeShown: state.ranges.has(line.key) },
});

/** One bound's slot in `amountTexts`. Pure. */
const amountSlot = (key: IngredientLineKey, bound: AmountBound): string => `${key}:${bound}`;

/**
 * The row editor's view state.
 *
 * @param lines - The draft's lines: an open editor whose row is gone is closed, and `open` captures a restore point
 *     from the line.
 * @param initialKey - A row to open on the first render only (an arrival from a link). The lazy initialiser reads it
 *     once, so closing the editor and re-rendering never reopens it. A key no line holds opens nothing.
 * @returns The state and its commands.
 */
export function useLineEditorState(
    lines: readonly RecipeFormIngredient[],
    initialKey?: IngredientLineKey,
): LineEditorState {
    const [state, setState] = useState<LineEditorStateState>(() => {
        const line = lines.find((each) => each.key === initialKey);

        return line === undefined ? CLOSED : openedState(CLOSED, line);
    });
    const openKey =
        state.openKey !== undefined && lines.some((line) => line.key === state.openKey) ? state.openKey : undefined;

    return {
        openKey,
        // Another open editor closes; its values are the draft's already. Its details start closed, its Amount text fresh.
        open: (key) => {
            const line = lines.find((each) => each.key === key);

            setState((current) => (line === undefined ? current : openedState(current, line)));
        },
        close: () =>
            setState((current) => ({
                ...current,
                openKey: undefined,
                detailsOpen: false,
                amountTexts: new Map(),
                opened: undefined,
            })),
        restorePoint: (key) =>
            state.opened?.key === key
                ? { memento: state.opened.memento, rangeShown: state.opened.rangeShown }
                : undefined,
        rangeShown: (key) => state.ranges.has(key),
        showRange: (key) => setState((current) => ({ ...current, ranges: new Set([...current.ranges, key]) })),
        hideRange: (key) =>
            setState((current) => ({
                ...current,
                ranges: new Set([...current.ranges].filter((each) => each !== key)),
            })),
        detailsOpen: openKey !== undefined && state.detailsOpen,
        toggleDetails: () => setState((current) => ({ ...current, detailsOpen: !current.detailsOpen })),
        amountText: (key, bound) => (openKey === key ? state.amountTexts.get(amountSlot(key, bound)) : undefined),
        setAmountText: (key, bound, text) =>
            setState((current) => ({
                ...current,
                amountTexts: new Map(current.amountTexts).set(amountSlot(key, bound), text),
            })),
    };
}
