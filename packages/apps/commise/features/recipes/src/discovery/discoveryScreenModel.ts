/**
 * @module @commise/features-recipes/discovery/discoveryScreenModel — the vocabulary of the shared discovery screen: the
 * two PORTS a host implements (where the criteria live, and the platform pieces that differ) and the shapes the screen's
 * parts pass each other.
 *
 * Web and mobile ran the same ~450-line controller in two files. The only things that were genuinely different are the
 * ones below, so they are the whole of what a host supplies:
 *
 * - {@link DiscoveryCriteriaStore} — web keeps the criteria in the URL (shareable, survives reload), mobile in component
 *   state. Everything else about a search is derived from them by the shared pure model.
 * - {@link DiscoveryPlatform} — the read boundary and the calorie lookup (both wait for hydration on web) and where the
 *   recent searches are persisted (`localStorage` / `AsyncStorage`).
 *
 * Pull-to-refresh and the scroll bind are NOT part of the port: the shared screen always hands them to the leaves, and the
 * web leaves ignore them (their contract says so), so no host has to opt out of a gesture it does not have.
 *
 * @pattern Ports and Adapters — the criteria store and the platform are the screen's two driven ports
 */
import type { QueryKey } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { RecipeFilterState } from '../filters/model.js';
import type { SaveCopy } from '../hooks/useSaveCopy.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';
import type { RefreshNoticeControl } from '../refresh/model.js';
import type { RecentSearchStore } from './recentSearches.js';

/** What a search is asked: the filters and the typed term. Sort and browse state are view state, not criteria. */
export interface DiscoveryCriteriaState {
    readonly filters: RecipeFilterState;
    readonly query: string;
}

/**
 * Where the shareable criteria live. The screen READS `filters` on every render (so a change that arrives from outside —
 * a URL navigation — is followed) and WRITES through `commit`. The `query` PROP is read ONCE, to seed the typed-term
 * echo the field runs on; afterwards the store's query reaches the screen only as the `current` an update is handed.
 *
 * `commit` must not throw and must make the next render's `filters` / `query` equal what was committed (web by writing the
 * URL, mobile by setting state). It takes the next criteria or an UPDATE of the criteria current when it runs, applied in
 * order: the screen commits updates, so two actions in one event, or a keystroke between a render and a press, compose
 * instead of the later one overwriting the earlier with a stale snapshot. The screen keeps its own immediate copy of the
 * typed term for the field, so a store that applies a write late never makes a keystroke wait.
 */
export interface DiscoveryCriteriaStore extends DiscoveryCriteriaState {
    readonly commit: (
        next: DiscoveryCriteriaState | ((current: DiscoveryCriteriaState) => DiscoveryCriteriaState),
    ) => void;
}

/**
 * What a read boundary takes: the structural subset of the app's query boundary this screen uses, and the keys a
 * server-prefetched route holds. Stated here, not imported, because this package does not depend on `@commise/query`.
 */
export interface DiscoveryBoundaryProps {
    /** What renders while the read is pending. */
    readonly loading: ReactNode;
    /** What renders when the read fails; `resetErrorBoundary` retries it. */
    readonly renderError: (fallback: { readonly resetErrorBoundary: () => void }) => ReactNode;
    /** Values whose change clears a shown failure. */
    readonly resetKeys?: readonly unknown[];
    /** The subtree that reads. */
    readonly children: ReactNode;
    /** The keys the server already holds data for; web's boundary opens before hydration only if all of them do. */
    readonly prefetchedKeys?: readonly QueryKey[];
}

/** One read boundary: a suspense read with a loading body and an error body. */
export type DiscoveryBoundary = (props: DiscoveryBoundaryProps) => ReactNode;

/** The part of a query result a failed-refresh notice reads; any TanStack query result satisfies it. */
export interface DiscoveryRefreshableQuery {
    /** Whether the last refetch failed while data was loaded. */
    readonly isRefetchError: boolean;
    /** Whether a refetch of loaded data is in flight. */
    readonly isRefetching: boolean;
    /** Refetch, resolving with the settled result. */
    readonly refetch: () => Promise<{ readonly isSuccess: boolean }>;
}

/** A recovery count held where a surface's focus target is, fed by a notice's `onRecovered`. */
export interface DiscoveryRecoverySignal {
    /** How many recoveries have been reported; a change is the signal to move focus. */
    readonly signal: number;
    /** Report one recovery. Its identity never changes. */
    readonly onRecovered: () => void;
}

/**
 * The parts of the screen that differ by platform.
 *
 * Keep the object STABLE (a module constant): `useRenderNutrition`, `useRefreshNotice` and `useRecoverySignal` are called as hooks from inside the screen's parts, so
 * swapping it between renders would change their hook order.
 */
export interface DiscoveryPlatform {
    /** The read boundary around each suspense read. */
    readonly Boundary: DiscoveryBoundary;
    /**
     * The deferred calorie lookup, one batch per page of ids. A hook, because the lookup is a render-as-you-fetch read;
     * web's starts none until hydrated.
     */
    readonly useRenderNutrition: (recipeIdPages: readonly (readonly string[])[]) => RenderRecipeNutrition;
    /**
     * The failed-refresh notice's state for a read on screen. A hook, because it holds the count of retries that
     * recovered. `onRecovered` reports each recovery to a surface whose focus target sits across a suspense boundary.
     */
    readonly useRefreshNotice: (
        query: DiscoveryRefreshableQuery,
        options?: { readonly onRecovered?: () => void },
    ) => RefreshNoticeControl;
    /** The recovery count the frame holds on the near side of the read boundary. A hook, for the same reason. */
    readonly useRecoverySignal: () => DiscoveryRecoverySignal;
    /** Where the recent searches persist. A module-level singleton: its identity is an effect dependency. */
    readonly recentSearchStore: RecentSearchStore;
    /**
     * Whose recent searches these are: the signed-in user's id, `null` when signed out, `undefined` while that is not yet
     * known (Clerk's `useAuth().userId`, which is what the sign-out command removes by). A hook, because it reads the
     * session. Owner ruling 2026-10-17, `docs/design/uiOverhaul/ownerDecisions.md`.
     */
    readonly useRecentSearchSubject: () => string | null | undefined;
}

/** What every card on the surface shares: its Save a copy control, where it leads, and how it is opened. */
export interface DiscoveryCardActions {
    readonly saveCopy: SaveCopy;
    readonly onSelectRecipe: (id: string) => void;
    /** Where a card links, for a platform whose cards are links. Absent: the card is a button. */
    readonly hrefOf?: (recipeId: string) => string;
}
