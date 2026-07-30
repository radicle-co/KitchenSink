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
 * **Every progress region carries its label as CONTENT, not only as `aria-label`.** A `role="status"` node
 * rendered EMPTY is doubly broken: it is zero-height (nothing for a sighted viewer to see, and Playwright
 * resolves it as `hidden`) and it is silent — a live region announces content CHANGES, and a region with no
 * content has no change to announce. So each of the six affordances below (searching, find-nutrition,
 * freeform-create, catalog-admit, disambiguation-loading, resolving) renders its contextual, localized label
 * as its visible caption. Same doctrine as `RecipePhotoManager`'s upload status and the mobile `LoadingState`.
 */
import { fillTemplate, recipeFormMessages, resolutionStatusLabel } from '@commise/features-recipes';
import type { RecipeFormIngredient } from '@commise/features-recipes';
import { isTerminalStatus, suggestionKey, useIngredientResolver } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { Ingredient } from '@kitchensink/recipe-core';
import type { IngredientSuggestion } from '@kitchensink/recipe-service-client';
import type { FC, JSX } from 'react';

import { webMessages } from '@/i18n/messages';

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
    } = useIngredientResolver(onSelect);

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
                        <p role="status" aria-label={picker.resolving} className="px-2 py-1 text-body-sm text-slate">
                            {picker.resolving}
                        </p>
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

            {viewState.kind === 'searching' && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    <p role="status" aria-label={picker.searching} className="px-2 py-1 text-body-sm text-slate">
                        {picker.searching}
                    </p>
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
