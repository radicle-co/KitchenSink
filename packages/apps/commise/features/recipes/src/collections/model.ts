/**
 * @module @commise/features-recipes — collections model layer.
 *
 * Pure, platform-agnostic types + props shared by the web (`*.tsx`) and native (`*.native.tsx`) collection
 * building blocks, so the two renders can never drift on shape. No React, no platform APIs. These are
 * controlled, presentational components: they fetch nothing and delegate every interaction upward.
 */
import type { HeaderAction } from '@commise/ui/large-title-header';
import type { ScrollBind } from '@commise/ui/scroll-host';
import type { Locale } from '@commise/i18n';
import type { ReactNode } from 'react';
import type { PullDiff } from '@kitchensink/recipe-service-client';
// Imported (not merely re-exported) because the props below reference both by name, and an `export … from`
// re-export does not bring a name into this module's scope.
import type { CollectionResponse, CollectionWithRecipesResponse } from '@kitchensink/schema-recipe';

import type { RecipeListRefreshControl, RecipesSegmentControl } from '../list/model.js';
import type { RefreshNoticeControl } from '../refresh/model.js';

/**
 * A member recipe's provenance within a specific collection (W5 Task 9, C3 / FR-011) — the PUBLISHED wire
 * shape (`recipeSchema.extend({ addedVia })`), re-exported under the contract's own name rather than declared
 * here (§15 Rule 1 / ADR-0014). `manual` = added directly by the collection owner, protected from Pull Updates
 * (the wireframe's `[x]` state); `clone_seed`/`pull` = seeded from or synced from the source collection, and
 * will be refreshed by a future Pull Updates (the `[ ]` state).
 *
 * The declaration this replaced (`Recipe & { addedVia }`, in `@kitchensink/recipe-core` domain types) argued
 * it kept this presentational feature off the HTTP client. That argument did not hold in either direction:
 * this package already depends on `@kitchensink/schema-recipe`, which is the CONTRACT and not the client (no
 * transport, no fetch — the same import `filters/model.ts` uses for `RecipeSearchFacets`), and it already
 * imports {@link PullDiff} from the client proper a few lines above. So the twin bought no decoupling and cost
 * the one thing that matters: nothing checked it against the shape the server actually sends.
 */
export type { CollectionMemberRecipe } from '@kitchensink/schema-recipe';

/**
 * A collection plus its member recipes — the shape the detail view (T072) consumes. ALIAS of the published
 * `CollectionWithRecipesResponse` (`GET /api/v1/collections/{id}`), never a second declaration of it; the
 * local name is kept because this package's public surface and both platforms' containers use it.
 *
 * ⚠️ The declaration this replaced had already DRIFTED from the contract in two ways, both resolved toward the
 * server:
 *  - it typed `recipes` as OPTIONAL where the contract has it REQUIRED. `CollectionsService.getCollection`
 *    sets it unconditionally, so "absent" was never a state the server could produce — an empty array already
 *    says "nothing you can see", and an absent key would have meant something the server cannot say. Declaring
 *    it optional invited a view to render "recipes not loaded" for an impossible case and forced a `?? []` on
 *    every read.
 *  - it omitted the three response-only provenance projections the wire body carries — `sourceOwnerHandle` /
 *    `sourceCollectionName` (the source's attribution, frozen at clone time) and `lastPulledAt` — so a
 *    container holding a real response had to widen or re-project to reach them.
 *
 * Aliasing is what keeps both of those honest from now on: a field added, removed or renamed in the contract
 * fails this package's typecheck instead of silently leaving a stale hand-written copy behind.
 */
export type CollectionWithRecipes = CollectionWithRecipesResponse;

/**
 * Props for the collection list's FRAME — the chrome (heading + create) that renders OUTSIDE the list's suspense
 * boundary, so a pending or failed read never unmounts it. The boundary renders inside, as `children`.
 */
export interface CollectionListFrameProps {
    /** Invoked when the create-collection action is activated (it opens the new-collection sheet). */
    readonly onCreate: () => void;
    /** The My recipes · Collections segments. Absent → none (a host whose shell switches the places itself). */
    readonly segments?: RecipesSegmentControl;
    /**
     * A counter whose change moves focus to the heading: the owner advances it when a retry from the refresh notice
     * succeeds, because that retry removed the button the viewer pressed. It starts wherever the owner starts it; the
     * frame never moves focus on mount.
     */
    readonly headingFocusSignal: number;
    /** The large title's action (slice 3): the avatar, which opens Profile. The app supplies it. */
    readonly headerAction?: HeaderAction;
    /** The cook has no collections yet: the first run's own start buttons take the floating button's place (§3.4). */
    readonly firstRun?: boolean;
    /** The read boundary: its loading or error fallback, or the settled results. */
    readonly children: ReactNode;
}

/**
 * Props for the collection list's RESULTS — what renders inside the suspense boundary once the read has settled: the
 * refresh notice, then the empty state or the rows, then the load-more control. It performs NO data fetching.
 */
export interface CollectionListResultsProps {
    /** The visible collections — the loaded ones after the search. The wire body, for the copy's attribution. */
    readonly collections: readonly CollectionResponse[];
    /** How many collections are loaded: the count the result bar says, and whether the search shows (from six). */
    readonly total: number;
    /** Invoked with a collection id when a card is activated. */
    readonly onSelect: (id: string) => void;
    /** Where a collection lives, which makes each card a real link on web. Native ignores it. */
    readonly hrefOf?: (id: string) => string;
    /** The search over the loaded collections. */
    readonly search: { readonly value: string; readonly onChange: (value: string) => void };
    /** The first run's action, which depends on whether the cook has recipes to group yet (§5.1 States). */
    readonly firstRun: {
        readonly hasRecipes: boolean;
        /** Open the new-collection sheet. */
        readonly onCreate: () => void;
        /** Open the editor: a collection needs recipes first. */
        readonly onAddRecipe: () => void;
    };
    /**
     * Optional server-paged load-more control (W5/C7) — grouped into ONE optional prop rather than three flat
     * `hasMore`/`isFetchingNextPage`/`onLoadMore` fields, so the whole feature expresses "load more" as a single thing
     * (the established `RecipeDiscoveryLoadMoreControl` shape). Absent → no pagination control.
     */
    readonly loadMore?: CollectionListLoadMore;
    /** Optional notice for a failed refresh of the collections on screen — both platforms. Absent ⇒ no notice. */
    readonly refreshNotice?: RefreshNoticeControl;
    /**
     * Optional pull-to-refresh (U4/L8) — mobile only; the web leaf ignores it (no web pull gesture). Reuses the
     * `RecipeListRefreshControl` shape (one pull-to-refresh contract across every list).
     */
    readonly refresh?: RecipeListRefreshControl;
    /**
     * The screen's scroll host's bind for this, its one vertical scroller (blueprint A7) — native only: the host reads
     * the scroll (the floating create button, the tab's second tap). Web's document scrolls, so the web leaf ignores it.
     */
    readonly scrollBind?: ScrollBind;
}

/** Props for the collection list's LOAD-ERROR fallback — the read failed with nothing loaded. */
export interface CollectionListLoadErrorProps {
    /** Retry the read (the error boundary's reset, which refetches). */
    readonly onRetry: () => void;
}

/**
 * The server-paged load-more control for the collection list (W5/C7) — structurally the same shape as
 * `RecipeDiscoveryLoadMoreControl` (one shared shape for the same
 * concern across discovery + collections): whether another page exists, whether the next page is in flight,
 * and the fetch-next callback. The view renders a `[Load more]` button only while {@link hasMore}; it
 * vanishes at the last page (no infinite scroll).
 */
export interface CollectionListLoadMore {
    /** Whether another server page exists; the `[Load more]` control renders only while `true`. */
    readonly hasMore: boolean;
    /** Whether the next page is currently being fetched; the control shows a busy/disabled state. */
    readonly loading: boolean;
    /**
     * Whether the last attempt to fetch the next page failed. The loaded collections stay on screen and the control
     * offers a retry beside the reason — a failed next page is never the list's error state.
     */
    readonly failed: boolean;
    /** Invoked when the load-more control is activated (wired to `useCollectionsInfinite`'s `fetchNextPage`). */
    readonly onLoadMore: () => void;
}

/** Props for the picker's load-error body. */
export interface CollectionRecipePickerLoadErrorProps {
    /** Invoked when the retry action is activated. */
    readonly onRetry: () => void;
}

/**
 * Props for the Pull-Updates preview dialog (W5 Task 10, C2 / FR-011) — a controlled, presentational render
 * of the collection-view wireframe's "Pull Updates Preview Dialog": the source `@owner / name` attribution,
 * the three-way {@link PullDiff} counts (added/removed/unchanged — id-count only, this block never resolves
 * recipe titles), the "recipes you added directly will not be overwritten" note, and the count-templated
 * Pull action. It fetches nothing and performs no mutation — the composing container (W5 Task 12) owns the
 * preview query and the commit mutation, re-running the preview when `error` is `'drift'` (a 409: the
 * source changed since the preview was taken, so the previewed `diff` is stale).
 *
 * State precedence mirrors the sibling dialogs in this feature: a progress affordance while
 * `isLoadingPreview` (or before any `diff` has arrived); an alert for a failed preview (`'drift'` — NOT a
 * dead end, Cancel/Escape still close the dialog so the caller can re-run the preview — or `'generic'`);
 * otherwise the loaded `diff`, with the Pull action disabled while `isCommitting` or when there is nothing
 * to add (`diff.added.length === 0`).
 */
export interface PullUpdatesDialogProps {
    readonly open: boolean;
    /** The previewed three-way diff; absent before the first successful preview resolves. */
    readonly diff?: PullDiff;
    /** Whether the preview request is in flight. */
    readonly isLoadingPreview: boolean;
    /** Whether the commit (pull) mutation is in flight; disables and marks the Pull action busy. */
    readonly isCommitting: boolean;
    /** The last failed preview/commit, if any: `'drift'` is the 409 stale-diff path, `'generic'` any other
     *  failure. Absent when the last attempt (if any) succeeded. */
    readonly error?: 'drift' | 'generic';
    /** The source collection owner's display handle, frozen at clone time; may be absent (unresolved owner). */
    readonly sourceOwnerHandle?: string;
    /** The source collection's name, frozen at clone time. */
    readonly sourceCollectionName?: string;
    /** Invoked when Cancel is activated, or the dialog is dismissed via Escape/backdrop (one exit path). */
    readonly onCancel: () => void;
    /** Invoked when the Pull action is activated; commits the pull. Suppressed while nothing can be pulled
     *  or a commit is already in flight — see {@link PullUpdatesDialogProps.isCommitting}. */
    readonly onConfirm: () => void;
}

/**
 * Format an ISO 8601 timestamp as a date-only string for the collection header's "Last pulled" line, in
 * the active locale. Distinct from `formatVersionTimestamp`: the
 * wireframe shows a DATE only (no time) for this field. Formatted in UTC so the output is deterministic
 * regardless of the runtime's timezone (`lastPulledAt` is an absolute instant, not a local wall-clock
 * time). Pure.
 *
 * @param isoDate - The ISO 8601 timestamp.
 * @param locale - The active BCP-47 locale.
 * @returns The localized date string.
 */
export const formatCollectionDate = (isoDate: string, locale: Locale): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(isoDate));

/** The number of collections from which the list offers its search (§5.1). */
export const COLLECTION_SEARCH_FROM = 6;

/**
 * The collections whose name holds the search term, in the loaded order. Pure.
 *
 * @param collections - The loaded collections.
 * @param searchValue - The raw search term.
 * @returns The visible collections.
 */
export function narrowCollections<T extends { readonly name: string }>(
    collections: readonly T[],
    searchValue: string,
): readonly T[] {
    const term = searchValue.trim().toLowerCase();

    return term.length === 0
        ? collections
        : collections.filter((collection) => collection.name.toLowerCase().includes(term));
}
