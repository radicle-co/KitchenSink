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

    // `isError` MUST be checked before the loading condition below: on a genuine failure `query.data` stays
    // `undefined` forever, which would otherwise keep `editor.state.status === 'loading'` true forever too
    // (the seed effect never runs without data) and mask the error behind an infinite spinner.
    if (editor.query.isError) {
        return (
            <View style={styles.center}>
                <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onCancel}>
                    <Text>{t.back}</Text>
                </Pressable>
                <Text accessibilityRole="alert">{t.detailError}</Text>
            </View>
        );
    }

    // The query's own `isLoading` covers the network fetch; `state.status === 'loading'` ALSO covers the
    // committed-render gap after data lands but before the hook's seed-once effect has run (`query.isLoading`
    // already false, `values` not yet seeded). Both are loading, NOT error — routing the seed-gap into the
    // alert branch above would announce a false load-failure to screen readers on every successful edit-open.
    if (editor.query.isLoading || editor.state.status === 'loading') {
        return (
            <View accessibilityLabel={t.detailLoading} style={styles.center}>
                <ActivityIndicator />
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
