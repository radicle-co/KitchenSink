/**
 * Ingredient typeahead (mobile, T067 support). Resolves a free-typed ingredient name to a catalog
 * `ingredientId` — the id the recipe wire-contract REQUIRES for every ingredient line — either by selecting
 * a search hit (`useSearchIngredients`) or by creating a freeform ingredient (`useCreateIngredient`). It owns
 * only the transient search text; the resolved ingredient is reported upward via `onResolve`, where the
 * editor appends it to the form's ingredient lines. It stores no remote state of its own (the query cache is
 * the source of truth) and renders search, empty, and create affordances.
 */
import { fillTemplate } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import { useCreateIngredient, useSearchIngredients } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';

/** A resolved ingredient handed upward: the catalog id plus its display name. */
export interface ResolvedIngredient {
    readonly id: string;
    readonly name: string;
}

/** Props for {@link IngredientPicker}. */
export interface IngredientPickerProps {
    /** Invoked with the resolved catalog ingredient when the user selects a hit or creates a freeform one. */
    readonly onResolve: (ingredient: ResolvedIngredient) => void;
}

/**
 * The ingredient typeahead.
 *
 * @param props - The resolution callback.
 * @returns The search + results + create affordances.
 */
export function IngredientPicker({ onResolve }: IngredientPickerProps): JSX.Element {
    const { ingredientPicker: t } = useMessages(mobileMessages);
    const [query, setQuery] = useState('');
    const trimmed = query.trim();

    const search = useSearchIngredients(trimmed);
    const createIngredient = useCreateIngredient();

    const results = search.data ?? [];
    const hasQuery = trimmed.length > 0;
    const showEmpty = hasQuery && !search.isLoading && results.length === 0;

    const resolve = (ingredient: ResolvedIngredient): void => {
        onResolve(ingredient);
        setQuery('');
    };

    const createFreeform = (): void => {
        createIngredient.mutate(trimmed, {
            onSuccess: (ingredient) => resolve({ id: ingredient.id, name: ingredient.name }),
        });
    };

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
                    onPress={() => resolve({ id: ingredient.id, name: ingredient.name })}
                >
                    <Text>{ingredient.name}</Text>
                </Pressable>
            ))}
            {showEmpty && <Text>{t.empty}</Text>}
            {hasQuery && (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={fillTemplate(t.create, { query: trimmed })}
                    accessibilityState={{ disabled: createIngredient.isPending, busy: createIngredient.isPending }}
                    disabled={createIngredient.isPending}
                    onPress={createFreeform}
                >
                    <Text>{fillTemplate(t.create, { query: trimmed })}</Text>
                </Pressable>
            )}
            {createIngredient.isPending && <Text>{t.creating}</Text>}
        </View>
    );
}
