/**
 * Recipe-edit screen (mobile, T067 + T070; CP-6/P1 — rewired onto the shared `useRecipeEditor` headless
 * hook, `@commise/features-recipes/hooks`). The hook owns the whole edit lifecycle — seed-once, validation,
 * submit-with-`expectedVersion`, the 409-to-conflict transition, and the three FR-007c resolutions — as a
 * discriminated-union statechart; this screen is now a thin renderer that switches on `state.status`. The
 * old `seedNonce`/`seedOverride` remount hack is GONE: `RecipeEditor` is a plain controlled component
 * (`values` in, `onChange` out), so "use theirs" is the SAME `setValues` transition the hook's initial seed
 * uses — no remount required. See the hook's module doc for the full statechart and the reseed-
 * incompatibility fix. Mirrors the web `RecipeEditContainer`.
 */
import { RecipeConflictView, toRecipeFormValues } from '@commise/features-recipes';
import { useRecipeEditor } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { RecipePhotoUploader } from '../components/RecipePhotoUploader.js';
import { mobileMessages } from '../i18n/messages.js';
import { RecipeEditor } from './RecipeEditor.js';

/** Props for {@link RecipeEditScreen}. */
export interface RecipeEditScreenProps {
    /** The id of the recipe to edit. */
    readonly recipeId: string;
    /** Invoked with the recipe's id after a successful save. */
    readonly onSaved: (recipeId: string) => void;
    /** Invoked when the user cancels the editor. */
    readonly onCancel: () => void;
}

/**
 * The recipe-edit screen.
 *
 * @param props - The recipe id and the save/cancel callbacks the navigator wires.
 * @returns The loading, error, populated editor, or conflict-resolution state.
 */
export function RecipeEditScreen({ recipeId, onSaved, onCancel }: RecipeEditScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const editor = useRecipeEditor(recipeId, { onSaved: (recipe) => onSaved(recipe.id) });

    if (editor.query.isLoading) {
        return (
            <View accessibilityLabel={t.detailLoading} style={styles.center}>
                <ActivityIndicator />
            </View>
        );
    }

    if (editor.query.isError || editor.state.status === 'loading') {
        return (
            <View style={styles.center}>
                <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onCancel}>
                    <Text>{t.back}</Text>
                </Pressable>
                <Text accessibilityRole="alert">{t.detailError}</Text>
            </View>
        );
    }

    if (editor.state.status === 'conflict') {
        const { theirs, mine, draft, mergeSelections } = editor.state;

        return (
            <RecipeConflictView
                mineTitle={draft.title}
                mine={mine}
                theirs={theirs}
                mineValues={draft}
                theirsValues={toRecipeFormValues(theirs)}
                selections={mergeSelections}
                onSelectionsChange={editor.resolutions.setMergeSelections}
                onKeepMine={editor.resolutions.keepMine}
                onUseTheirs={editor.resolutions.useTheirs}
                onMerge={editor.resolutions.merge}
            />
        );
    }

    return (
        <>
            <RecipeEditor
                mode="edit"
                values={editor.values}
                errors={editor.errors}
                onChange={editor.setValues}
                submitting={editor.state.status === 'submitting'}
                submitError={editor.submitError ? t.saveError : undefined}
                onSubmit={editor.submit}
                onCancel={onCancel}
            />
            <RecipePhotoUploader recipeId={recipeId} />
        </>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
