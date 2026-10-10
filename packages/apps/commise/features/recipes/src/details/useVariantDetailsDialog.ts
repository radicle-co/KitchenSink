/**
 * @module details/useVariantDetailsDialog — the details dialog's orchestration hook (curated U14), shared by the web
 * and native leaves.
 *
 * @pattern Headless hook — it reads the root's variants straight from food-service (plan 002 S5), derives the
 * statechart's state, and turns each pick, removal or close into one outcome for the host's commit port
 *
 * ⛔ The read is never copied into state. The state is derived on every render from the query and the search text
 * (`deriveDetailsDialogState`), so a refetch can never leave the dialog showing a state its read no longer supports.
 */
import { useLocale } from '@commise/i18n/react';
import type { GetFoodResult } from '@kitchensink/food-service-client';
import { useFood } from '@kitchensink/food-service-client/hooks';
import { useMemo, useState } from 'react';

import { queryReadState } from '../hooks/queryReadState.js';
import { useAppFocused } from '../hooks/useAppFocused.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import {
    type DetailsDialogCommitPort,
    type DetailsDialogEntry,
    type DetailsDialogOutcome,
    type DetailsDialogState,
    type DetailsRead,
    type SettledSearch,
    closeOutcome,
    deriveDetailsDialogState,
    pickOutcome,
    removeOutcome,
    settledSearchOf,
} from './detailsDialogMachine.js';
import { type VariantListPlan, type VariantRow, planVariantList } from './groupVariants.js';

/** How long the search result waits after the last key press before it is announced (§S8.5). */
const SEARCH_ANNOUNCE_DELAY_MS = 500;

/** The hook's inputs. */
export interface UseVariantDetailsDialogOptions {
    /** Whether the dialog is open. Nothing is read while it is closed, and each opening starts with an empty search. */
    readonly open: boolean;
    /** The root whose variants the dialog lists. */
    readonly rootId: string;
    readonly entry: DetailsDialogEntry;
    /**
     * The host's commit port. The host closes the dialog, announces the result in a region that outlives the dialog,
     * and returns focus to the row's `⋮` (§S8.8). ⚠️ On native that return is the host's close count
     * (`useScreenReaderFocusOnSignal`), and every outcome closes the dialog, a pick and a removal included, so the host
     * advances the count here and not only on Close. The hook settles after one outcome until the next opening.
     */
    readonly onOutcome: DetailsDialogCommitPort;
}

/** What the leaves render and wire. */
export interface VariantDetailsDialogModel {
    /** How the dialog was opened: the title, and whether `Remove details` exists, follow it. */
    readonly mode: DetailsDialogEntry['mode'];
    readonly state: DetailsDialogState;
    readonly query: string;
    readonly onQueryChange: (query: string) => void;
    readonly onClearQuery: () => void;
    readonly onRetry: () => void;
    readonly onPick: (row: VariantRow) => void;
    /** `undefined` where the statechart has no `removed` edge, so the leaves render no `Remove details`. */
    readonly onRemove: (() => void) | undefined;
    readonly onClose: () => void;
    /**
     * The search to announce once typing has stopped: the count of matching rows, or "no matches" with its query.
     * `undefined` while the search text is still changing, and when there is no search.
     */
    readonly announcedCount: SettledSearch | undefined;
}

/** The query fields the read depends on. */
interface FoodQueryView {
    readonly data: GetFoodResult | undefined;
    readonly isError: boolean;
    readonly fetchStatus: 'fetching' | 'paused' | 'idle';
}

/**
 * The statechart's read, from the food query (`queryReadState`'s rule). Pure.
 *
 * ⚠️ A food that is not yet `RESOLVED` is a failure to retry, never "no details": it answers `202` while food
 * resolves it, and reading it as an empty list would claim the root has nothing to choose.
 *
 * @param query - The food query.
 * @param plan - The list planned from a resolved read.
 * @param appIsFocused - Whether the app has focus: a read parked in the background is not offline.
 * @returns The read.
 */
function detailsReadOf(query: FoodQueryView, plan: VariantListPlan | undefined, appIsFocused: boolean): DetailsRead {
    const state = queryReadState(
        { value: plan, failed: query.isError || query.data !== undefined, fetchStatus: query.fetchStatus },
        appIsFocused,
    );

    switch (state.kind) {
        case 'settled':
            return { kind: 'loaded', plan: state.value };
        case 'offline':
            return { kind: 'parked' };
        case 'failed':
            return { kind: 'failed' };
        case 'loading':
            return { kind: 'loading' };
    }
}

/**
 * Orchestrate the details dialog.
 *
 * @param options - The opening, the root, the entry mode and the host's commit port.
 * @returns The state and its handlers.
 * @sideEffect Reads `GET /api/v1/foods/{rootId}` from food-service while open, and calls `onOutcome`.
 */
export function useVariantDetailsDialog(options: UseVariantDetailsDialogOptions): VariantDetailsDialogModel {
    const { open, rootId, entry, onOutcome } = options;
    const locale = useLocale();
    const [query, setQuery] = useState('');
    const [settled, setSettled] = useState(false);
    const [wasOpen, setWasOpen] = useState(open);

    // Each opening starts with an empty search and nothing settled. Adjusted during render, React's previous-value
    // form.
    if (open !== wasOpen) {
        setWasOpen(open);

        if (open) {
            setQuery('');
            setSettled(false);
        }
    }

    // The statechart's final states end the dialog: after one outcome, every handler is inert until it opens again.
    // A native sheet slides out, and a row can still take a tap while it does; without this a second tap is a second
    // write. Two taps are two events, and React re-renders between them, so the second sees `settled`.
    const report = (outcome: DetailsDialogOutcome): void => {
        if (settled) {
            return;
        }

        setSettled(true);
        onOutcome(outcome);
    };

    const food = useFood(rootId, { enabled: open });
    const appIsFocused = useAppFocused();
    const data = food.data;
    const plan = useMemo(
        () => (data?.status === 'RESOLVED' ? planVariantList(data.food.variants, locale) : undefined),
        [data, locale],
    );
    const read = detailsReadOf(food, plan, appIsFocused);
    const state = deriveDetailsDialogState({ read, entry, query, locale });
    const removal = removeOutcome(entry, state);
    // The text is debounced, not the count: "no matches" stays at 0 while the query in its sentence changes.
    const settledQuery = useDebouncedValue(query, SEARCH_ANNOUNCE_DELAY_MS);

    return {
        mode: entry.mode,
        state,
        query,
        onQueryChange: setQuery,
        onClearQuery: () => setQuery(''),
        onRetry: () => {
            void food.refetch();
        },
        onPick: (row) => report(pickOutcome(entry, row)),
        onRemove: removal === undefined ? undefined : () => report(removal),
        onClose: () => report(closeOutcome()),
        announcedCount: settledQuery === query ? settledSearchOf(state) : undefined,
    };
}
