/**
 * Recipe-edit screen (mobile, orchestration): a suspense read of the recipe under `QueryBoundary`, whose settled branch
 * is the editor — the same shape as the web `RecipeEditContainer`. The boundary owns loading and the load failure (a
 * not-found with only Back, or the generic error with a retry, as `RecipeDetailScreen` offers); the settled editor is
 * keyed on the recipe id, so editing another recipe is a fresh editor seeded from it, and a failed background refetch
 * never reaches the boundary, so the editor and the draft stay. ⛔ Nothing under the boundary may suspend without its
 * own nested `<Suspense>`: React hides a re-suspended subtree, and the cook would watch the form vanish.
 *
 * History (T067 + T070; CP-6/P1 — rewired onto the shared `useRecipeEditor` headless
 * hook, `@commise/features-recipes/hooks`; w3/e1,e2 — rewired again onto the 4-step `Wizard` shell via
 * `RecipeEditor`). The hook owns the whole edit lifecycle — the mount-time seed, validation,
 * submit-with-`expectedVersion`, the 409-to-conflict transition, the three FR-007c resolutions, AND (w3) the
 * step/draft/publish extensions — as a discriminated-union statechart plus orthogonal step-navigation state;
 * this screen is a thin renderer that switches on `state.status`. The old `seedNonce`/`seedOverride` remount
 * hack is GONE: `RecipeEditor` is a plain controlled component (`values` in, `onChange` out), seeded once from the
 * settled read; editing another recipe is the keyed remount above, never a reseed. See the
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
 *
 * **"Discard and close" (wireframe gap #1) reuses this SAME wiring.** `editor.discardAndClose` (the header
 * exit `RecipeConflictView` now renders) also lands on `status: 'discarded'` — it needs no separate `useEffect`
 * branch here, since it is indistinguishable from `keepServer`'s own discard from this screen's point of view
 * (no write, `onCancel` back to the detail screen). Unlike `keepServer`, it stays callable even while a
 * resolve is in flight — see `useRecipeEditor`'s own doc for the epoch-guard that neutralizes a late resolve.
 *
 * @pattern Adapter — binds the `useRecipeEditor` statechart to the native `RecipeEditor` wizard, under a read boundary
 *     whose settled view is keyed on the recipe id.
 */
import { RecipeConflictView, recipeVersionMessages, useDiscardGuard } from '@commise/features-recipes';
import { useRecipeAutoSave, useRecipeEditor } from '@commise/features-recipes/hooks';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Feather } from '@expo/vector-icons';
import { QueryBoundary } from '@commise/query/boundary';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LoadingState } from '../components/LoadingState.js';
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
 * The recipe-edit screen: the read boundary around the settled editor.
 *
 * @param props - The recipe id and the save/cancel callbacks the navigator wires.
 * @returns The loading state, a not-found or retrying error, or the settled editor.
 */
export function RecipeEditScreen(props: RecipeEditScreenProps): JSX.Element {
    const { recipeId, onCancel } = props;
    const { recipes: t } = useMessages(mobileMessages);
    const back = (
        <Pressable accessibilityRole="button" accessibilityLabel={t.back} onPress={onCancel}>
            <Text>{t.back}</Text>
        </Pressable>
    );

    return (
        <QueryBoundary
            loading={<LoadingState label={t.detailLoading} />}
            renderError={({ error, resetErrorBoundary }) =>
                isNotFoundError(error) ? (
                    <View style={styles.center}>
                        {back}
                        <Text accessibilityRole="alert">{t.detailNotFound}</Text>
                    </View>
                ) : (
                    <View style={styles.center}>
                        {back}
                        <Text accessibilityRole="alert">{t.detailError}</Text>
                        <Button
                            variant="secondary"
                            icon={<Feather name="refresh-cw" size={16} color={palette.charcoal} />}
                            onPress={resetErrorBoundary}
                        >
                            {t.detailRetry}
                        </Button>
                    </View>
                )
            }
            resetKeys={[recipeId]}
        >
            <SettledRecipeEditor key={recipeId} {...props} />
        </QueryBoundary>
    );
}

/** The editor over the settled recipe: the wizard, or the conflict resolver after a 409. */
function SettledRecipeEditor({ recipeId, onSaved, onCancel }: RecipeEditScreenProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    const { conflict } = useMessages(recipeVersionMessages);
    const locale = useLocale();
    const { data: recipe } = useSuspenseQuery(recipeQueries(useRecipeServiceClient()).detail(recipeId));
    const editor = useRecipeEditor(recipe, { onSaved: (saved) => onSaved(saved.id), locale });

    // The discard guard's "unsaved edits" baseline: the seeded draft, re-captured on every successful save
    // (`'saved'`) — see `useDiscardGuard`'s module doc. Declared before the early returns below (Rules of Hooks).
    const isDirty = useDiscardGuard(editor.values, { justSaved: editor.state.status === 'saved' });

    // Auto-save (U34). `enabled` is this screen's "a write would land in an unresolved race" gate: false
    // while a save is in flight (that request already holds the version token) and while a conflict is
    // unresolved (the token is known stale). The
    // write goes through the editor's own `autoSaveDraft`, so it carries `expectedVersion` and a 409 surfaces
    // exactly as a manual save's does. Declared before the early returns below (Rules of Hooks).
    useRecipeAutoSave({
        isDirty,
        enabled: editor.state.status === 'editing',
        // ⛔ `autoSaveDraft`, NOT `saveDraft`: the latter also calls `onSaved`, which this container
        // wires to a navigation — a background timer calling it closes the editor mid-edit. See the hook's
        // own doc for the three concerns an unattended write must not inherit.
        saveDraft: editor.autoSaveDraft,
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

    if (editor.state.status === 'conflict') {
        const { mergeSelections, server, base, diff, versionsBehind, isResolving } = editor.state;

        return (
            <RecipeConflictView
                server={server}
                {...(base === undefined ? {} : { base })}
                diff={diff}
                versionsBehind={versionsBehind}
                isResolving={isResolving}
                selections={mergeSelections}
                onSelectionsChange={editor.resolutions.setMergeSelections}
                onKeepServer={editor.resolutions.keepServer}
                onOverwrite={editor.resolutions.overwrite}
                onMerge={editor.resolutions.merge}
                onDiscardAndClose={editor.discardAndClose}
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
