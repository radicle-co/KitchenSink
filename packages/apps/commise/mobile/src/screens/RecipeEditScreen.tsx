/**
 * Recipe-edit screen (mobile, T067 + T070; CP-6/P1 — rewired onto the shared `useRecipeEditor` headless
 * hook, `@commise/features-recipes/hooks`; w3/e1,e2 — rewired again onto the 4-step `Wizard` shell via
 * `RecipeEditor`). The hook owns the whole edit lifecycle — seed-once, validation,
 * submit-with-`expectedVersion`, the 409-to-conflict transition, the three FR-007c resolutions, AND (w3) the
 * step/draft/publish extensions — as a discriminated-union statechart plus orthogonal step-navigation state;
 * this screen is a thin renderer that switches on `state.status`. The old `seedNonce`/`seedOverride` remount
 * hack is GONE: `RecipeEditor` is a plain controlled component (`values` in, `onChange` out), so "use
 * theirs" is the SAME `setValues` transition the hook's initial seed uses — no remount required. See the
 * hook's module doc for the full statechart and the reseed-incompatibility fix. Mirrors the web
 * `RecipeEditContainer`.
 *
 * **OQ-1 resolve→detail navigation (W7 Task 6).** A successful `overwrite`/`merge` resolves through the SAME
 * `submitDraft` → `onSuccess` → `opts.onSaved` path a plain save uses, so it lands on the SAME
 * `onSaved(recipe.id)` call this screen already wires. Choosing `keepServer` (Option A) is different: it is a
 * discard, not a write, so `useRecipeEditor` never calls `onSaved` for it — it transitions to the DISTINCT
 * `status: 'discarded'` terminal instead. This screen watches for that transition in its own `useEffect` and
 * calls `onCancel` — the navigator (`RecipesScreen`) wires BOTH `onSaved` and `onCancel` to `nav.back()`,
 * which pops the pushed edit screen back to the detail screen already underneath it on the stack, so
 * `onCancel` lands on the SAME detail destination `onSaved` does, without implying a write happened.
 */
import {
    RecipeConflictView,
    recipeVersionMessages,
    toRecipeFormValues,
    useDiscardGuard,
} from '@commise/features-recipes';
import { useRecipeEditor } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';
import { useEffect } from 'react';
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
    const { conflict } = useMessages(recipeVersionMessages);
    const editor = useRecipeEditor(recipeId, { onSaved: (recipe) => onSaved(recipe.id) });

    // The discard guard's "unsaved edits" baseline: captured once the recipe has seeded (past `'loading'`),
    // re-captured on every successful save (`'saved'`) — see `useDiscardGuard`'s module doc. Declared before
    // the early returns below (Rules of Hooks: no conditional hook calls).
    const isDirty = useDiscardGuard(editor.values, {
        ready: editor.state.status !== 'loading',
        justSaved: editor.state.status === 'saved',
    });

    // OQ-1 (W7 Task 6): `keepServer` (Option A) discards the draft WITHOUT a write, so it never runs the
    // `onSaved` callback a real save resolves through — it lands on the DISTINCT `status: 'discarded'`
    // terminal instead (see `useRecipeEditor`'s module doc). This effect is the screen's own reaction to that
    // terminal: call `onCancel` (the navigator pops back to the same detail screen `onSaved` would), never
    // `onSaved` — a discard is not a save. Keyed on the `status` STRING (not the `EditorState` object, which
    // is a fresh reference every render) so it fires exactly once per transition into `'discarded'`.
    useEffect(() => {
        if (editor.state.status === 'discarded') {
            onCancel();
        }
    }, [editor.state.status, onCancel]);

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
        const { theirs, draft, mergeSelections, server, base, diff, versionsBehind } = editor.state;

        return (
            <RecipeConflictView
                server={server}
                {...(base === undefined ? {} : { base })}
                diff={diff}
                versionsBehind={versionsBehind}
                mineValues={draft}
                theirsValues={toRecipeFormValues(theirs)}
                selections={mergeSelections}
                onSelectionsChange={editor.resolutions.setMergeSelections}
                onKeepServer={editor.resolutions.keepServer}
                onOverwrite={editor.resolutions.overwrite}
                onMerge={editor.resolutions.merge}
            />
        );
    }

    return (
        <RecipeEditor
            mode="edit"
            values={editor.values}
            errors={editor.errors}
            onChange={editor.setValues}
            submitting={editor.state.status === 'submitting'}
            // `submitError` (a generic save failure) and `conflictDataUnavailable` (a 409 this hook could not
            // build a conflict view for) are MUTUALLY EXCLUSIVE — the latter requires `isVersionConflictError`,
            // which `submitError` deliberately excludes (see the hook's own JSDoc) — so sharing one alert slot
            // can never hide one behind the other. The machine stays `editing` either way, so the user can retry.
            submitError={
                editor.submitError ? t.saveError : editor.conflictDataUnavailable ? conflict.dataUnavailable : undefined
            }
            step={editor.step}
            canAdvanceFrom={editor.canAdvanceFrom}
            stepErrors={editor.stepErrors}
            goNext={editor.goNext}
            goPrev={editor.goPrev}
            goToStep={editor.goToStep}
            saveDraft={editor.saveDraft}
            publish={editor.publish}
            isDirty={isDirty}
            onCancel={onCancel}
            photosSlot={<RecipePhotoUploader recipeId={recipeId} />}
        />
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
