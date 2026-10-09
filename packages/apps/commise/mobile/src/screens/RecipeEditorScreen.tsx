/**
 * The native one-page recipe editor screen (UI overhaul slice 7; owner decisions D1, D10): one screen for a new recipe
 * and an existing one. It reads what the editor is seeded from — the recipe (a suspense read under `QueryBoundary`)
 * and the device draft from AsyncStorage — then mounts one editor session keyed on the recipe.
 *
 * The session binds the platform to the editor's lifecycle (`useRecipeEditor`): the outbox (`useSyncQueue`) as its
 * write port, the draft store, the row editor and its pollers, the nutrition read, the photos, visibility, and the
 * hand-offs the navigator wires. What the screen draws is `RecipeEditorView`'s (its native leaf).
 *
 * ⚠️ A new recipe's draft is found again only within the session that made it, or once the server created it (then by
 * its id, from My recipes). A cook who types only ingredients and leaves keeps them on the device but has nothing to
 * reopen them from (blueprint A4, accepted).
 *
 * ⚠️ Photos are added once the recipe exists on the server (its first checkpoint, which needs a title): the upload takes
 * a recipe id, and a picked photo's bytes cannot live in the device draft (ADR-0057).
 *
 * @pattern Mediator — the screen wires the editor's ports (outbox, drafts, row editor, photos) and its hand-offs
 */
import {
    pendingIngredientIds,
    IngredientsNutritionFoot,
    RecipeBasicsFields,
    PasteListSheet,
    PasteStepsControl,
    editorMessages,
    useIngredientsPaste,
    RecipeEditorView,
    RecipePreviewSheet,
    previewRecipeOf,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeVisibilityField,
    visibilityFollowUp,
    type DraftMemento,
    type DraftStore,
    type EditorSectionId,
    type ObservedIngredientStatus,
    type SettledAnswer,
} from '@commise/features-recipes';
import {
    useIngredientRowEditor,
    useLibraryEmpty,
    useLineNutrition,
    useLookupRetry,
    useRecipeEditor,
    type EditorExit,
    type EditorSeed,
} from '@commise/features-recipes/hooks';
import { useLocale, useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useSyncQueue } from '@commise/query/sync';
import { Button } from '@commise/ui/button';
import { useAuth } from '@clerk/expo';
import { canGoPrivate, makeViewer, type RecipeDetail } from '@kitchensink/recipe-core';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient, useSetRecipeVisibility } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useEffectEvent, useState, type JSX, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IngredientStatusPoller } from '../components/IngredientStatusPoller.js';
import { LoadingState } from '../components/LoadingState.js';
import { RecipePhotoUploader } from '../components/RecipePhotoUploader.js';
import { useUserProfile } from '../hooks/useUserProfile.js';
import { mobileMessages } from '../i18n/messages.js';
import { editorDraftsFor } from '../storage/editorDrafts.js';

/** Where the editor hands off: the navigator decides what each means. */
export interface RecipeEditorScreenProps {
    /** The recipe to edit; absent for a new recipe. */
    readonly recipeId?: string;
    /** The section a deep link names (route param, blueprint A16). */
    readonly section?: EditorSectionId;
    /** Open Paste a list at once: Home's first-run Paste ingredients (build spec §7.5.4). A new recipe only. */
    readonly openPaste?: boolean;
    /** The recipe was published, or its changes saved: show it. */
    readonly onFinished: (recipeId: string) => void;
    /** × , or the cook kept the server's copy: go back where the editor was opened. */
    readonly onClose: () => void;
    /** A never-published recipe was discarded: go to My recipes. */
    readonly onDiscarded: () => void;
    /**
     * Hear the screen being left by any route, not only × (system Back, the swipe): the route wires it to React
     * Navigation's `beforeRemove`. Returns the unsubscribe. Each leave runs the exit checkpoint, which does nothing once
     * the editor has handed off.
     */
    readonly subscribeToLeave?: (listener: () => void) => () => void;
}

/** The device draft for a ref, read once. */
type DraftSeedState = { readonly status: 'loading' } | { readonly status: 'ready'; readonly memento?: DraftMemento };

/**
 * Read a recipe's device draft once.
 *
 * @param drafts - The cook's draft store, once signed in.
 * @param ref - The recipe's ref, or `undefined` for a blank new recipe.
 * @returns The read's state. @sideEffect Reads AsyncStorage.
 */
function useDraftSeed(drafts: DraftStore | undefined, ref: string | undefined): DraftSeedState {
    const [state, setState] = useState<DraftSeedState>(ref === undefined ? { status: 'ready' } : { status: 'loading' });

    useEffect(() => {
        if (ref === undefined || drafts === undefined) {
            return undefined;
        }

        let live = true;

        void drafts.load(ref).then(
            (memento) => {
                if (live) {
                    setState(memento === undefined ? { status: 'ready' } : { status: 'ready', memento });
                }
            },
            // An unreadable draft opens the editor from the server's copy; the store has quarantined the bytes.
            () => {
                if (live) {
                    setState({ status: 'ready' });
                }
            },
        );

        return () => {
            live = false;
        };
    }, [drafts, ref]);

    return state;
}

/**
 * The recipe editor screen.
 *
 * @param props - The recipe (absent for a new one), a deep link's section, and the hand-offs.
 * @returns The editor, or the read boundary around it.
 */
export function RecipeEditorScreen(props: RecipeEditorScreenProps): JSX.Element {
    const { recipeId } = props;
    const { recipes: t } = useMessages(mobileMessages);

    if (recipeId === undefined) {
        return <NewRecipeEditor {...props} />;
    }

    return (
        <QueryBoundary
            loading={<LoadingState label={t.detailLoading} />}
            renderError={({ error, resetErrorBoundary }) => (
                <View style={styles.center}>
                    <Text role="alert">{isNotFoundError(error) ? t.detailNotFound : t.detailError}</Text>
                    {isNotFoundError(error) ? null : (
                        <Button variant="secondary" icon="refreshCw" onPress={resetErrorBoundary}>
                            {t.detailRetry}
                        </Button>
                    )}
                </View>
            )}
            resetKeys={[recipeId]}
        >
            <StoredRecipeEditor key={recipeId} {...props} recipeId={recipeId} />
        </QueryBoundary>
    );
}

/** A new recipe: blank. */
function NewRecipeEditor(props: RecipeEditorScreenProps): JSX.Element | null {
    const { userId } = useAuth();
    const drafts = editorDraftsFor(userId ?? undefined);

    if (drafts === undefined) {
        return null;
    }

    return <RecipeEditorSession {...props} mode="create" drafts={drafts} seed={{}} />;
}

/** An existing recipe, once read, with its device draft. */
function StoredRecipeEditor(props: RecipeEditorScreenProps & { readonly recipeId: string }): JSX.Element | null {
    const { userId } = useAuth();
    const drafts = editorDraftsFor(userId ?? undefined);
    const { data: recipe } = useSuspenseQuery(recipeQueries(useRecipeServiceClient()).detail(props.recipeId));
    const seed = useDraftSeed(drafts, props.recipeId);

    if (seed.status === 'loading' || drafts === undefined) {
        return null;
    }

    return (
        <RecipeEditorSession
            {...props}
            mode="edit"
            drafts={drafts}
            seed={seed.memento === undefined ? { recipe } : { recipe, memento: seed.memento }}
        />
    );
}

/** The editor over its seed. */
function RecipeEditorSession({
    section,
    openPaste = false,
    onFinished,
    onClose,
    onDiscarded,
    subscribeToLeave,
    mode,
    drafts,
    seed,
}: RecipeEditorScreenProps & {
    readonly mode: 'create' | 'edit';
    readonly drafts: DraftStore;
    readonly seed: EditorSeed;
}): JSX.Element {
    const locale = useLocale();
    const client = useRecipeServiceClient();
    const queue = useSyncQueue();
    const profile = useUserProfile();
    const setVisibility = useSetRecipeVisibility();
    const guided = useLibraryEmpty(recipeQueries(client).library({ sortBy: 'updatedAt' }).queryKey);
    const viewer = makeViewer({ subscriptionTier: profile.data?.account.subscriptionTier });
    const [previewing, setPreviewing] = useState(false);

    /** Published, or its changes saved: visibility follows (`visibilityFollowUp`), then the recipe shows. @sideEffect */
    const finished = (stored: RecipeDetail): void => {
        const visibility = visibilityFollowUp(editor.values.visibility, stored);

        if (visibility !== undefined) {
            setVisibility.mutate({ id: stored.id, visibility });
        }

        onFinished(stored.id);
    };

    const onExit = (exit: EditorExit): void => {
        switch (exit.kind) {
            case 'published':
            case 'changesSaved':
                finished(exit.recipe);

                return;

            case 'leftForRecipe':
                onClose();

                return;

            case 'discarded':
                onDiscarded();

                return;

            default: {
                const unreachable: never = exit;

                return unreachable;
            }
        }
    };

    const editor = useRecipeEditor(seed, { locale, port: queue, drafts, keep: 'disk', onExit });

    // System Back and the swipe do what × does (build spec §3.5): the exit checkpoint. × runs its own first, and the
    // second is refused while that write is on the wire, or finds nothing changed.
    const onLeave = useEffectEvent((): void => editor.checkpoint('editorExit'));
    useEffect(() => subscribeToLeave?.(() => onLeave()), [subscribeToLeave]);

    // Poll and retry answers land after a network call, so both go through `editor.dispatch`, which meets the draft as
    // it is then.
    const { dispatch } = editor;
    const applyLineStatus = useCallback(
        (polledId: string, observed: ObservedIngredientStatus): void => {
            dispatch({ kind: 'settleIngredientLines', answers: [{ polledId, observed }] });
        },
        [dispatch],
    );
    const applyLineStatuses = useCallback(
        (answers: readonly SettledAnswer[]): void => {
            dispatch({ kind: 'settleIngredientLines', answers });
        },
        [dispatch],
    );
    const lookupRetry = useLookupRetry(applyLineStatuses);
    const nutrition = useLineNutrition(editor.values);
    // A stored line moves through the editor's rebind command (ADR-0045); any other is a draft transition. Before the
    // server create nothing is stored, so the surface is the create form's.
    const rowEditor = useIngredientRowEditor({
        surface:
            editor.recipeId === undefined
                ? { kind: 'createForm', dispatch: editor.dispatch }
                : { kind: 'editForm', dispatch: editor.dispatch, command: editor.lineCommand },
        lines: editor.values.ingredients,
    });
    const blur = (): void => editor.checkpoint('fieldBlur');
    const { ingredients: ingredientsCopy } = useMessages(editorMessages);
    // Paste a list (§7.5.4): offered only while the recipe has no server row (D10).
    const paste = useIngredientsPaste({
        stored: editor.recipeId !== undefined,
        dispatch: editor.dispatch,
        lineCount: editor.values.ingredients.length,
        initiallyOpen: openPaste,
    });

    const sections: Readonly<Record<EditorSectionId, ReactNode>> = {
        details: (
            <RecipeBasicsFields
                values={editor.values}
                errors={editor.errors}
                onChange={editor.setValues}
                onFieldBlur={blur}
            />
        ),
        ingredients: (
            <>
                {pendingIngredientIds(editor.values).map((id) => (
                    <IngredientStatusPoller key={id} ingredientId={id} onStatus={applyLineStatus} />
                ))}
                <RecipeIngredientsFields
                    values={editor.values}
                    errors={editor.errors}
                    onChange={editor.setValues}
                    nutrition={nutrition}
                    lookupRetry={lookupRetry}
                    rowEditor={rowEditor}
                    paste={paste.view}
                />
                <PasteListSheet sheet={paste.sheet} submitting={paste.submitting} failed={paste.failed} />
            </>
        ),
        steps: (
            <RecipeInstructionsFields
                values={editor.values}
                errors={editor.errors}
                onChange={editor.setValues}
                onFieldBlur={blur}
            />
        ),
        photos: (
            <>
                {editor.recipeId === undefined ? null : <RecipePhotoUploader recipeId={editor.recipeId} />}
                <RecipeVisibilityField
                    values={editor.values}
                    onChange={editor.setValues}
                    canGoPrivate={canGoPrivate(viewer)}
                />
            </>
        ),
    };

    return (
        <>
            <RecipeEditorView
                editor={editor}
                mode={mode}
                keep="disk"
                guided={guided}
                pendingEntryText={rowEditor.entry.pendingEntryText}
                pastePending={paste.pending}
                sections={sections}
                // §7.2 and §7.5.6: a wide tablet's rail foot shows the Ingredients total too, from the same draft and read.
                railFooter={<IngredientsNutritionFoot values={editor.values} nutrition={nutrition} />}
                headingActions={{
                    ...(paste.inHeading
                        ? {
                              ingredients: (
                                  <Button variant="ghost" icon="clipboardPaste" onPress={paste.open}>
                                      {ingredientsCopy.pasteList}
                                  </Button>
                              ),
                          }
                        : {}),
                    steps: (
                        <PasteStepsControl
                            onAdd={(instructions) => editor.dispatch({ kind: 'appendSteps', instructions })}
                        />
                    ),
                }}
                {...(section === undefined ? {} : { initialSection: section })}
                onClose={onClose}
                onPreview={() => setPreviewing(true)}
                onRefused={rowEditor.refused}
                onOpenMyRecipes={onDiscarded}
            />
            <RecipePreviewSheet
                open={previewing}
                recipe={previewRecipeOf({ values: editor.values, recipe: seed.recipe, now: new Date().toISOString() })}
                onClose={() => setPreviewing(false)}
            />
        </>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
