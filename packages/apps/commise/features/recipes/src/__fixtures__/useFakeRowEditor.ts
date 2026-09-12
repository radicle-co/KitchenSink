/**
 * @module @commise/features-recipes/__fixtures__ — a row editor for leaf tests whose entry is STATEFUL over the entry's
 * real pure model (`hooks/ingredientEntry.model.ts`): Change food, a cancel, typed and pending text all move as they do
 * in `useIngredientEntry`, with no query, no client and no debounce. Whether the cook moved past what settled moves as
 * it does in `useIngredientRowEditor`: a new `settled` stands until `moveOn`. The search views and the rest of the
 * controllers are what the test passes in.
 */
import { useState } from 'react';

import {
    EMPTY_ENTRY,
    changingOf,
    entryTextOf,
    isPendingAt,
    pendingEntryOf,
    withActiveTarget,
    withChangeBegun,
    withEntryAbandoned,
    withEntryLeft,
    withEntryText,
    type EntryLine,
} from '../hooks/ingredientEntry.model.js';
import type { LineCommitTarget } from '../hooks/lineCommit.js';
import type { IngredientEntry } from '../hooks/useIngredientEntry.js';
import type { IngredientRowEditor } from '../hooks/useIngredientRowEditor.js';
import { makeIngredientEntry, makeIngredientRowEditor } from './index.js';

/** What a test replaces: entry actions (often spies) and the other controllers. */
export interface FakeRowEditorOverrides {
    readonly entry?: Partial<IngredientEntry>;
    readonly editor?: Partial<Omit<IngredientRowEditor, 'entry'>>;
}

const keyOf = (target: LineCommitTarget): string => (target.kind === 'line' ? target.key : 'newLine');

/**
 * A row editor whose entry moves over the real model.
 *
 * @param lines - The draft's lines.
 * @param over - What the test replaces. An entry action given here runs AFTER the model's own transition.
 * @returns The row editor.
 */
export function useFakeRowEditor(lines: readonly EntryLine[], over: FakeRowEditorOverrides = {}): IngredientRowEditor {
    const [state, setState] = useState(EMPTY_ENTRY);
    const [movedPastFrom, setMovedPastFrom] = useState<IngredientRowEditor['settled']>(undefined);
    const settled = over.editor?.settled;
    const activeKey = state.active === undefined ? undefined : keyOf(state.active);
    const pending = pendingEntryOf(state, lines);
    const spies = over.entry ?? {};

    return makeIngredientRowEditor({
        movedPast: settled === movedPastFrom,
        moveOn: () => setMovedPastFrom(settled),
        ...over.editor,
        entry: makeIngredientEntry({
            ...spies,
            textOf: (target) => entryTextOf(state, target, lines),
            setText: (target, text) => {
                setState((current) => withEntryText(current, target, text, lines));
                spies.setText?.(target, text);
            },
            focus: (target) => {
                setState((current) => withActiveTarget(current, target));
                spies.focus?.(target);
            },
            active: state.active,
            isActive: (target) => activeKey === keyOf(target),
            changing: changingOf(state, lines),
            beginChange: (key) => {
                const line = lines.find((each) => each.key === key);

                if (line !== undefined) {
                    setState((current) => withChangeBegun(current, line));
                }

                spies.beginChange?.(key);
            },
            abandon: (target) => {
                setState((current) => withEntryAbandoned(current, target));
                spies.abandon?.(target);
            },
            leave: (target) => {
                setState((current) => withEntryLeft(current, target));
                spies.leave?.(target);
            },
            pending,
            pendingEntryText: pending?.text ?? '',
            isPending: (target) => isPendingAt(state, target, lines),
        }),
    });
}
