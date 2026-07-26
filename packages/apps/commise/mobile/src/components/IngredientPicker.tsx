/**
 * Ingredient typeahead (mobile, T067 support). A thin renderer (CP-6/P2) over the shared, platform-agnostic
 * `useIngredientResolver` (`@commise/features-recipes/hooks`), which owns the search text, the
 * disambiguation state, and all four ways a line resolves (catalog-hit, addByName, candidate pick,
 * freeform). This leaf's job is ONLY to render `viewState` with its own RN markup and wire the hook's
 * actions to `Pressable`/`TextInput` events — see the hook's module doc for the full state machine, the
 * async-resolution vertical (data-model R5 / FR-007), and the drift-unification decisions made when it was
 * extracted from this leaf and its web sibling.
 *
 * The hook's callback contract is `onResolved: (line: RecipeFormIngredient) => void`; this leaf keeps its
 * own public `onResolve` prop (its `ResolvedIngredient` shape, narrower than `RecipeFormIngredient` — no
 * `quantity`) unchanged for its existing caller (`RecipeEditor`), adapting at this boundary.
 */
import { fillTemplate } from '@commise/features-recipes';
import type { RecipeFormIngredient } from '@commise/features-recipes';
import { useIngredientResolver } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { FoodResolutionStatus, Ingredient } from '@kitchensink/recipe-core';
import type { IngredientCandidate } from '@kitchensink/recipe-service-client';
import type { JSX } from 'react';
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

/** Narrow the hook's `RecipeFormIngredient` line down to this leaf's `ResolvedIngredient` prop shape. */
function toResolvedIngredient(line: RecipeFormIngredient): ResolvedIngredient | null {
    if (line.ingredientId === null) {
        return null;
    }

    return {
        id: line.ingredientId,
        name: line.name,
        ...(line.resolutionStatus === undefined ? {} : { resolutionStatus: line.resolutionStatus }),
    };
}

/** One search-result row: the clickable match. No terminal notice — matches this leaf's prior behavior. */
function ResultRow({ ingredient, onPress }: { ingredient: Ingredient; onPress: () => void }): JSX.Element {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={ingredient.name} onPress={onPress}>
            <Text>{ingredient.name}</Text>
        </Pressable>
    );
}

/** One disambiguation-candidate row. */
function CandidateRow({
    candidate,
    disabled,
    onPress,
}: {
    candidate: IngredientCandidate;
    disabled: boolean;
    onPress: () => void;
}): JSX.Element {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={candidate.name}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
        >
            <Text>{candidate.name}</Text>
            {candidate.summary !== null && <Text>{candidate.summary}</Text>}
        </Pressable>
    );
}

/**
 * The ingredient typeahead.
 *
 * @param props - The resolution callback.
 * @returns The search + results + disambiguation + create affordances.
 */
export function IngredientPicker({ onResolve }: IngredientPickerProps): JSX.Element {
    const { ingredientPicker: t } = useMessages(mobileMessages);
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
    } = useIngredientResolver((line) => {
        const resolved = toResolvedIngredient(line);

        if (resolved !== null) {
            onResolve(resolved);
        }
    });

    if (viewState.kind === 'disambiguating' || viewState.kind === 'resolving') {
        const title = fillTemplate(t.disambiguateTitle, { name: viewState.name });
        const resolving = viewState.kind === 'resolving';

        return (
            <View accessibilityLabel={title}>
                <Text accessibilityRole="header">{title}</Text>
                {viewState.kind === 'disambiguating' && viewState.isLoading && <Text>{t.disambiguateLoading}</Text>}
                {viewState.kind === 'disambiguating' && viewState.isError && (
                    <Text accessibilityRole="alert">{t.disambiguateError}</Text>
                )}
                {viewState.kind === 'disambiguating' &&
                    !viewState.isLoading &&
                    !viewState.isError &&
                    viewState.candidates.length === 0 && <Text>{t.disambiguateEmpty}</Text>}
                {viewState.candidates.map((candidate) => (
                    <CandidateRow
                        key={candidate.candidateId}
                        candidate={candidate}
                        disabled={resolving}
                        onPress={() => pickCandidate(candidate.candidateId)}
                    />
                ))}
                {resolving && <Text>{t.resolving}</Text>}
                {viewState.kind === 'disambiguating' && resolveError && (
                    <Text accessibilityRole="alert">{t.resolveError}</Text>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(t.create, { query: viewState.name })}
                    accessibilityState={{ disabled: createStatus.isPending, busy: createStatus.isPending }}
                    disabled={createStatus.isPending}
                    onPress={addFreeform}
                >
                    <Text>{fillTemplate(t.create, { query: viewState.name })}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.disambiguateBack}
                    onPress={cancelDisambiguation}
                >
                    <Text>{t.disambiguateBack}</Text>
                </Pressable>
            </View>
        );
    }

    // idle | searching | results | terminal: the single-match "terminal" kind renders exactly like a
    // one-item results list (no distinct notice — mobile has never surfaced one; see the CP-6/P2 report).
    let results: readonly Ingredient[] = [];

    if (viewState.kind === 'terminal') {
        results = [viewState.ingredient];
    } else if (viewState.kind === 'results') {
        results = viewState.results;
    }

    const hasQuery = trimmed.length > 0;
    const showEmpty = viewState.kind === 'results' && results.length === 0;

    return (
        <View accessibilityLabel={t.heading}>
            <Text accessibilityRole="header">{t.heading}</Text>
            <View>
                <TextInput
                    accessibilityLabel={t.searchLabel}
                    placeholder={t.searchPlaceholder}
                    value={query}
                    onChangeText={setQuery}
                />
                {/* C5: names the ingredient database the typeahead searches (wireframe recipe-edit.md:56). */}
                <Text>{t.usdaBadge}</Text>
            </View>
            {results.map((ingredient) => (
                <ResultRow key={ingredient.id} ingredient={ingredient} onPress={() => selectMatch(ingredient)} />
            ))}
            {showEmpty && <Text>{t.empty}</Text>}
            {hasQuery && (
                <>
                    {/* PRIMARY: resolve real nutrition via the food service (the async-resolution entry point). */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fillTemplate(t.addByName, { query: trimmed })}
                        accessibilityState={{ disabled: addByNameStatus.isPending, busy: addByNameStatus.isPending }}
                        disabled={addByNameStatus.isPending}
                        onPress={findNutrition}
                    >
                        <Text>{fillTemplate(t.addByName, { query: trimmed })}</Text>
                    </Pressable>
                    {/* FALLBACK: an explicit freeform (user-entered) ingredient with no food resolution. */}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={fillTemplate(t.create, { query: trimmed })}
                        accessibilityState={{ disabled: createStatus.isPending, busy: createStatus.isPending }}
                        disabled={createStatus.isPending}
                        onPress={addFreeform}
                    >
                        <Text>{fillTemplate(t.create, { query: trimmed })}</Text>
                    </Pressable>
                </>
            )}
            {addByNameStatus.isPending && <Text>{t.addingByName}</Text>}
            {addByNameStatus.isError && <Text accessibilityRole="alert">{t.addByNameError}</Text>}
            {createStatus.isPending && <Text>{t.creating}</Text>}
        </View>
    );
}
