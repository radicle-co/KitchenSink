'use client';

/**
 * The async ingredient typeahead the shared `RecipeForm` building block deliberately omits (it resolves no
 * ingredient itself). The composing create/edit container owns this picker: a controlled search box drives
 * `useSearchIngredients` (the hook gates itself on a non-empty query), each catalog match resolves the
 * recipe line to a real `ingredientId` + name, and an "add as a custom ingredient" path creates a freeform
 * ingredient via `useCreateIngredient` and resolves the line to the returned id + status.
 *
 * Resolution status flows straight from the catalog {@link Ingredient} onto the form line so the form's own
 * status badge reflects it. The async-resolution vertical (data-model R5 / FR-007) is reachable from here:
 *   - **addByName (the entry point).** A name the cook typed that is NOT already a catalog hit resolves
 *     through the source-agnostic food service: "Find nutrition for …" (`useAddIngredientByName`) creates a
 *     food-backed ingredient that comes back `PENDING` (added immediately; the container polls it to
 *     `RESOLVED`) or `UNRESOLVED` (opens disambiguation). This is the PRIMARY add action for a typed name;
 *     the freeform create below is the explicit fallback (a cook who KNOWS the item has no nutrition, or
 *     when a food-resolution add fails/comes back terminal).
 *   - A terminal food resolution (`NOT_FOUND` / `FAILED`) on a catalog hit is surfaced and the freeform
 *     fallback stays available, so a cook is never stuck on an unresolvable match.
 *   - An `UNRESOLVED` match (from search OR addByName) needs disambiguation: it opens a candidate list
 *     (`useIngredientCandidates`); choosing a candidate resolves it (`useResolveIngredient`) and the line is
 *     added already `RESOLVED` with nutrition. The freeform fallback stays available here too.
 *   - A `PENDING` / `RESOLVED` match is added immediately (the form badges a still-`PENDING` line and the
 *     container polls it to `RESOLVED`).
 * Remote state stays in TanStack Query — the picker holds only the search-box text and which match (if any)
 * is being disambiguated.
 */
import { fillTemplate, recipeFormMessages, resolutionStatusLabel } from '@commise/features-recipes';
import type { RecipeFormIngredient } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { FoodResolutionStatus, type Ingredient } from '@kitchensink/recipe-core';
import {
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useResolveIngredient,
    useSearchIngredients,
} from '@kitchensink/recipe-service-client/hooks';
import { useState } from 'react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link IngredientPicker}. */
export interface IngredientPickerProps {
    /** Called with a fully-resolved recipe line (its `ingredientId` set) to append to the recipe. */
    readonly onSelect: (line: RecipeFormIngredient) => void;
}

/** Whether a match's food resolution is terminal — no nutrition will ever arrive (FR-007). */
function isTerminalStatus(status: FoodResolutionStatus | undefined): boolean {
    return status === FoodResolutionStatus.NOT_FOUND || status === FoodResolutionStatus.FAILED;
}

/** Whether a match needs disambiguation (multiple candidate foods) before it can resolve (R5). */
function isUnresolvedStatus(status: FoodResolutionStatus | undefined): boolean {
    return status === FoodResolutionStatus.UNRESOLVED;
}

/** Project a catalog {@link Ingredient} onto a resolved form line (quantity defaults to 1; the form edits it). */
function toIngredientLine(ingredient: Ingredient): RecipeFormIngredient {
    return {
        ingredientId: ingredient.id,
        name: ingredient.name,
        quantity: 1,
        ...(ingredient.foodResolutionStatus === undefined ? {} : { resolutionStatus: ingredient.foodResolutionStatus }),
    };
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
    const [query, setQuery] = useState('');
    const [disambiguating, setDisambiguating] = useState<Ingredient | null>(null);
    const trimmed = query.trim();

    const search = useSearchIngredients(trimmed, undefined, { enabled: disambiguating === null });
    const addIngredientByName = useAddIngredientByName();
    const createIngredient = useCreateIngredient();
    const candidates = useIngredientCandidates(disambiguating?.id ?? '', { enabled: disambiguating !== null });
    const resolveIngredient = useResolveIngredient();

    const results = search.data ?? [];

    /** Append a resolved line and reset the picker back to a blank search. */
    const resolveLine = (ingredient: Ingredient): void => {
        onSelect(toIngredientLine(ingredient));
        setQuery('');
        setDisambiguating(null);
        addIngredientByName.reset();
        createIngredient.reset();
        resolveIngredient.reset();
    };

    /** Handle a search-result click: an `UNRESOLVED` match opens disambiguation; anything else resolves now. */
    const selectMatch = (ingredient: Ingredient): void => {
        if (isUnresolvedStatus(ingredient.foodResolutionStatus)) {
            setDisambiguating(ingredient);

            return;
        }

        resolveLine(ingredient);
    };

    /**
     * The PRIMARY add action for a typed name (the async-resolution entry point): add the food by name and
     * route by the status it comes back with — `UNRESOLVED` opens disambiguation, `PENDING` / `RESOLVED`
     * (and any deduped terminal) is added as a line the container then polls. On failure the freeform
     * fallback below stays available.
     */
    const findNutrition = (): void => {
        addIngredientByName.mutate(trimmed, {
            onSuccess: (ingredient) => {
                if (isUnresolvedStatus(ingredient.foodResolutionStatus)) {
                    setDisambiguating(ingredient);

                    return;
                }

                resolveLine(ingredient);
            },
        });
    };

    /** Pick a disambiguation candidate: resolve the food, then append the now-`RESOLVED` line. */
    const pickCandidate = (candidateId: string): void => {
        if (disambiguating === null) {
            return;
        }

        resolveIngredient.mutate({ id: disambiguating.id, candidateIds: [candidateId] }, { onSuccess: resolveLine });
    };

    const leaveDisambiguation = (): void => {
        setDisambiguating(null);
        resolveIngredient.reset();
    };

    const addFreeform = (): void => {
        createIngredient.mutate(trimmed, { onSuccess: resolveLine });
    };

    return (
        <section aria-label={picker.regionLabel} className="flex flex-col gap-2">
            {disambiguating === null && (
                <input
                    type="search"
                    aria-label={picker.searchLabel}
                    placeholder={picker.searchPlaceholder}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none placeholder:text-mist focus:ring-2 focus:ring-seafoam-light"
                />
            )}

            {disambiguating !== null && (
                <div
                    role="group"
                    aria-label={fillTemplate(picker.disambiguateTitle, { name: disambiguating.name })}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm"
                >
                    <p className="px-2 py-1 text-body-sm font-medium text-charcoal">
                        {fillTemplate(picker.disambiguateTitle, { name: disambiguating.name })}
                    </p>

                    {candidates.isLoading && (
                        <p
                            role="status"
                            aria-label={picker.disambiguateLoading}
                            className="px-2 py-1 text-body-sm text-slate"
                        />
                    )}

                    {candidates.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error">
                            {picker.disambiguateError}
                        </p>
                    )}

                    {candidates.isSuccess && candidates.data.length === 0 && (
                        <p className="px-2 py-1 text-body-sm text-slate">{picker.disambiguateEmpty}</p>
                    )}

                    {candidates.data !== undefined && candidates.data.length > 0 && (
                        <ul className="flex flex-col">
                            {candidates.data.map((candidate) => (
                                <li key={candidate.candidateId}>
                                    <button
                                        type="button"
                                        onClick={() => pickCandidate(candidate.candidateId)}
                                        disabled={resolveIngredient.isPending}
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

                    {resolveIngredient.isPending && (
                        <p role="status" aria-label={picker.resolving} className="px-2 py-1 text-body-sm text-slate" />
                    )}

                    {resolveIngredient.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error">
                            {picker.resolveError}
                        </p>
                    )}

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={leaveDisambiguation}
                            className="rounded-full px-3 py-1 text-body-sm font-medium text-slate transition hover:bg-pearl"
                        >
                            {picker.disambiguateBack}
                        </button>
                        <button
                            type="button"
                            onClick={addFreeform}
                            disabled={createIngredient.isPending}
                            aria-busy={createIngredient.isPending}
                            className="rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/20 disabled:opacity-60"
                        >
                            {fillTemplate(picker.addFreeform, { query: disambiguating.name })}
                        </button>
                    </div>
                </div>
            )}

            {disambiguating === null && trimmed.length > 0 && (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
                    {search.isLoading && (
                        <p role="status" aria-label={picker.searching} className="px-2 py-1 text-body-sm text-slate" />
                    )}

                    {search.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error">
                            {picker.errorTitle}
                        </p>
                    )}

                    {search.isSuccess && results.length === 0 && (
                        <p className="px-2 py-1 text-body-sm text-slate">{picker.noMatches}</p>
                    )}

                    {results.length > 0 && (
                        <ul className="flex flex-col">
                            {results.map((ingredient) => (
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
                                    {isTerminalStatus(ingredient.foodResolutionStatus) && (
                                        <span role="note" className="text-caption text-warning">
                                            {picker.terminalNotice}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {addIngredientByName.isPending && (
                        <p
                            role="status"
                            aria-label={picker.addingByName}
                            className="px-2 py-1 text-body-sm text-slate"
                        />
                    )}
                    {createIngredient.isPending && (
                        <p role="status" aria-label={picker.creating} className="px-2 py-1 text-body-sm text-slate" />
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        {/* PRIMARY: resolve real nutrition through the food service (the async-resolution entry point). */}
                        <button
                            type="button"
                            onClick={findNutrition}
                            disabled={addIngredientByName.isPending}
                            aria-busy={addIngredientByName.isPending}
                            className="rounded-full bg-seafoam px-4 py-1.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark disabled:opacity-60"
                        >
                            {fillTemplate(picker.addByName, { query: trimmed })}
                        </button>
                        {/* FALLBACK: an explicit freeform (user-entered) ingredient with no food resolution. */}
                        <button
                            type="button"
                            onClick={addFreeform}
                            disabled={createIngredient.isPending}
                            aria-busy={createIngredient.isPending}
                            className="rounded-full bg-seafoam/10 px-4 py-1.5 text-body-sm font-medium text-seafoam transition hover:bg-seafoam/20 disabled:opacity-60"
                        >
                            {fillTemplate(picker.addFreeform, { query: trimmed })}
                        </button>
                    </div>

                    {addIngredientByName.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error">
                            {picker.addByNameError}
                        </p>
                    )}
                    {createIngredient.isError && (
                        <p role="alert" className="px-2 py-1 text-body-sm text-error">
                            {picker.createError}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
};
