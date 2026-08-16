/**
 * @module @commise/features-recipes — collections model layer.
 *
 * Pure, platform-agnostic types + props shared by the web (`*.tsx`) and native (`*.native.tsx`) collection
 * building blocks, so the two renders can never drift on shape. No React, no platform APIs. These are
 * controlled, presentational components: they fetch nothing and delegate every interaction upward.
 */
import type { Locale } from '@commise/i18n';
import type { ReactNode } from 'react';
import type { Collection, Recipe, RecipeVisibility } from '@kitchensink/recipe-core';
import type { PullDiff } from '@kitchensink/recipe-service-client';
// Imported (not merely re-exported) because the props below reference both by name, and an `export … from`
// re-export does not bring a name into this module's scope.
import type { CollectionMemberRecipe, CollectionWithRecipesResponse } from '@kitchensink/schema-recipe';

import type { RecipeListRefreshControl } from '../list/model.js';
import type { RenderRecipeNutrition } from '../nutrition/model.js';

/**
 * The minimal recipe shape the collection picker needs to list and add a candidate. The picker renders a
 * lightweight one-line-per-recipe chooser (title + an add control) — deliberately NOT the full mockup
 * `RecipeCardModel`. Typing candidates as this `Pick` keeps the picker decoupled from the card's growing
 * field set (difficulty, ratings, cover photo, PRO), so a caller need only supply what the picker reads. A
 * caller holding a fuller model (e.g. a `RecipeListItem` from `toRecipeListItem`) is still assignable.
 */
export type RecipePickerCandidate = Pick<Recipe, 'id' | 'title'>;

/**
 * The three top-level states the collection list renders. `ready` further splits into empty vs populated on
 * `collections.length` (a distinction the view derives — an empty successful load is not an error).
 */
export type CollectionListStatus = 'loading' | 'error' | 'ready';

/**
 * The three top-level fetch states the recipe picker renders while loading the caller's candidate recipes.
 * `ready` further splits (a distinction the view derives): no recipes owned at all vs a search that matched
 * none vs a populated candidate list.
 */
export type RecipePickerStatus = 'loading' | 'error' | 'ready';

/** The two modes the collection form operates in: creating a new collection, or renaming an existing one. */
export type CollectionFormMode = 'create' | 'rename';

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
 * Props for the collection-list view — a controlled, presentational component. It renders one of four states
 * (loading, error, empty, populated) from `status` + `collections`, and delegates every interaction upward.
 * It performs NO data fetching: the composing app wires the query layer to these props.
 */
export interface CollectionListViewProps {
    readonly status: CollectionListStatus;
    readonly collections: readonly Collection[];
    /** Invoked with a collection id when a row is activated. */
    readonly onSelect: (id: string) => void;
    /** Invoked when the create-collection action is activated. */
    readonly onCreate: () => void;
    /** Invoked when the retry action is activated in the error state. */
    readonly onRetry: () => void;
    /**
     * Optional server-paged load-more control (W5/C7) — grouped into ONE optional prop rather than three flat
     * `hasMore`/`isFetchingNextPage`/`onLoadMore` fields, so the whole feature expresses "load more" as a
     * single thing (the established `RecipeDiscoveryLoadMoreControl`
     * shape). Absent → no pagination control (a caller wired to the flat `useCollections` rather than
     * `useCollectionsInfinite`); the composing container (Task 12) wires it off `useCollectionsInfinite`.
     */
    readonly loadMore?: CollectionListLoadMore;
    /**
     * Optional pull-to-refresh (U4/L8) — mobile only; the web leaf ignores it (no web pull gesture). Reuses
     * the `RecipeListRefreshControl` shape (one pull-to-refresh contract
     * across every list). The composing container wires it to the query's `isRefetching` + `refetch`.
     */
    readonly refresh?: RecipeListRefreshControl;
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
    /** Invoked when the load-more control is activated (wired to `useCollectionsInfinite`'s `fetchNextPage`). */
    readonly onLoadMore: () => void;
}

/**
 * The member-list reveal window (W5/C7): the detail embed (`CollectionWithRecipes.recipes`) returns EVERY
 * member in one round trip — there is no member-pagination endpoint, and adding one is out of scope (see
 * the W5 plan's Task 11) — so the view itself windows the list client-side, revealing this many rows at a
 * time behind a `[Load more (K more)]` control. Pinned to `4` to match the collection-view wireframe
 * (`specs/001-commise-recipe-app/product-spec/wireframes/collection-view.md`): 4 rows rendered, "Load more
 * (4 more)" for an 8-recipe collection.
 */
export const MEMBER_WINDOW_SIZE = 4;

/**
 * Which honest error a failed collection mutation surfaces (localized copy lives in the block, keyed by this
 * discriminant — the B17 code pattern, so the composing container never reaches into the block's dictionary).
 * - `delete` — deleting the collection failed (the action looked frozen before B17).
 * - `remove` — removing a member recipe failed.
 */
export type CollectionDetailError = 'delete' | 'remove';

/**
 * Props for the collection-detail view — a presentational render of a loaded {@link CollectionWithRecipes}'s
 * MEMBER LIST (heading, add-a-recipe control, member recipe rows, and the client-side reveal windowing).
 *
 * The collection's HEADER zone — name, description, visibility badge, recipe count, source attribution,
 * last-pulled date, and the rename/delete/back affordances — is owned by the sibling
 * {@link CollectionHeaderViewProps} block (W5 Task 6), composed ABOVE this one by the container (W5 Task 12).
 * This block therefore holds NO name/rename/delete of its own — that markup used to live here and was removed
 * so there is exactly ONE header, not two. Fetch states (loading/error) belong to the composing app, not here.
 */
export interface CollectionDetailViewProps {
    readonly collection: CollectionWithRecipes;
    /** Invoked with a recipe id when a member row is activated. */
    readonly onSelectRecipe: (id: string) => void;
    /** Invoked with a recipe id when a member's remove control is activated. */
    readonly onRemoveRecipe: (recipeId: string) => void;
    /** Invoked when the add-a-recipe action is activated (opens the {@link CollectionRecipePickerProps} view). */
    readonly onAddRecipe: () => void;
    /** An honest error from the last delete/remove attempt to surface, or ABSENT for none (B17). */
    readonly error?: CollectionDetailError;
    /**
     * How to render one card's deferred calorie figure — called once per visible card with its recipe id
     * (see {@link RenderRecipeNutrition}). The host closes over the page's ONE batch promise, so N cards are
     * ONE read. Absent ⇒ no card shows a nutrition line, which is the card's absent-value rule, not a gap.
     */
    readonly renderNutrition?: RenderRecipeNutrition;
}

/**
 * Props for a single collection member row (W5 Task 9, C3) — composes the shared `RecipeCardModel`
 * (via `RecipeCard`/`toRecipeCardModel`: title, calories, the version badge past v1, the visibility/draft
 * badge) with the two row-specific things the card does NOT already render: a read-only source-indicator
 * (owner-added/protected vs from-source/will-sync, derived from `member.addedVia`) and the `by @handle`
 * author attribution. A presentational, controlled component — it fetches nothing and performs no mutation.
 * Selecting the row and removing the member are SIBLING affordances, never nested, so activating Remove can
 * never also fire `onSelect` (the double-fire guard).
 */
export interface CollectionMemberRowProps {
    readonly member: CollectionMemberRecipe;
    /** Invoked with the member's recipe id when the row's select target is activated. */
    readonly onSelect: (recipeId: string) => void;
    /** Invoked with the member's recipe id when the row's remove control is activated. */
    readonly onRemove: (recipeId: string) => void;
    /**
     * This recipe's per-serving nutrition, as an already-decided NODE for the card's meta row (the host
     * closes over the page's ONE batch promise — see `RenderRecipeNutrition`). Absent ⇒ no nutrition line.
     */
    readonly nutrition?: ReactNode;
}

/**
 * Props for the collection recipe-picker — the ADD half of FR-009 (T072), a controlled, presentational
 * component that lists the caller's OWN recipes and adds them, one at a time, to a single named collection.
 * It fetches nothing: the composing app wires the recipe query, the current membership, and the add mutation
 * to these props, filters the candidate list by `query`, and drives the per-row in-flight/success/failure
 * signals below. Multi-membership (FR-009 — a recipe MAY belong to many collections) is expressed per row:
 * membership is scoped to THIS collection, so a recipe already in another collection is still addable here,
 * and a recipe already in THIS collection shows an inert "in this collection" marker rather than a re-add.
 */
export interface CollectionRecipePickerProps {
    /** The name of the collection recipes are added to — surfaced in the heading. */
    readonly collectionName: string;
    /** The candidate-load fetch state. `ready` renders the (already `query`-filtered) `recipes`. */
    readonly status: RecipePickerStatus;
    /** The caller's candidate recipes, already filtered by `query` upstream. */
    readonly recipes: readonly RecipePickerCandidate[];
    /** Ids of the recipes already in THIS collection — their rows show an inert membership marker. */
    readonly memberRecipeIds: readonly string[];
    /** The controlled search value — reflected in the input and used to disambiguate the two empty states. */
    readonly query: string;
    /** The recipe whose add is in flight, if any — its row shows a busy, non-interactive control. */
    readonly pendingRecipeId?: string;
    /** The last recipe successfully added — drives the polite success announcement. */
    readonly lastAddedRecipeId?: string;
    /** Whether the most recent add failed — surfaces an alert without hiding the rows. Defaults to `false`. */
    readonly addFailed?: boolean;
    /** Invoked with the new search value as the caller types. */
    readonly onQueryChange: (query: string) => void;
    /** Invoked with a recipe id when its add control is activated (suppressed for member/in-flight rows). */
    readonly onAdd: (recipeId: string) => void;
    /** Invoked when the retry action is activated in the load-error state. */
    readonly onRetry: () => void;
    /** Invoked when the create-recipe action is activated in the no-recipes empty state. */
    readonly onCreateRecipe: () => void;
    /** Invoked when the done action is activated (dismisses the picker). */
    readonly onDone: () => void;
}

/**
 * Props for the collection form (create/rename) — a controlled, presentational component. The `name` value
 * is owned by the caller; the form reports edits via `onChange` and delegates submit/cancel upward. While
 * `submitting`, the input and both actions are disabled to prevent duplicate submissions.
 */
export interface CollectionFormProps {
    readonly mode: CollectionFormMode;
    readonly name: string;
    /** Whether a submission is in flight; disables the input and actions. Defaults to `false`. */
    readonly submitting?: boolean;
    /** A validation/submission error to surface, if any. */
    readonly error?: string;
    readonly onChange: (name: string) => void;
    readonly onSubmit: () => void;
    readonly onCancel: () => void;
}

/**
 * Props for the collection-header view (W5 Task 6) — a presentational render of the collection-view
 * wireframe's header zone: the collection name with its Edit/Delete affordances (C4), a visibility badge,
 * the recipe count, source attribution for a cloned collection, its last-pulled date, and a Back affordance
 * (C6). Takes individual scalar fields rather than a `Collection`/`CollectionWithRecipes` object so this
 * block stays decoupled from the recipe-service client's response-only provenance widening (`./types.js`'s
 * `Collection`) — the composing screen projects whatever collection shape it holds down to these fields.
 * It fetches nothing and delegates every interaction upward.
 */
export interface CollectionHeaderViewProps {
    readonly name: string;
    readonly description?: string;
    readonly visibility: RecipeVisibility;
    readonly recipeCount: number;
    /** The source collection's name, present only when this collection was cloned (FR-011). */
    readonly sourceCollectionName?: string;
    /** The source owner's display handle; may be absent even for a cloned collection (unresolved owner). */
    readonly sourceOwnerHandle?: string;
    /** ISO 8601 timestamp of the last successful pull from source (FR-011); absent if never pulled. */
    readonly lastPulledAt?: string;
    /** Invoked when the back affordance is activated; omit to render no Back control (C6). */
    readonly onBack?: () => void;
    /** Invoked when the edit/rename action is activated (C4). */
    readonly onEdit: () => void;
    /** Invoked when the delete action is activated (C4). */
    readonly onDelete: () => void;
}

/**
 * Props for the collection-actions sidebar (W5 Task 7) — a presentational render of the collection-view
 * wireframe's "COLLECTION ACTIONS" panel: Add Recipes, Pull Updates from Source (clones only, FR-011),
 * Clone Collection, and a premium-gated Public/Private visibility toggle with a Save action (C1, FR-010).
 *
 * The premium gate is carried as the plain boolean `canGoPrivate` (+ an already-localized `disabledReason`),
 * NOT a `Viewer` — the composing container computes `canGoPrivate(viewer)` from `@kitchensink/recipe-core`'s
 * policy module and passes the result down, so this component stays pure `props → JSX` with no tier/policy
 * logic of its own (mirrors `RecipeVisibilityToggleProps`, the sibling
 * recipe-visibility gate this block was modeled on).
 *
 * The toggle is two-stage, unlike the recipe toggle it mirrors: `pendingVisibility` is the control's current
 * selection and may differ from the saved `visibility` until the caller commits it via `onSaveVisibility`
 * (wired to the Save action, enabled only while the two differ). It fetches nothing and performs no
 * mutations — the composing container (W5 Task 12) owns every mutation this panel triggers.
 */
export interface CollectionActionsProps {
    /** Whether this collection was cloned from another — gates the Pull Updates action (FR-011). */
    readonly isCloned: boolean;
    /** The collection's current saved visibility. */
    readonly visibility: RecipeVisibility;
    /** The visibility toggle's current selection; may differ from `visibility` until saved. */
    readonly pendingVisibility: RecipeVisibility;
    /** Whether the viewer's tier permits a private collection (C1), computed by the composing container via
     *  `canGoPrivate(viewer)`. This component reads only the boolean result. */
    readonly canGoPrivate: boolean;
    /** Localized explanation shown when the private option is gated off (rendered only when `!canGoPrivate`). */
    readonly disabledReason?: string;
    /** Whether the clone mutation is in flight — disables and marks Clone Collection busy. */
    readonly isCloning: boolean;
    /** Whether the pull-updates mutation is in flight — disables and marks Pull Updates busy. */
    readonly isPulling: boolean;
    /** Invoked when the add-recipes action is activated. */
    readonly onAddRecipes: () => void;
    /** Invoked when Pull Updates is activated; opens the preview flow (dialog lands in W5 Task 10/12). */
    readonly onPullUpdates: () => void;
    /** Invoked when Clone Collection is activated. */
    readonly onClone: () => void;
    /** Invoked with the requested next visibility when the user selects an enabled toggle option. */
    readonly onVisibilityChange: (next: RecipeVisibility) => void;
    /** Invoked to commit `pendingVisibility`; enabled only while it differs from `visibility`. */
    readonly onSaveVisibility: () => void;
}

/**
 * Props for the clone-info panel (W5 Task 8, C5) — a presentational render of the collection-view
 * wireframe's "CLONE INFO" panel: the source collection's `@owner / "name"` attribution, the date this
 * collection was cloned, and a View Source control. Rendered by the composing container (W5 Task 12) ONLY
 * when the collection is a clone, so `sourceCollectionId` is always present here — this component assumes
 * clone props and holds no "not a clone" branch of its own.
 *
 * `sourceOwnerHandle`/`sourceCollectionName` are frozen at clone time (W5 Task 2) and may independently be
 * absent — an unresolved owner, or a source deleted after cloning — so the attribution degrades gracefully
 * (name-only, then a generic fallback) rather than leaking `undefined` into the DOM. `locale` arrives as an
 * explicit prop (unlike the sibling {@link CollectionHeaderViewProps}, which reads it via `useLocale()`) so
 * this leaf stays pure `props → JSX` with no hook of its own. It fetches nothing and performs no mutations;
 * the View Source interaction is delegated upward.
 */
export interface CloneInfoPanelProps {
    /** The source owner's display handle, frozen at clone time; absent for an unresolved owner. */
    readonly sourceOwnerHandle?: string;
    /** The source collection's name, frozen at clone time; absent if the source is no longer resolvable. */
    readonly sourceCollectionName?: string;
    /** The source collection's id, for the View Source navigation — always present for a clone. */
    readonly sourceCollectionId: string;
    /** ISO 8601 timestamp of this collection's clone creation (the clone's `createdAt`). */
    readonly clonedAt: string;
    /** The active BCP-47 locale, used to format {@link clonedAt} via {@link formatCollectionDate}. */
    readonly locale: Locale;
    /** Invoked with `sourceCollectionId` when the View Source control is activated. */
    readonly onViewSource: (sourceCollectionId: string) => void;
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
