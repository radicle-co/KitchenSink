/**
 * @module details/detailsDialogMachine — the details dialog's statechart (curated plan U14, "Details dialog
 * statechart"; `docs/design/ingredientSpecialization.md` §S8.3 to §S8.8).
 *
 * @pattern Visitor — an exhaustive switch over the derived state union. Every read-driven state is DERIVED from the
 * food read and the search text, never stored, so a refetch or a keystroke cannot leave the dialog in a state its
 * inputs no longer support. Its final states (committed, removed, dismissed) live in `useVariantDetailsDialog`'s
 * `report`, which makes every handler inert after one outcome
 * @pattern Command — a pick, a removal or a close becomes one {@link DetailsDialogOutcome} for the host's commit port
 *
 * ⛔ The machine never branches on where a pick is written. The host's port does: a write-layer mutation on a saved
 * recipe, or the local form value on the create and edit form and on import review (§S8.9).
 *
 * ⚠️ `offline` is a state with no edges of its own: a read parked while the app has focus derives it, the leaves render
 * the app-wide `OfflineReadSlot`, and the read resumes by itself.
 */
import type { IngredientVariant } from '@kitchensink/recipe-core';

import {
    type LongVariantListPlan,
    type VariantListPlan,
    type VariantRow,
    filterVariantList,
    rowsOfPlan,
} from './groupVariants.js';

/**
 * How the dialog was opened. `edit` carries the line's own binding, so a retired current variant keeps its parts
 * (R29) and `Remove details` exists (§S8.6).
 */
export type DetailsDialogEntry =
    { readonly mode: 'add' } | { readonly mode: 'edit'; readonly current: IngredientVariant };

/**
 * The food read, as the machine needs it.
 *
 * - `parked`: TanStack paused the read for want of a connection, with nothing cached.
 * - `loaded`: the root's live variants, planned once.
 */
export type DetailsRead =
    | { readonly kind: 'loading' }
    | { readonly kind: 'parked' }
    | { readonly kind: 'failed' }
    | { readonly kind: 'loaded'; readonly plan: VariantListPlan };

/** The current variant in `edit` mode, and whether the list shows it (a retired one is not listed). */
export interface CurrentMark {
    readonly variant: IngredientVariant;
    readonly listed: boolean;
}

/** The dialog's state. */
export type DetailsDialogState =
    | { readonly name: 'loading' }
    | { readonly name: 'offline' }
    | { readonly name: 'error' }
    | { readonly name: 'noVariants' }
    | { readonly name: 'detailsNoneLeft'; readonly current: IngredientVariant }
    | { readonly name: 'combined'; readonly rows: readonly VariantRow[]; readonly current: CurrentMark | undefined }
    | {
          readonly name: 'longList';
          readonly plan: LongVariantListPlan;
          readonly total: number;
          readonly current: CurrentMark | undefined;
      }
    | {
          readonly name: 'searching';
          readonly plan: LongVariantListPlan;
          readonly shown: number;
          readonly total: number;
          readonly current: CurrentMark | undefined;
      }
    | {
          readonly name: 'noMatches';
          readonly query: string;
          readonly total: number;
          readonly current: CurrentMark | undefined;
      };

/** The name of a dialog state. */
type DetailsDialogStateName = DetailsDialogState['name'];

/** The outcome of a search, out of the list's `total` rows: the rows it leaves, or none (§S8.5). */
export type SettledSearch =
    | { readonly kind: 'matches'; readonly shown: number; readonly total: number }
    | { readonly kind: 'noMatches'; readonly query: string; readonly total: number };

/**
 * The search a state announces once its search text has stopped changing, or `undefined` for a state with no search.
 * Pure.
 *
 * @param state - The dialog's state.
 * @returns The search to announce.
 */
export function settledSearchOf(state: DetailsDialogState): SettledSearch | undefined {
    switch (state.name) {
        case 'searching':
            return { kind: 'matches', shown: state.shown, total: state.total };
        case 'noMatches':
            return { kind: 'noMatches', query: state.query, total: state.total };
        default:
            return undefined;
    }
}

/** What the dialog asks its host to do as it closes (§S8.8). */
export type DetailsDialogOutcome =
    | { readonly kind: 'dismissed' }
    | { readonly kind: 'committed'; readonly mode: DetailsDialogEntry['mode']; readonly variant: IngredientVariant }
    | { readonly kind: 'removed' };

/** The host's commit port: it writes a commit or a removal, closes the dialog, and announces the result. */
export type DetailsDialogCommitPort = (outcome: DetailsDialogOutcome) => void;

/** The inputs a state is derived from. */
export interface DetailsDialogInput {
    readonly read: DetailsRead;
    readonly entry: DetailsDialogEntry;
    /** The long list's search text. A short list has no search, so its text is ignored. */
    readonly query: string;
    readonly locale: string;
}

/** The current mark for `entry` over the listed rows. */
function currentMarkOf(entry: DetailsDialogEntry, rows: readonly VariantRow[]): CurrentMark | undefined {
    if (entry.mode === 'add') {
        return undefined;
    }

    return { variant: entry.current, listed: rows.some((row) => row.variant.id === entry.current.id) };
}

/**
 * Derive the dialog's state (the statechart's read-driven and search edges). Pure.
 *
 * @param input - The read, the entry mode, the search text and the locale.
 * @returns The state to render.
 */
export function deriveDetailsDialogState(input: DetailsDialogInput): DetailsDialogState {
    const { read, entry, query, locale } = input;

    switch (read.kind) {
        case 'loading':
            return { name: 'loading' };
        case 'parked':
            return { name: 'offline' };
        case 'failed':
            return { name: 'error' };
        case 'loaded':
            break;
    }

    const { plan } = read;
    const rows = rowsOfPlan(plan);

    if (rows.length === 0) {
        // In `edit`, an empty list means the current variant is retired and has no live sibling.
        return entry.mode === 'edit' ? { name: 'detailsNoneLeft', current: entry.current } : { name: 'noVariants' };
    }

    const current = currentMarkOf(entry, rows);

    if (plan.kind === 'short') {
        return { name: 'combined', rows: plan.rows, current };
    }

    const filtered = filterVariantList(plan, query, locale);

    if (filtered === plan) {
        return { name: 'longList', plan, total: rows.length, current };
    }

    const shown = rowsOfPlan(filtered).length;

    if (shown === 0) {
        return { name: 'noMatches', query: query.trim(), total: rows.length, current };
    }

    return { name: 'searching', plan: filtered, shown, total: rows.length, current };
}

/**
 * The outcome of choosing a row: `picked`, then `dismissed` for the current row (nothing to write), or `committed`.
 * Pure.
 *
 * @param entry - How the dialog was opened.
 * @param row - The chosen row.
 * @returns The outcome.
 */
export function pickOutcome(entry: DetailsDialogEntry, row: VariantRow): DetailsDialogOutcome {
    if (entry.mode === 'edit' && entry.current.id === row.variant.id) {
        return { kind: 'dismissed' };
    }

    return { kind: 'committed', mode: entry.mode, variant: { id: row.variant.id, parts: row.variant.parts } };
}

/** The states in which `Remove details` is offered, when the dialog was opened to edit. */
const REMOVABLE: ReadonlySet<DetailsDialogStateName> = new Set([
    'combined',
    'longList',
    'searching',
    'noMatches',
    'detailsNoneLeft',
]);

/**
 * The outcome of `Remove details`, or `undefined` where the statechart has no `removed` edge: opened to add, or a
 * state with no list. Pure. The leaves render the control only when this is defined.
 *
 * @param entry - How the dialog was opened.
 * @param state - The current state.
 * @returns `removed`, or `undefined`.
 */
export function removeOutcome(entry: DetailsDialogEntry, state: DetailsDialogState): DetailsDialogOutcome | undefined {
    return entry.mode === 'edit' && REMOVABLE.has(state.name) ? { kind: 'removed' } : undefined;
}

/**
 * The outcome of Close, Escape, the overlay, a swipe or Android back, from any state: nothing is written. Pure.
 *
 * @returns `dismissed`.
 */
export function closeOutcome(): DetailsDialogOutcome {
    return { kind: 'dismissed' };
}
