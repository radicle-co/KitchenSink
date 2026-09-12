'use client';

/**
 * Orchestration container for the recipe-edit route: a suspense read of the recipe under `ClientQueryBoundary`, whose
 * settled branch is the editor. The boundary owns loading and the load failure (a 404 offers no retry, anything else
 * retries); the settled editor is keyed on the recipe id, so editing another recipe is a fresh editor seeded from it,
 * and a failed background refetch never reaches the boundary, so the wizard and the draft stay. The route is not
 * server-prefetched, so the boundary takes no prefetched keys. ⛔ Nothing under the boundary may suspend without its
 * own nested `<Suspense>` (nothing does today: the photo uploader reads through `useQuery`, and the calorie figures are
 * derived from the draft): React hides a re-suspended subtree, and the cook would watch the form vanish.
 *
 * History (CP-6/P1: rewired onto the shared `useRecipeEditor`
 * headless hook, `@commise/features-recipes/hooks`; w3/e1,e2: rewired again onto the 4-step `Wizard`
 * shell). The hook owns
 * the whole edit lifecycle — the mount-time seed, validation, submit-with-`expectedVersion`, the 409-to-conflict
 * transition, the three FR-007c resolutions, AND (w3) the step/draft/publish extensions — as a
 * discriminated-union statechart (`EditorState`) plus orthogonal step-navigation state; this container is a
 * thin renderer that switches on `state.status` and, once past loading/conflict, wires the `Wizard` compound
 * shell — `Wizard.Header`/`Wizard.Rail` plus one `Wizard.Step` per step, each hosting the SAME extracted
 * `RecipeBasicsFields`/`RecipeIngredientsFields`/`RecipeInstructionsFields`/`RecipeVisibilityField`/
 * `RecipeReviewFields` leaves (`@commise/features-recipes`) — no field is duplicated or rewritten. The
 * app-owned {@link IngredientPicker} composes into step 2. See the hook's module doc for the full statechart
 * and the reseed-incompatibility fix it resolves (web previously reseeded in place; mobile previously
 * remounted via a `seedNonce`/`seedOverride` hack — both platforms now seed once from the settled read and edit
 * through the SAME `setValues` transition).
 *
 * ⛔ **`Wizard.Controls` is NOT placed here (U32).** `Wizard.Header` renders the action bar itself, because
 * on web the bar's POSITION is what the `lg` breakpoint changes — `fixed` to the viewport bottom below it,
 * `static` inside the header band above it — and one element that moves is the only shape with ONE
 * accessible name per control. Placing it here as well would ship two bars.
 *
 * ⛔ **Photos are on step 1 now, not step 4 (U33).** {@link RecipePhotoUploaderContainer} composes into
 * Details beside the other fields, and step 4 is the read-only `RecipeReviewFields`. On this route the
 * recipe always has an id, so the uploader is live from the first render; the create route reaches the same
 * surface through the draft-photo seam (`useRecipeDraftPhotos`).
 *
 * ⚠️ **Auto-save (U34) is wired here, and its `enabled` gate is this container's judgement.** It is `false`
 * whenever an unattended write would land in an unresolved race: while a save is in flight (that request
 * already holds the version token) and while a conflict is unresolved (the token is known stale). The write goes through the editor's `autoSaveDraft` — NOT its
 * `saveDraft`, which also calls `onSaved`, which this container wires to a NAVIGATION. A background timer
 * calling that would close the editor two seconds after the cook stopped typing. It still carries
 * `expectedVersion`, and a 409 surfaces exactly as a manual save's does.
 *
 * **OQ-1 resolve→detail navigation (W7 Task 6).** A successful `overwrite`/`merge` resolves through the SAME
 * `submitDraft` → `onSuccess` → `opts.onSaved` path a plain save uses, so it lands on the SAME
 * `router.push(detailRoute)` this container already wires for `onSaved` — no separate branch needed. Choosing
 * `keepServer` (Option A) is different: it is a discard, not a write, so `useRecipeEditor` never calls
 * `onSaved` for it — it transitions to the DISTINCT `status: 'discarded'` terminal instead. This container
 * watches for that transition in its own `useEffect` and navigates to the SAME `detailRoute`, but WITHOUT any
 * "Saved!" success affordance (there is none to suppress today — the point is that a future one must key off
 * `status: 'saved'`, never fire for a discard).
 *
 * **"Discard and close" (wireframe gap #1) reuses this SAME wiring.** `editor.discardAndClose` (the header
 * exit `RecipeConflictView` now renders) also lands on `status: 'discarded'` — it needs no separate `useEffect`
 * branch here, since it is indistinguishable from `keepServer`'s own discard from this container's point of
 * view (no write, navigate to the recipe, no "Saved!"). Unlike `keepServer`, it stays callable even while a
 * resolve is in flight — see `useRecipeEditor`'s own doc for the epoch-guard that neutralizes a late resolve.
 *
 * @pattern Adapter — binds the `useRecipeEditor` statechart to the `Wizard` compound shell, under a read boundary
 *     whose settled view is keyed on the recipe id.
 */
import {
    applyDraftAction,
    pendingIngredientIds,
    RecipeBasicsFields,
    RecipeConflictView,
    recipeVersionMessages,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeReviewFields,
    RecipeVisibilityField,
    setIngredientStatusById,
    useDiscardGuard,
    Wizard,
    type ResolvedRecipeFormIngredient,
} from '@commise/features-recipes';
import { useRecipeAutoSave, useRecipeEditor } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import type { FoodResolutionStatus } from '@kitchensink/recipe-core';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import type { FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { IngredientPicker, type IngredientPickerHandle } from '@/components/recipes/IngredientPicker';
import { IngredientStatusPoller } from '@/components/recipes/IngredientStatusPoller';
import { RecipePhotoUploaderContainer } from '@/components/recipes/RecipePhotoUploaderContainer';
import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeEditContainer}. */
export interface RecipeEditContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
    /** The recipe id from the `[id]` route segment. */
    readonly recipeId: string;
}

/**
 * The live recipe-edit container.
 *
 * @param props - The active locale and the recipe id to edit.
 * @returns The read boundary around the settled editor.
 */
export const RecipeEditContainer: FC<RecipeEditContainerProps> = ({ locale, recipeId }) => {
    const { recipes } = useMessages(webMessages);
    const detail = recipeQueries(useRecipeServiceClient()).detail(recipeId);

    return (
        <ClientQueryBoundary
            loading={
                <p role="status" aria-label={recipes.detail.loadingLabel} className="px-4 py-8 text-body-md text-slate">
                    {recipes.detail.loadingLabel}
                </p>
            }
            renderError={({ error, resetErrorBoundary }) => {
                // A 404 is final, so it offers no retry; anything else is the generic failure, whose retry refetches.
                const notFound = isNotFoundError(error);

                return (
                    <div role="alert">
                        <p>{notFound ? recipes.detail.notFoundTitle : recipes.detail.errorTitle}</p>
                        {!notFound && (
                            <button type="button" onClick={resetErrorBoundary}>
                                {recipes.detail.retry}
                            </button>
                        )}
                    </div>
                );
            }}
            resetKeys={[recipeId]}
        >
            <SettledRecipeEditor key={recipeId} locale={locale} recipeId={recipeId} detail={detail} />
        </ClientQueryBoundary>
    );
};

/** Props for {@link SettledRecipeEditor}. */
interface SettledRecipeEditorProps extends RecipeEditContainerProps {
    readonly detail: ReturnType<ReturnType<typeof recipeQueries>['detail']>;
}

/** The editor over the settled recipe: the wizard, or the conflict resolver after a 409. */
const SettledRecipeEditor: FC<SettledRecipeEditorProps> = ({ locale, recipeId, detail }) => {
    const router = useRouter();
    const { recipes } = useMessages(webMessages);
    const { conflict } = useMessages(recipeVersionMessages);
    const detailRoute = `/${locale}/recipes/${recipeId}` as Route;
    const { data: recipe } = useSuspenseQuery(detail);
    const editor = useRecipeEditor(recipe, { onSaved: () => router.push(detailRoute), locale });

    // `editor.setValues` takes the next full value (no functional-updater form, unlike `useState`'s setter), so
    // this callback must close over `editor.values` and is only as stable as the draft itself — it still avoids
    // rebuilding an identical function on every unrelated re-render (e.g. `submitting`/conflict-selection churn).
    // Declared before the early returns below (Rules of Hooks: no conditional hook calls).
    const { setValues: setEditorValues, values: editorValues } = editor;
    const applyLineStatus = useCallback(
        (ingredientId: string, status: FoodResolutionStatus): void => {
            setEditorValues(setIngredientStatusById(editorValues, ingredientId, status));
        },
        [setEditorValues, editorValues],
    );

    // U28 — where "+ Add ingredient" LEADS. The leaf raises a request; this container owns the picker, so
    // it is the only layer that can answer. See `IngredientPickerHandle` for why this is a method rather than
    // a signal prop, and why a ref is permitted here at all. Declared before the early returns below, for the
    // same Rules-of-Hooks reason as its two neighbours.
    const pickerRef = useRef<IngredientPickerHandle>(null);

    // The discard guard's "unsaved edits" baseline: the seeded draft, re-captured on every successful save
    // (`'saved'`) — see `useDiscardGuard`'s module doc. Also declared before the early returns (Rules of Hooks).
    const isDirty = useDiscardGuard(editor.values, { justSaved: editor.state.status === 'saved' });

    // Auto-save (U34). `enabled` is the container's "a write would land in an unresolved race" gate — see
    // this module's own doc for the three cases it covers. Declared before the early returns (Rules of
    // Hooks), which is also why it reads `editor.state.status` rather than being placed after them.
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
    // terminal instead (see `useRecipeEditor`'s module doc). This effect is the container's own reaction to
    // that terminal: navigate to the SAME `detailRoute` a save's `onSaved` uses, but with no "Saved!"
    // affordance (a discard never wrote anything). Keyed on the `status` STRING (not the `EditorState` object,
    // which is a fresh reference every render) so it fires exactly once per transition into `'discarded'`,
    // never on every subsequent re-render while the route change is still in flight.
    useEffect(() => {
        if (editor.state.status === 'discarded') {
            router.push(detailRoute);
        }
    }, [editor.state.status, router, detailRoute]);

    // U28 — the ONE pure append transition (`appendResolvedIngredient`), never an inline spread. Three
    // containers used to re-implement this by hand, which is how U27's section-inheritance rule ended up on
    // the dead "+ Add ingredient" path and MISSING from the picker path a cook actually completes.
    //
    // ⛔ `line` is a `ResolvedRecipeFormIngredient`, so there is no null check here and none is possible:
    // the picker cannot hand up a foodless line.
    const addIngredient = (line: ResolvedRecipeFormIngredient): void => {
        editor.setValues(applyDraftAction(editor.values, { kind: 'appendResolvedIngredient', line }));
    };

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
        <div>
            <Wizard
                mode="edit"
                step={editor.step}
                values={editor.values}
                canAdvanceFrom={editor.canAdvanceFrom}
                stepErrors={editor.stepErrors}
                goNext={editor.goNext}
                goPrev={editor.goPrev}
                goToStep={editor.goToStep}
                saveDraft={editor.saveDraft}
                publish={editor.publish}
                onCancel={() => router.push(detailRoute)}
                isDirty={isDirty}
                submitting={editor.state.status === 'submitting'}
            >
                <Wizard.Header />
                <Wizard.Rail />
                <Wizard.Step step={1}>
                    <RecipeBasicsFields values={editor.values} errors={editor.errors} onChange={editor.setValues} />
                    <RecipeVisibilityField values={editor.values} onChange={editor.setValues} />
                    <RecipePhotoUploaderContainer recipeId={recipeId} />
                </Wizard.Step>
                <Wizard.Step step={2}>
                    <IngredientPicker ref={pickerRef} onSelect={addIngredient} />
                    {pendingIngredientIds(editor.values).map((id) => (
                        <IngredientStatusPoller key={id} ingredientId={id} onStatus={applyLineStatus} />
                    ))}
                    <RecipeIngredientsFields
                        values={editor.values}
                        errors={editor.errors}
                        onChange={editor.setValues}
                        onRequestAddIngredient={() => pickerRef.current?.focusSearch()}
                    />
                </Wizard.Step>
                <Wizard.Step step={3}>
                    <RecipeInstructionsFields
                        values={editor.values}
                        errors={editor.errors}
                        onChange={editor.setValues}
                    />
                </Wizard.Step>
                <Wizard.Step step={4}>
                    <RecipeReviewFields values={editor.values} />
                </Wizard.Step>
            </Wizard>
            {editor.submitError && <p role="alert">{recipes.form.submitError}</p>}
            {editor.conflictDataUnavailable && <p role="alert">{conflict.dataUnavailable}</p>}
        </div>
    );
};
