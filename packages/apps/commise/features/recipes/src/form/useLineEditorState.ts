/**
 * @module @commise/features-recipes/form — the row editor's view state (build spec §7.5.2): which row's editor is open
 * (one at a time), which rows show their range before it holds an upper bound, and whether the open editor shows its
 * food's details. View state only: every value the editor edits is the draft's already, so closing it loses nothing.
 *
 * @pattern Headless hook — the row editor's open state, which `ingredientRowViewOf` reads through `LineEditorState`
 */
import { useState } from 'react';

import type { LineEditorState } from './ingredientRowView.js';
import type { IngredientLineKey } from './lineKey.js';

/** What the state is held over. */
interface LineEditorStateState {
    readonly openKey: IngredientLineKey | undefined;
    readonly ranges: ReadonlySet<IngredientLineKey>;
    readonly detailsOpen: boolean;
}

const CLOSED: LineEditorStateState = { openKey: undefined, ranges: new Set(), detailsOpen: false };

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
        // Another open editor closes; its values are the draft's already. Its details start closed.
        open: (key) => setState((current) => ({ ...current, openKey: key, detailsOpen: false })),
        close: () => setState((current) => ({ ...current, openKey: undefined, detailsOpen: false })),
        rangeShown: (key) => state.ranges.has(key),
        showRange: (key) => setState((current) => ({ ...current, ranges: new Set([...current.ranges, key]) })),
        hideRange: (key) =>
            setState((current) => ({
                ...current,
                ranges: new Set([...current.ranges].filter((each) => each !== key)),
            })),
        detailsOpen: openKey !== undefined && state.detailsOpen,
        toggleDetails: () => setState((current) => ({ ...current, detailsOpen: !current.detailsOpen })),
    };
}
