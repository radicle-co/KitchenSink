'use client';

/**
 * The async ingredient typeahead the shared `RecipeForm` building block deliberately omits (it resolves no
 * ingredient itself). A thin renderer (CP-6/P2) over the shared, platform-agnostic
 * `useIngredientResolver` (`@commise/features-recipes/hooks`), which owns the search-box text, the
 * disambiguation state, and all four ways a line resolves (catalog-hit, addByName, candidate pick,
 * freeform). This leaf's job is ONLY to render `viewState` with its own Tailwind markup and wire the
 * hook's actions to DOM events — see the hook's module doc for the full state machine, the async-resolution
 * vertical (data-model R5 / FR-007), and the drift-unification decisions made when it was extracted from
 * this leaf and its mobile sibling.
 *
 * **Search Stage 2 — the blended, sectioned result list.** The results are now a discriminated
 * `local | catalog` union: the caller's own previously-used ingredients and food-catalog golden records (the
 * USDA-seeded catalog, previously invisible to this typeahead). They render as TWO labeled sections — "Your
 * ingredients" then "Food catalog" — never interleaved, per the command-palette pattern: the fast familiar
 * list keeps a stable position whether or not the catalog section is present, which removes the layout-shift
 * class of typeahead jank. Catalog rows carry a provenance badge and cost one admit round-trip on pick (which
 * is why they disable while `addByFoodStatus.isPending`). When the food catalog is unreachable, a quiet
 * `role="status"` notice says so and the local section still renders in full (F2) — nothing failed for the
 * user, so it is deliberately not an `alert`.
 *
 * **U14 — the correction affordance (R19/R20).** Each food-backed suggestion row carries a second control:
 * "Always use this for '{query}'". It writes a curated mapping through `useIngredientCorrection`, which is
 * what makes U10's knowledge base reachable at all — before it, that table had a writer and no caller, so the
 * learning loop never fired. Three things about it are deliberate and easy to break:
 *
 *  1. ⛔ **The phrase sent is the TYPED query, never the suggestion's name.** A mapping is only ever consulted
 *     under the key the resolution cascade looks up, and that key derives from the phrase `addByName`
 *     received. Sending the catalog's rendering of the food would write rows nothing queries — and would be a
 *     system checking its own output against itself.
 *  2. ⛔ **A FREEFORM row gets no control.** A mapping's whole content is a `food_id`, and a user-entered
 *     ingredient has no food behind it, so there would be nothing to bind the phrase to.
 *  3. ⚠️ **It is a SEPARATE intent from picking.** Teaching does not resolve a line, and a failed correction
 *     never disturbs one — the notice says so explicitly.
 *
 * **U29 — the ON-DEMAND USDA search.** Below the local results sits an explicit affordance, "Search USDA
 * for '{query}'", tagged SLOW. ⛔ It is a BUTTON a cook presses, never a typeahead: the upstream source
 * allows 1,000 requests/hour PER IP shared by every cook, of which 003's FR-019 reserves only the top 10%
 * for user-facing work — so at 50 concurrent cooks a per-settled-query autocomplete would want roughly
 * three times the entire key. Do not add a debounce, an effect, or a "the local results look thin" trigger.
 *
 * ⚠️ **The panel APPENDS below the local sections; it never replaces them.** The design mockup shows the
 * running/failed states taking the whole result area over, and this leaf deliberately does not: a cook who
 * waits several seconds and then gets a failure would have lost the local list they already had. The
 * revival plan's own rule is that the source section "never blocks local", and that wins.
 *
 * ⛔ **Three settled outcomes get three sentences.** "USDA has nothing for X" means stop looking (a
 * `status`, not an `alert`, and no retry offered — nothing failed). "Rate-limited" and "didn't answer" both
 * mean try again, and are `alert`s with a retry. Merging any pair sends a cook round a loop that cannot end.
 *
 * **Every progress region carries its label as CONTENT, not only as `aria-label`.** A `role="status"` node
 * rendered EMPTY is doubly broken: it is zero-height (nothing for a sighted viewer to see, and Playwright
 * resolves it as `hidden`) and it is silent — a live region announces content CHANGES, and a region with no
 * content has no change to announce. So each of the six affordances below (searching, find-nutrition,
 * freeform-create, catalog-admit, disambiguation-loading, resolving) renders its contextual, localized label
 * as its visible caption. Same doctrine as `RecipePhotoManager`'s upload status and the mobile `LoadingState`.
 */
import {
    fillTemplate,
    recipeCorrectionMessages,
    recipeFormMessages,
    recipeMessages,
    resolutionStatusLabel,
    toCorrectionNoticeModel,
} from '@commise/features-recipes';
import type { RecipeFormIngredient } from '@commise/features-recipes';
import {
    isTerminalStatus,
    suggestionKey,
    useIngredientCorrection,
    useIngredientResolver,
} from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { Ingredient } from '@kitchensink/recipe-core';
import type { IngredientSuggestion } from '@kitchensink/recipe-service-client';
import type { FC, JSX } from 'react';

import { webMessages } from '@/i18n/messages';
import { IngredientRowsSkeleton } from './IngredientRowsSkeleton';

/** Props for {@link IngredientPicker}. */
export interface IngredientPickerProps {
    /** Called with a fully-resolved recipe line (its `ingredientId` set) to append to the recipe. */
    readonly onSelect: (line: RecipeFormIngredient) => void;
}

/**
 * The live ingredient typeahead.
 *
 * @param props - The line-resolved callback.
 * @returns The search box plus its results / empty / error affordances, the disambiguation panel, and the
 *   freeform-create fallback.
 */
export const IngredientPicker: FC<IngredientPickerProps> = ({ onSelect }) => {
    const { recipes } = useMessages(webMessages);
    const picker = recipes.picker;
    const formMessages = useMessages(recipeFormMessages);
    // 003-FR-010a: the search-minimum copy is shared by all four ingredient-search surfaces, so it lives in
    // the feature package rather than in this app's dictionary — see `IngredientSearchMessages`.
    const { ingredientSearch: minimumCopy, ingredientLiveSearch: liveCopy } = useMessages(recipeMessages);
    const {
        query,
        setQuery,
        trimmed,
        viewState,
        addByNameStatus,
        addByFoodStatus,
        createStatus,
        resolveError,
        selectSuggestion,
        selectMatch,
        findNutrition,
        pickCandidate,
        addFreeform,
        cancelDisambiguation,
        liveSearch,
        selectLiveHit,
    } = useIngredientResolver(onSelect);
    const correctionMessages = useMessages(recipeCorrectionMessages);
    // `ingredient_picker` is a CLOSED wire enum, so this surface cannot invent an audit value (R20).
    const correction = useIngredientCorrection('ingredient_picker');
    const correctionNotice = toCorrectionNoticeModel(correction.viewState, correctionMessages);

    /**
     * The "teach the resolver" control for one suggestion row, or `null` when the row has no food behind it.
     *
     * ⛔ `trimmed` is the phrase sent — the text the cook actually typed. See the module doc, point 1.
     */
    const correctionControl = (foodId: string | undefined): JSX.Element | null => {
        if (foodId === undefined || trimmed === '') {
            return null;
        }

        return (
            <button
                type="button"
                onClick={() => correction.correct(trimmed, foodId)}
                disabled={correction.isSaving}
                aria-busy={correction.isSaving}
                className="shrink-0 rounded-full border border-border px-2 py-0.5 text-caption text-slate transition hover:bg-pearl disabled:opacity-60"
            >
                {fillTemplate(correctionMessages.teachAction, { phrase: trimmed })}
            </button>
        );
    };

    /** One row of the caller's OWN ingredients: the clickable match, its status badge, and a terminal notice. */
    const ownRow = (ingredient: Ingredient, terminal: boolean, onPick: () => void): JSX.Element => (
        <li key={ingredient.id} className="flex items-center gap-2">
            <button
                type="button"
                onClick={onPick}
                className="flex-1 rounded-lg px-3 py-2 text-left text-body-md text-charcoal transition hover:bg-pearl"
            >
                {ingredient.name}
            </button>
            {ingredient.foodResolutionStatus !== undefined && (
                <span className="text-caption text-slate">
                    {resolutionStatusLabel(formMessages, ingredient.foodResolutionStatus)}
                </span>
            )}
            {terminal && (
                <span role="note" className="text-caption text-warning">
                    {picker.terminalNotice}
                </span>
            )}
            {correctionControl(ingredient.foodId)}
        </li>
    );

    /**
     * One food-CATALOG row (search Stage 2). Badged so its provenance is unmistakable — it is a golden record
     * from the food catalog, not yet one of the caller's own ingredients — and disabled while an admit is in
     * flight, since picking it costs one round-trip before the line can resolve.
     */
    const catalogRow = (suggestion: Extract<IngredientSuggestion, { provenance: 'catalog' }>): JSX.Element => (
        <li key={suggestionKey(suggestion)} className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => selectSuggestion(suggestion)}
                disabled={addByFoodStatus.isPending}
                aria-busy={addByFoodStatus.isPending}
                className="flex-1 rounded-lg px-3 py-2 text-left text-body-md text-charcoal transition hover:bg-pearl disabled:opacity-60"
            >
                {suggestion.name}
            </button>
            <span className="shrink-0 rounded-full bg-seafoam/10 px-2 py-0.5 text-caption font-medium text-ocean-dark">
                {picker.catalogBadge}
            </span>
            {correctionControl(suggestion.foodId)}
        </li>
    );

    /**
     * The blended result list, rendered as TWO labeled sections (the command-palette pattern): the caller's
     * familiar ingredients first, then the food catalog. The sections are never interleaved, so the fast local
     * list does not reorder or shift when the catalog section appears, disappears, or degrades.
     */
    const suggestionSections = (suggestions: readonly IngredientSuggestion[]): JSX.Element | null => {
        const own = suggestions.filter(
            (suggestion): suggestion is Extract<IngredientSuggestion, { provenance: 'local' }> =>
                suggestion.provenance === 'local',
        );
        const fromCatalog = suggestions.filter(
            (suggestion): suggestion is Extract<IngredientSuggestion, { provenance: 'catalog' }> =>
                suggestion.provenance === 'catalog',
        );

        if (own.length === 0 && fromCatalog.length === 0) {
            return null;
        }

        return (
            <>
                {own.length > 0 && (
                    <section aria-label={picker.ownSectionTitle} className="flex flex-col">
                        <h4 className="px-2 py-1 text-caption font-semibold uppercase tracking-wide text-slate">
                            {picker.ownSectionTitle}
                        </h4>
                        <ul className="flex flex-col">
                            {own.map((suggestion) =>
                                ownRow(
                                    suggestion.ingredient,
                                    isTerminalStatus(suggestion.ingredient.foodResolutionStatus),
                                    () => selectSuggestion(suggestion),
                                ),
                            )}
                        </ul>
                    </section>
                )}

                {fromCatalog.length > 0 && (
                    <section aria-label={picker.catalogSectionTitle} className="flex flex-col">
                        <h4 className="px-2 py-1 text-caption font-semibold uppercase tracking-wide text-slate">
                            {picker.catalogSectionTitle}
                        </h4>
                        <ul className="flex flex-col">{fromCatalog.map(catalogRow)}</ul>
                    </section>
                )}
            </>
        );
    };

    /**
     * The ON-DEMAND source-search panel (U29) — rendered BELOW the local sections, never in place of them.
     *
     * Each settled kind gets its own affordance set, because each implies a different next move: hits are
     * pickable rows; "has nothing" is a quiet `status` with NO retry, since nothing failed and repeating the
     * search cannot change the answer; both failures are `alert`s with a retry, because the search never
     * actually happened.
     */
    const liveSearchPanel = ((): JSX.Element | null => {
        const state = liveSearch.state;

        if (state.kind === 'idle') {
            return null;
        }

        if (state.kind === 'searching') {
            return (
                <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2">
                    <p role="status" aria-label={liveCopy.searching} className="px-2 py-1 text-body-sm text-slate">
                        {liveCopy.searching}
                    </p>
                    <p className="px-2 text-caption text-slate">{liveCopy.searchingDetail}</p>
                </div>
            );
        }

        if (state.kind === 'results') {
            return (
                <section
                    aria-label={liveCopy.regionLabel}
                    className="flex flex-col rounded-xl border border-border bg-card p-2"
                >
                    <div className="flex items-center gap-2 px-2 py-1">
                        <h4 className="flex-1 text-caption font-semibold uppercase tracking-wide text-slate">
                            {liveCopy.resultsTitle}
                        </h4>
                        <button
                            type="button"
                            onClick={liveSearch.dismiss}
                            className="rounded-full px-2 py-0.5 text-caption font-medium text-slate transition hover:bg-pearl"
                        >
                            {liveCopy.dismiss}
                        </button>
                    </div>
                    <ul className="flex flex-col">
                        {state.hits.map((hit) => (
                            <li key={`${hit.name}:${hit.foodId ?? ''}`} className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => selectLiveHit(hit)}
                                    disabled={addByFoodStatus.isPending || addByNameStatus.isPending}
                                    className="flex-1 rounded-lg px-3 py-2 text-left text-body-md text-charcoal transition hover:bg-pearl disabled:opacity-60"
                                >
                                    {hit.name}
                                </button>
                                <span className="shrink-0 rounded-full bg-seafoam/10 px-2 py-0.5 text-caption font-medium text-ocean-dark">
                                    {picker.catalogBadge}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            );
        }

        if (state.kind === 'empty') {
            // ⛔ `status`, not `alert`, and NO retry: the source answered. A cook here should name the
            // ingredient themselves, and offering "try again" would send them round a loop that cannot end.
            return (
                <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2">
                    <p role="status" className="px-2 py-1 text-body-sm text-slate">
                        {fillTemplate(liveCopy.noResults, { query: state.query })}
                    </p>
                </div>
            );
        }

        return (
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2">
                <p role="alert" className="px-2 py-1 text-body-sm text-error-dark">
                    {state.kind === 'busy' ? liveCopy.busy : liveCopy.failed}
                </p>
                <div className="flex items-center gap-2 px-2">
                    <button
                        type="button"
                        onClick={liveSearch.search}
                        disabled={!liveSearch.canSearch}
                        className="rounded-full bg-seafoam/10 px-3 py-1 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/20 disabled:opacity-60"
                    >
                        {liveCopy.retry}
                    </button>
                    <button
                        type="button"
                        onClick={liveSearch.dismiss}
                        className="rounded-full px-3 py-1 text-body-sm font-medium text-slate transition hover:bg-pearl"
                    >
                        {liveCopy.dismiss}
                    </button>
                </div>
            </div>
        );
    })();

    /**
     * Whether the on-demand affordance is on screen at all.
     *
     * Offered once the query clears the 003-FR-010a minimum, and kept mounted while its own search runs so
     * the control the cook pressed stays the control they are waiting on (it is `disabled` meanwhile).
     * Below the minimum it is not merely disabled but ABSENT, matching the other query-keyed actions: a
     * two-character query cannot discriminate, and this is the one path that spends a shared external quota.
     */
    const isLiveSearchOffered = liveSearch.canSearch || liveSearch.state.kind === 'searching';

    /** The primary (addByName) + fallback (freeform) action row shared by every non-disambiguating kind. */
    const actionRow = (
        <>
            {addByNameStatus.isPending && (
                <p role="status" aria-label={picker.addingByName} className="px-2 py-1 text-body-sm text-slate">
                    {picker.addingByName}
                </p>
            )}
            {createStatus.isPending && (
                <p role="status" aria-label={picker.creating} className="px-2 py-1 text-body-sm text-slate">
                    {picker.creating}
                </p>
            )}
            {addByFoodStatus.isPending && (
                <p role="status" aria-label={picker.addingFromCatalog} className="px-2 py-1 text-body-sm text-slate">
                    {picker.addingFromCatalog}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {/* PRIMARY: resolve real nutrition through the food service (the async-resolution entry point). */}
                <button
                    type="button"
                    onClick={findNutrition}
                    disabled={addByNameStatus.isPending}
                    aria-busy={addByNameStatus.isPending}
                    className="rounded-full bg-seafoam px-4 py-1.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark disabled:opacity-60"
                >
                    {fillTemplate(picker.addByName, { query: trimmed })}
                </button>
                {/* FALLBACK: an explicit freeform (user-entered) ingredient with no food resolution. */}
                <button
                    type="button"
                    onClick={addFreeform}
                    disabled={createStatus.isPending}
                    aria-busy={createStatus.isPending}
                    className="rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/20 disabled:opacity-60"
                >
                    {fillTemplate(picker.addFreeform, { query: trimmed })}
                </button>
            </div>

            {liveSearchPanel}

            {/* U29: the ON-DEMAND source search. ⛔ A button, never a keystroke trigger — see the module doc
                for the quota arithmetic that makes a live typeahead impossible rather than merely costly.
                ⚠️ ONE control that DISABLES while its search runs, never a second element swapped in: a
                swap detaches the node a screen reader (and a test) is holding, and re-announces a control
                the cook never left. */}
            {isLiveSearchOffered && (
                <button
                    type="button"
                    onClick={liveSearch.search}
                    disabled={!liveSearch.canSearch}
                    aria-busy={liveSearch.state.kind === 'searching'}
                    className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-body-sm text-slate transition hover:bg-pearl disabled:opacity-60"
                >
                    <span className="flex-1">{fillTemplate(liveCopy.action, { query: trimmed })}</span>
                    {/* Not decoration: everything else here settles in under a second and this takes several,
                        so saying so BEFORE the press makes the wait read as the cook's choice. */}
                    <span className="shrink-0 rounded-full bg-pearl px-2 py-0.5 text-caption font-semibold uppercase tracking-wide text-slate">
                        {liveCopy.slowTag}
                    </span>
                </button>
            )}

            {addByNameStatus.isError && (
                <p role="alert" className="px-2 py-1 text-body-sm text-error-dark">
                    {picker.addByNameError}
                </p>
            )}
            {createStatus.isError && (
                <p role="alert" className="px-2 py-1 text-body-sm text-error-dark">
                    {picker.createError}
                </p>
            )}
            {addByFoodStatus.isError && (
                <p role="alert" className="px-2 py-1 text-body-sm text-error-dark">
                    {picker.catalogAddError}
                </p>
            )}
        </>
    );

    return (
        <section aria-label={picker.regionLabel} className="flex flex-col gap-2">
            {viewState.kind !== 'disambiguating' && viewState.kind !== 'resolving' && (
                <div className="flex items-center gap-2">
                    <input
                        type="search"
                        aria-label={picker.searchLabel}
                        placeholder={picker.searchPlaceholder}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        className="w-full flex-1 rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none placeholder:text-slate focus:ring-2 focus:ring-seafoam"
                    />
                    {/* C5: names the ingredient database the typeahead searches (wireframe recipe-edit.md:56). */}
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-ocean-dark">
                        {picker.usdaBadge}
                    </span>
                </div>
            )}

            {(viewState.kind === 'disambiguating' || viewState.kind === 'resolving') && (
                <div
                    role="group"
                    aria-label={fillTemplate(picker.disambiguateTitle, { name: viewState.name })}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm"
                >
                    <p className="px-2 py-1 text-body-sm font-medium text-charcoal">
                        {fillTemplate(picker.disambiguateTitle, { name: viewState.name })}
                    </p>

                    {viewState.kind === 'disambiguating' && viewState.isLoading && (
                        <p
                            role="status"
                            aria-label={picker.disambiguateLoading}
                            className="px-2 py-1 text-body-sm text-slate"
                        >
                            {picker.disambiguateLoading}
                        </p>
                    )}

                    {viewState.kind === 'disambiguating' && viewState.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error-dark">
                            {picker.disambiguateError}
                        </p>
                    )}

                    {viewState.kind === 'disambiguating' &&
                        !viewState.isLoading &&
                        !viewState.isError &&
                        viewState.candidates.length === 0 && (
                            <p className="px-2 py-1 text-body-sm text-slate">{picker.disambiguateEmpty}</p>
                        )}

                    {viewState.candidates.length > 0 && (
                        <ul className="flex flex-col">
                            {viewState.candidates.map((candidate) => (
                                <li key={candidate.candidateId}>
                                    <button
                                        type="button"
                                        onClick={() => pickCandidate(candidate.candidateId)}
                                        disabled={viewState.kind === 'resolving'}
                                        className="w-full rounded-lg px-3 py-2 text-left text-body-md text-charcoal transition hover:bg-pearl disabled:opacity-60"
                                    >
                                        {candidate.name}
                                        {candidate.summary !== null && (
                                            <span className="block text-caption text-slate">{candidate.summary}</span>
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    {viewState.kind === 'resolving' && (
                        // The post-pick resolution poll. ONE placeholder row: exactly one line is being
                        // resolved, so reserving three would promise rows that are never coming.
                        <IngredientRowsSkeleton label={picker.resolving} rowCount={1} />
                    )}

                    {viewState.kind === 'disambiguating' && resolveError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error-dark">
                            {picker.resolveError}
                        </p>
                    )}

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={cancelDisambiguation}
                            className="rounded-full px-3 py-1 text-body-sm font-medium text-slate transition hover:bg-pearl"
                        >
                            {picker.disambiguateBack}
                        </button>
                        <button
                            type="button"
                            onClick={addFreeform}
                            disabled={createStatus.isPending}
                            aria-busy={createStatus.isPending}
                            className="rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/20 disabled:opacity-60"
                        >
                            {fillTemplate(picker.addFreeform, { query: viewState.name })}
                        </button>
                    </div>
                </div>
            )}

            {/* 003-FR-010a (plan U37): something is typed, but below the minimum. ⛔ NOT the `noMatches`
                copy — that asserts the catalog was searched and came back empty, and nothing was searched
                here — and ⛔ NOT accompanied by `actionRow`: "Find nutrition for “eg”" fires the very search
                the minimum gates, and "Add “eg” as a custom ingredient" mints a shared catalog row named
                `eg`, one stray keystroke from junk data. It is not a live region either: it is guidance
                about the input, not the outcome of a request. */}
            {viewState.kind === 'tooShort' && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    <p className="px-2 py-1 text-body-sm text-slate">
                        {fillTemplate(minimumCopy.tooShort, { minimum: viewState.minimum })}
                    </p>
                </div>
            )}

            {viewState.kind === 'searching' && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    {/* Placeholder ROWS, not a bare line of text: the panel is about to fill with suggestion
                        rows, and a text-only wait leaves it blank and then shoves the action row below down
                        the page when they land. The caption is still the region's CONTENT — see
                        `IngredientRowsSkeleton` for why that half is not optional. */}
                    <IngredientRowsSkeleton label={picker.searching} />
                    {actionRow}
                </div>
            )}

            {viewState.kind === 'terminal' && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    <ul className="flex flex-col">
                        {ownRow(viewState.ingredient, true, () => selectMatch(viewState.ingredient))}
                    </ul>
                    {actionRow}
                </div>
            )}

            {viewState.kind === 'results' && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    {viewState.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error-dark">
                            {picker.errorTitle}
                        </p>
                    )}

                    {viewState.isSuccess && viewState.suggestions.length === 0 && (
                        <p className="px-2 py-1 text-body-sm text-slate">{picker.noMatches}</p>
                    )}

                    {suggestionSections(viewState.suggestions)}

                    {/* ⚠️ `alert` ONLY for a genuine failure. A no-op correction ("already saved") is a
                        SUCCESS — re-asserting a binding already in force is idempotent by design — and an
                        alert there would interrupt a screen-reader user to report a fault that did not
                        happen. The tone that decides this is computed once, in the shared pure model. */}
                    {correctionNotice !== undefined && (
                        <p
                            role={correctionNotice.tone === 'error' ? 'alert' : 'status'}
                            aria-label={correctionNotice.tone === 'error' ? undefined : correctionMessages.regionLabel}
                            className={`px-2 py-1 text-body-sm ${
                                correctionNotice.tone === 'error' ? 'text-error-dark' : 'text-slate'
                            }`}
                        >
                            {correctionNotice.text}
                        </p>
                    )}

                    {/* F2: the food catalog degraded, so only the caller's own ingredients rendered. A quiet
                        `role="status"` notice, NOT an `alert` — nothing failed from the user's point of view
                        and the local section is fully usable. */}
                    {viewState.catalogAvailability === 'unavailable' && (
                        <p role="status" className="px-2 py-1 text-body-sm text-slate">
                            {picker.catalogUnavailable}
                        </p>
                    )}

                    {actionRow}
                </div>
            )}
        </section>
    );
};
