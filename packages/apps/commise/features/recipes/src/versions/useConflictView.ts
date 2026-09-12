/**
 * @module @commise/features-recipes/versions — the conflict view's local UI state and its gates, shared by the web and
 * native `RecipeConflictView` leaves (T070 / C-005 / W7).
 *
 * Two pieces of state stay local because the `useRecipeEditor` machine does not need them: whether the merge panel is
 * showing, and the stale-base confirmation (W7 Task 5 / X6). Both reset when a NEW conflict arrives on the same instance
 * (`server.versionNumber` changes, and a fresh 409 always carries the server's current version): a confirmation ticked
 * for the prior conflict would otherwise authorize Overwrite or Save merged on one the cook never confirmed, and the
 * merge panel would show the prior conflict's rows. The reset happens during render, React's documented form for state
 * keyed on a prop; an effect committed one frame of the new conflict with the old confirmation still ticked.
 *
 * `selections` stays the caller's. An absent key is NO side, so neither radio is checked and the summary and the gate
 * count only explicit picks; `composeConflictMerge` still composes an absent key as mine.
 *
 * @pattern Headless hook — the state, the gates and the commands, which each leaf draws and combines with `isResolving`
 */
import { useState } from 'react';

import { isConflictBaseStale, type RecipeConflictViewProps } from './conflictView.js';
import type { MergeSide } from './merge.js';

/** What a `RecipeConflictView` leaf draws and wires. */
export interface ConflictViewModel {
    /** Whether the field-by-field merge panel (Option C) is showing. */
    readonly merging: boolean;
    /** Option C: show the merge panel. */
    readonly startMerge: () => void;
    /** Leave the merge panel, clearing every pick. */
    readonly leaveMerge: () => void;
    /** Whether the base was evicted or is too far behind (X6), so Overwrite and Save merged need a confirmation. */
    readonly isStale: boolean;
    readonly staleConfirmed: boolean;
    readonly setStaleConfirmed: (confirmed: boolean) => void;
    /** Whether the cook has picked any side. */
    readonly hasSelection: boolean;
    /** Overwrite's gate: a stale base not yet confirmed. */
    readonly overwriteBlocked: boolean;
    /** Save merged's gates: no pick yet, or a stale base not yet confirmed (X5, X6). */
    readonly mergeBlocked: boolean;
    /** The side picked for `key`, or `undefined` when none is. */
    readonly sideOf: (key: string) => MergeSide | undefined;
    /** Pick `side` for `key`. */
    readonly choose: (key: string, side: MergeSide) => void;
}

/**
 * The conflict view's local state, its gates and its commands.
 *
 * @param props - The leaf's props this state reads.
 * @returns The state and its commands.
 * @sideEffect Resets its own state during render when a new conflict arrives.
 */
export function useConflictView(
    props: Pick<RecipeConflictViewProps, 'server' | 'base' | 'versionsBehind' | 'selections' | 'onSelectionsChange'>,
): ConflictViewModel {
    const { server, base, versionsBehind, selections, onSelectionsChange } = props;
    const [merging, setMerging] = useState(false);
    const [staleConfirmed, setStaleConfirmed] = useState(false);
    const [conflictVersion, setConflictVersion] = useState(server.versionNumber);

    if (conflictVersion !== server.versionNumber) {
        setConflictVersion(server.versionNumber);
        setStaleConfirmed(false);
        setMerging(false);
    }

    const isStale = isConflictBaseStale(base, versionsBehind);
    const hasSelection = Object.keys(selections).length > 0;
    const staleUnconfirmed = isStale && !staleConfirmed;

    return {
        merging,
        startMerge: () => setMerging(true),
        leaveMerge: () => {
            onSelectionsChange({});
            setMerging(false);
        },
        isStale,
        staleConfirmed,
        setStaleConfirmed,
        hasSelection,
        overwriteBlocked: staleUnconfirmed,
        mergeBlocked: !hasSelection || staleUnconfirmed,
        sideOf: (key) => selections[key],
        choose: (key, side) => onSelectionsChange({ ...selections, [key]: side }),
    };
}
