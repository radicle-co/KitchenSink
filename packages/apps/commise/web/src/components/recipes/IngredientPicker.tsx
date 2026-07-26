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
 */
import { fillTemplate, recipeFormMessages, resolutionStatusLabel } from '@commise/features-recipes';
import type { RecipeFormIngredient } from '@commise/features-recipes';
import { isTerminalStatus, useIngredientResolver } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { Ingredient } from '@kitchensink/recipe-core';
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
        createStatus,
        resolveError,
        selectMatch,
        findNutrition,
        pickCandidate,
        addFreeform,
        cancelDisambiguation,
    } = useIngredientResolver(onSelect);

    /** One search-result row: the clickable match, its status badge, and a terminal notice when applicable. */
    const resultRow = (ingredient: Ingredient, terminal: boolean): JSX.Element => (
        <li key={ingredient.id} className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => selectMatch(ingredient)}
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

    /** The primary (addByName) + fallback (freeform) action row shared by every non-disambiguating kind. */
    const actionRow = (
        <>
            {addByNameStatus.isPending && (
                <p role="status" aria-label={picker.addingByName} className="px-2 py-1 text-body-sm text-slate" />
            )}
            {createStatus.isPending && (
                <p role="status" aria-label={picker.creating} className="px-2 py-1 text-body-sm text-slate" />
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
                    className="rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/20 disabled:opacity-60"
                >
                    {fillTemplate(picker.addFreeform, { query: trimmed })}
                </button>
            </div>

            {addByNameStatus.isError && (
                <p role="alert" className="px-2 py-1 text-body-sm text-error">
                    {picker.addByNameError}
                </p>
            )}
            {createStatus.isError && (
                <p role="alert" className="px-2 py-1 text-body-sm text-error">
                    {picker.createError}
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
                        className="w-full flex-1 rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none placeholder:text-mist focus:ring-2 focus:ring-seafoam-light"
                    />
                    {/* C5: names the ingredient database the typeahead searches (wireframe recipe-edit.md:56). */}
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-seafoam/10 px-3 py-1 text-caption font-medium text-seafoam">
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
                        />
                    )}

                    {viewState.kind === 'disambiguating' && viewState.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error">
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
                        <p role="status" aria-label={picker.resolving} className="px-2 py-1 text-body-sm text-slate" />
                    )}

                    {viewState.kind === 'disambiguating' && resolveError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error">
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
                            className="rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/20 disabled:opacity-60"
                        >
                            {fillTemplate(picker.addFreeform, { query: viewState.name })}
                        </button>
                    </div>
                </div>
            )}

            {viewState.kind === 'searching' && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    <p role="status" aria-label={picker.searching} className="px-2 py-1 text-body-sm text-slate" />
                    {actionRow}
                </div>
            )}

            {viewState.kind === 'terminal' && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    <ul className="flex flex-col">{resultRow(viewState.ingredient, true)}</ul>
                    {actionRow}
                </div>
            )}

            {viewState.kind === 'results' && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    {viewState.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error">
                            {picker.errorTitle}
                        </p>
                    )}

                    {viewState.isSuccess && viewState.results.length === 0 && (
                        <p className="px-2 py-1 text-body-sm text-slate">{picker.noMatches}</p>
                    )}

                    {viewState.results.length > 0 && (
                        <ul className="flex flex-col">
                            {viewState.results.map((ingredient) =>
                                resultRow(ingredient, isTerminalStatus(ingredient.foodResolutionStatus)),
                            )}
                        </ul>
                    )}

                    {actionRow}
                </div>
            )}
        </section>
    );
};
