/**
 * Recipe-edit screen (mobile, T067 + T070). Loads the recipe via `useRecipe`, seeds the {@link RecipeEditor}
 * from the loaded read model ({@link toRecipeFormValues}), and wires submit to the `useUpdateRecipe` mutation —
 * carrying the seed's `currentVersion` as `expectedVersion` for the service's optimistic-concurrency check.
 *
 * Concurrent-edit conflict resolution (T070): a save that loses the optimistic-concurrency race surfaces as a
 * {@link VersionConflictError} (409). Rather than falling through to the generic save-error, the screen
 * refetches the latest server recipe and enters conflict mode — presenting the user's in-progress draft
 * (`mine`) beside the newer saved recipe (`theirs`) via {@link RecipeConflictView}. Keep-mine re-submits the
 * draft against `theirs.currentVersion` (forcing it to win, or re-entering conflict mode with an even newer
 * `theirs`); use-theirs discards the draft by reseeding the editor from `theirs`. Every other error still
 * surfaces as the editor's inline save-error alert. Mirrors the web container.
 */
import {
    applyDraftToRecipeDetail,
    RecipeConflictView,
    toUpdateRecipeInput,
    type RecipeFormValues,
} from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { isVersionConflictError } from '@kitchensink/recipe-service-client';
import { useRecipe, useUpdateRecipe } from '@kitchensink/recipe-service-client/hooks';
import type { JSX } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { RecipePhotoUploader } from '../components/RecipePhotoUploader.js';
import { mobileMessages } from '../i18n/messages.js';
import { RecipeEditor } from './RecipeEditor.js';
import { toRecipeFormValues } from './toRecipeFormValues.js';

/** Props for {@link RecipeEditScreen}. */
export interface RecipeEditScreenProps {
    /** The id of the recipe to edit. */
    readonly recipeId: string;
    /** Invoked with the recipe's id after a successful save. */
    readonly onSaved: (recipeId: string) => void;
    /** Invoked when the user cancels the editor. */
    readonly onCancel: () => void;
}

/** In-flight concurrent-edit conflict: the user's draft, the latest saved recipe, and the draft values. */
interface ConflictState {
    /** The latest saved recipe that landed while the user was editing. */
    readonly theirs: RecipeDetail;
    /** The user's in-progress draft projected onto `theirs` (the "mine" side of the view). */
    readonly mine: RecipeDetail;
    /** The raw draft values, retained so keep-mine can re-submit them against the fresh version. */
    readonly values: RecipeFormValues;
}

/**
 * The recipe-edit screen.
 *
 * @param props - The recipe id and the save/cancel callbacks the navigator wires.
 * @returns The loading, error, populated editor, or conflict-resolution state.
 */
export function RecipeEditScreen({ recipeId, onSaved, onCancel }: RecipeEditScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const query = useRecipe(recipeId);
    const update = useUpdateRecipe();
    const [conflict, setConflict] = useState<ConflictState | null>(null);
    // After "use theirs" the editor must reseed from the fresh server recipe. `RecipeEditor` seeds once (on
    // mount), so both a new seed source (`seedOverride`) and a changed remount key (`seedNonce`) are needed
    // to discard the stale draft.
    const [seedOverride, setSeedOverride] = useState<RecipeDetail | undefined>(undefined);
    const [seedNonce, setSeedNonce] = useState(0);

    if (query.isLoading) {
        return (
            <View accessibilityLabel={t.detailLoading} style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (query.isError || query.data === undefined) {
        return (
            <View style={styles.center}>
                <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onCancel}>
                    <Text>{t.back}</Text>
                </Pressable>
                <Text accessibilityRole="alert">{t.detailError}</Text>
            </View>
        );
    }

    const seed = seedOverride ?? query.data;

    // Refetch the latest server recipe and enter conflict mode with the draft projected onto it.
    const enterConflict = async (values: RecipeFormValues): Promise<void> => {
        const result = await query.refetch();
        const theirs = result.data;

        if (theirs === undefined) {
            return;
        }

        setConflict({ theirs, mine: applyDraftToRecipeDetail(theirs, values), values });
    };

    // Submit a draft against a specific base version. A version conflict opens conflict mode; every other
    // error falls through to the editor's inline save-error alert.
    const submit = (values: RecipeFormValues, expectedVersion: number): void => {
        update.mutate(
            { id: recipeId, input: { ...toUpdateRecipeInput(values), expectedVersion } },
            {
                onSuccess: (updated) => onSaved(updated.id),
                onError: (error) => {
                    if (isVersionConflictError(error)) {
                        void enterConflict(values);
                    }
                },
            },
        );
    };

    if (conflict !== null) {
        return (
            <RecipeConflictView
                mineTitle={conflict.values.title}
                mine={conflict.mine}
                theirs={conflict.theirs}
                mineValues={conflict.values}
                theirsValues={toRecipeFormValues(conflict.theirs)}
                onKeepMine={() => submit(conflict.values, conflict.theirs.currentVersion)}
                onUseTheirs={() => {
                    setSeedOverride(conflict.theirs);
                    setSeedNonce((nonce) => nonce + 1);
                    setConflict(null);
                }}
                onMerge={(merged) => submit(merged, conflict.theirs.currentVersion)}
            />
        );
    }

    // A handled version conflict must never surface as the generic save-error; only other failures do.
    const showSaveError = update.isError && !isVersionConflictError(update.error);

    return (
        <>
            <RecipeEditor
                key={`${recipeId}:${seedNonce}`}
                mode="edit"
                initialValues={toRecipeFormValues(seed)}
                submitting={update.isPending}
                submitError={showSaveError ? t.saveError : undefined}
                onSubmit={(values) => submit(values, seed.currentVersion)}
                onCancel={onCancel}
            />
            <RecipePhotoUploader recipeId={recipeId} />
        </>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
