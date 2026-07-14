'use client';

/**
 * The async ingredient typeahead the shared `RecipeForm` building block deliberately omits (it resolves no
 * ingredient itself). The composing create/edit container owns this picker: a controlled search box drives
 * `useSearchIngredients` (the hook gates itself on a non-empty query), each catalog match resolves the
 * recipe line to a real `ingredientId` + name, and an "add as a custom ingredient" path creates a freeform
 * ingredient via `useCreateIngredient` and resolves the line to the returned id + status.
 *
 * Resolution status flows straight from the catalog {@link Ingredient} onto the form line so the form's own
 * status badge reflects it. A terminal food resolution (`NOT_FOUND` / `FAILED`) is surfaced inline and the
 * freeform fallback stays available, so a cook is never stuck on an unresolvable match (FR-007). Remote
 * state stays in TanStack Query — the picker holds only the search-box text.
 */
import { fillTemplate, recipeFormMessages, resolutionStatusLabel } from '@commise/features-recipes';
import type { RecipeFormIngredient } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { FoodResolutionStatus, type Ingredient } from '@kitchensink/recipe-core';
import { useCreateIngredient, useSearchIngredients } from '@kitchensink/recipe-service-client/hooks';
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
 * @returns The search box plus its results / empty / error affordances and the freeform-create fallback.
 */
export const IngredientPicker: FC<IngredientPickerProps> = ({ onSelect }) => {
    const { recipes } = useMessages(webMessages);
    const picker = recipes.picker;
    const formMessages = useMessages(recipeFormMessages);
    const [query, setQuery] = useState('');
    const trimmed = query.trim();

    const search = useSearchIngredients(trimmed);
    const createIngredient = useCreateIngredient();

    const results = search.data ?? [];

    const resolve = (ingredient: Ingredient): void => {
        onSelect(toIngredientLine(ingredient));
        setQuery('');
        createIngredient.reset();
    };

    const addFreeform = (): void => {
        createIngredient.mutate(trimmed, { onSuccess: resolve });
    };

    return (
        <section aria-label={picker.regionLabel}>
            <input
                type="search"
                aria-label={picker.searchLabel}
                placeholder={picker.searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
            />

            {trimmed.length > 0 && (
                <div>
                    {search.isLoading && <p role="status" aria-label={picker.searching} />}

                    {search.isError && <p role="alert">{picker.errorTitle}</p>}

                    {search.isSuccess && results.length === 0 && <p>{picker.noMatches}</p>}

                    {results.length > 0 && (
                        <ul>
                            {results.map((ingredient) => (
                                <li key={ingredient.id}>
                                    <button type="button" onClick={() => resolve(ingredient)}>
                                        {ingredient.name}
                                    </button>
                                    {ingredient.foodResolutionStatus !== undefined && (
                                        <span>
                                            {resolutionStatusLabel(formMessages, ingredient.foodResolutionStatus)}
                                        </span>
                                    )}
                                    {isTerminalStatus(ingredient.foodResolutionStatus) && (
                                        <span role="note">{picker.terminalNotice}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}

                    {createIngredient.isPending && <p role="status" aria-label={picker.creating} />}

                    <button
                        type="button"
                        onClick={addFreeform}
                        disabled={createIngredient.isPending}
                        aria-busy={createIngredient.isPending}
                    >
                        {fillTemplate(picker.addFreeform, { query: trimmed })}
                    </button>

                    {createIngredient.isError && <p role="alert">{picker.createError}</p>}
                </div>
            )}
        </section>
    );
};
