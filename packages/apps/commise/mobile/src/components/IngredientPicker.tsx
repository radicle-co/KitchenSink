/**
 * Ingredient typeahead (mobile, T067 support). Resolves a free-typed ingredient name to a catalog
 * `ingredientId` — the id the recipe wire-contract REQUIRES for every ingredient line — either by selecting
 * a search hit (`useSearchIngredients`) or by creating a freeform ingredient (`useCreateIngredient`). It owns
 * only the transient search text and which match (if any) is being disambiguated; the resolved ingredient is
 * reported upward via `onResolve`, where the editor appends it to the form's ingredient lines.
 *
 * Async resolution (data-model R5 / FR-007): the PRIMARY add action for a typed name is `addByName` (the
 * async-resolution entry point, `useAddIngredientByName`) — "Find nutrition for …" resolves real nutrition
 * through the source-agnostic food service, reporting a `PENDING` line the editor then polls to `RESOLVED`,
 * or opening disambiguation for an `UNRESOLVED` result. The freeform "Create …" below is the explicit
 * fallback. An `UNRESOLVED` match (from search OR addByName) opens a disambiguation candidate list
 * (`useIngredientCandidates`); picking a candidate resolves it (`useResolveIngredient`) and the line is
 * reported already `RESOLVED`. A `PENDING`/`RESOLVED` match reports immediately (its status flows onto the
 * line). It stores no remote state of its own (the query cache is the source of truth).
 */
import { fillTemplate } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';
import type { Ingredient } from '@kitchensink/recipe-core';
import {
    useAddIngredientByName,
    useCreateIngredient,
    useIngredientCandidates,
    useResolveIngredient,
    useSearchIngredients,
} from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';

/** A resolved ingredient handed upward: the catalog id, display name, and (when known) resolution status. */
export interface ResolvedIngredient {
    readonly id: string;
    readonly name: string;
    /** The line's async resolution status, when the catalog row carries one (drives the form's badge). */
    readonly resolutionStatus?: FoodResolutionStatus;
}

/** Props for {@link IngredientPicker}. */
export interface IngredientPickerProps {
    /** Invoked with the resolved catalog ingredient when the user selects a hit or creates a freeform one. */
    readonly onResolve: (ingredient: ResolvedIngredient) => void;
}

/** Project a catalog {@link Ingredient} onto the upward-reported resolved ingredient. */
function toResolved(ingredient: Ingredient): ResolvedIngredient {
    return {
        id: ingredient.id,
        name: ingredient.name,
        ...(ingredient.foodResolutionStatus === undefined ? {} : { resolutionStatus: ingredient.foodResolutionStatus }),
    };
}

/**
 * The ingredient typeahead.
 *
 * @param props - The resolution callback.
 * @returns The search + results + disambiguation + create affordances.
 */
export function IngredientPicker({ onResolve }: IngredientPickerProps): JSX.Element {
    const { ingredientPicker: t } = useMessages(mobileMessages);
    const [query, setQuery] = useState('');
    const [disambiguating, setDisambiguating] = useState<Ingredient | null>(null);
    const trimmed = query.trim();

    const search = useSearchIngredients(trimmed, undefined, { enabled: disambiguating === null });
    const addIngredientByName = useAddIngredientByName();
    const createIngredient = useCreateIngredient();
    const candidates = useIngredientCandidates(disambiguating?.id ?? '', { enabled: disambiguating !== null });
    const resolveIngredient = useResolveIngredient();

    const results = search.data ?? [];
    const hasQuery = trimmed.length > 0;
    const showEmpty = hasQuery && !search.isLoading && results.length === 0;

    const resolveLine = (ingredient: Ingredient): void => {
        onResolve(toResolved(ingredient));
        setQuery('');
        // Leaving disambiguation unmounts the candidate panel (and its resolve error/pending UI), so no
        // explicit mutation reset is needed — the transient mutation state is dropped with the subtree.
        setDisambiguating(null);
    };

    const selectMatch = (ingredient: Ingredient): void => {
        if (ingredient.foodResolutionStatus === FoodResolutionStatus.UNRESOLVED) {
            setDisambiguating(ingredient);

            return;
        }

        resolveLine(ingredient);
    };

    /**
     * The PRIMARY add action for a typed name (the async-resolution entry point): add the food by name and
     * route by the status it comes back with — `UNRESOLVED` opens disambiguation; `PENDING` / `RESOLVED`
     * reports a line the editor then polls. On failure the freeform fallback below stays available.
     */
    const findNutrition = (): void => {
        addIngredientByName.mutate(trimmed, {
            onSuccess: (ingredient) => {
                if (ingredient.foodResolutionStatus === FoodResolutionStatus.UNRESOLVED) {
                    setDisambiguating(ingredient);

                    return;
                }

                resolveLine(ingredient);
            },
        });
    };

    const pickCandidate = (candidateId: string): void => {
        if (disambiguating === null) {
            return;
        }

        resolveIngredient.mutate({ id: disambiguating.id, candidateIds: [candidateId] }, { onSuccess: resolveLine });
    };

    const createFreeform = (): void => {
        createIngredient.mutate(trimmed, { onSuccess: resolveLine });
    };

    if (disambiguating !== null) {
        const title = fillTemplate(t.disambiguateTitle, { name: disambiguating.name });

        return (
            <View accessibilityLabel={title}>
                <Text accessibilityRole="header">{title}</Text>
                {candidates.isLoading && <Text>{t.disambiguateLoading}</Text>}
                {candidates.isError && <Text accessibilityRole="alert">{t.disambiguateError}</Text>}
                {candidates.isSuccess && (candidates.data?.length ?? 0) === 0 && <Text>{t.disambiguateEmpty}</Text>}
                {(candidates.data ?? []).map((candidate) => (
                    <Pressable
                        key={candidate.candidateId}
                        accessibilityRole="button"
                        accessibilityLabel={candidate.name}
                        accessibilityState={{ disabled: resolveIngredient.isPending }}
                        disabled={resolveIngredient.isPending}
                        onPress={() => pickCandidate(candidate.candidateId)}
                    >
                        <Text>{candidate.name}</Text>
                        {candidate.summary !== null && <Text>{candidate.summary}</Text>}
                    </Pressable>
                ))}
                {resolveIngredient.isPending && <Text>{t.resolving}</Text>}
                {resolveIngredient.isError && <Text accessibilityRole="alert">{t.resolveError}</Text>}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(t.create, { query: disambiguating.name })}
                    accessibilityState={{ disabled: createIngredient.isPending, busy: createIngredient.isPending }}
                    disabled={createIngredient.isPending}
                    onPress={createFreeform}
                >
                    <Text>{fillTemplate(t.create, { query: disambiguating.name })}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.disambiguateBack}
                    onPress={() => setDisambiguating(null)}
                >
                    <Text>{t.disambiguateBack}</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View accessibilityLabel={t.heading}>
            <Text accessibilityRole="header">{t.heading}</Text>
            <TextInput
                accessibilityLabel={t.searchLabel}
                placeholder={t.searchPlaceholder}
                value={query}
                onChangeText={setQuery}
            />
            {results.map((ingredient) => (
                <Pressable
                    key={ingredient.id}
                    accessibilityRole="button"
                    accessibilityLabel={ingredient.name}
                    onPress={() => selectMatch(ingredient)}
                >
                    <Text>{ingredient.name}</Text>
                </Pressable>
            ))}
            {showEmpty && <Text>{t.empty}</Text>}
            {hasQuery && (
                <>
                    {/* PRIMARY: resolve real nutrition via the food service (the async-resolution entry point). */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fillTemplate(t.addByName, { query: trimmed })}
                        accessibilityState={{
                            disabled: addIngredientByName.isPending,
                            busy: addIngredientByName.isPending,
                        }}
                        disabled={addIngredientByName.isPending}
                        onPress={findNutrition}
                    >
                        <Text>{fillTemplate(t.addByName, { query: trimmed })}</Text>
                    </Pressable>
                    {/* FALLBACK: an explicit freeform (user-entered) ingredient with no food resolution. */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fillTemplate(t.create, { query: trimmed })}
                        accessibilityState={{ disabled: createIngredient.isPending, busy: createIngredient.isPending }}
                        disabled={createIngredient.isPending}
                        onPress={createFreeform}
                    >
                        <Text>{fillTemplate(t.create, { query: trimmed })}</Text>
                    </Pressable>
                </>
            )}
            {addIngredientByName.isPending && <Text>{t.addingByName}</Text>}
            {addIngredientByName.isError && <Text accessibilityRole="alert">{t.addByNameError}</Text>}
            {createIngredient.isPending && <Text>{t.creating}</Text>}
        </View>
    );
}
