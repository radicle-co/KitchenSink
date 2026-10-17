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
import type { IngredientLineKey } from './lineKey.js';

/** What the state is held over. */
interface LineEditorStateState {
    readonly openKey: IngredientLineKey | undefined;
    readonly ranges: ReadonlySet<IngredientLineKey>;
    readonly detailsOpen: boolean;
    /** The Amount field's typed text, by line and bound, for the editor that is open. */
    readonly amountTexts: ReadonlyMap<string, string>;
}

const CLOSED: LineEditorStateState = {
    openKey: undefined,
    ranges: new Set(),
    detailsOpen: false,
    amountTexts: new Map(),
};

/** One bound's slot in `amountTexts`. Pure. */
const amountSlot = (key: IngredientLineKey, bound: AmountBound): string => `${key}:${bound}`;

/**
 * The row editor's view state.
 *
 * @param keys - The draft's line keys: an open editor whose row is gone is closed.
 * @returns The state and its commands.
 */
export function useLineEditorState(keys: readonly IngredientLineKey[]): LineEditorState {
    const [state, setState] = useState(CLOSED);
    const openKey = state.openKey !== undefined && keys.includes(state.openKey) ? state.openKey : undefined;

    return {
        openKey,
        // Another open editor closes; its values are the draft's already. Its details start closed, its Amount text fresh.
        open: (key) =>
            setState((current) => ({ ...current, openKey: key, detailsOpen: false, amountTexts: new Map() })),
        close: () =>
            setState((current) => ({ ...current, openKey: undefined, detailsOpen: false, amountTexts: new Map() })),
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
