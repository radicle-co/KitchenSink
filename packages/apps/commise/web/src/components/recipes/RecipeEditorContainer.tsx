'use client';

/**
 * Orchestration container for the web one-page recipe editor (UI overhaul slice 7; owner decisions D1, D7, D10): one
 * container for `/recipes/new` and `/recipes/{id}/edit`. It reads what the editor is seeded from — the recipe (edit, a
 * suspense read under `ClientQueryBoundary`) and the device draft from the tab's session storage — then mounts one
 * editor session keyed on the recipe, so editing another recipe is a fresh editor.
 *
 * The session binds the platform to the editor's lifecycle (`useRecipeEditor`): the outbox (`useSyncQueue`) as its
 * write port, the draft store, the row editor and its pollers, the nutrition read, the photos, visibility, and the
 * hand-offs (Publish → the recipe, Save changes → the recipe, Discard → My recipes). What the page draws is
 * `RecipeEditorView`'s.
 *
 * ⛔ The URL follows the recipe without a navigation: a new recipe's local ref is kept in `?draft=` so a reload in the
 * same tab reopens its draft (D7), and once the server has created it the URL becomes its edit address — both through
 * `history.replaceState`, because a router navigation would remount the page and reseed the editor mid-typing.
 *
 * ⚠️ Photos are added once the recipe exists on the server (its first checkpoint, which needs a title): the upload
 * endpoint takes a recipe id, and a picked photo's bytes cannot live in the device draft (ADR-0057).
 *
 * @pattern Mediator — the container wires the editor's ports (outbox, drafts, row editor, photos) and its hand-offs
 */
import {
    editorMessages,
    IngredientsNutritionFoot,
    pendingIngredientIds,
    PasteListSheet,
    RecipeBasicsFields,
    PasteStepsControl,
    useIngredientsPaste,
    RecipeEditorView,
    RecipePreviewSheet,
    previewRecipeOf,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeVisibilityField,
    sectionFromHash,
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
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useSyncQueue } from '@commise/query/sync';
import { useAuth } from '@clerk/nextjs';
import { canGoPrivate, makeViewer, type RecipeDetail } from '@kitchensink/recipe-core';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient, useSetRecipeVisibility } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FC, type ReactNode } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { editorDraftsFor } from '@/components/recipes/editorDrafts';
import { opensPasteSheet } from '@/components/recipes/pasteIngredientsHref';
import { IngredientStatusPoller } from '@/components/recipes/IngredientStatusPoller';
import { RecipePhotoUploaderContainer } from '@/components/recipes/RecipePhotoUploaderContainer';
import { useUserProfile } from '@/hooks/useUserProfile';
import { webMessages } from '@/i18n/messages';

/** Props for {@link RecipeEditorContainer}. */
export interface RecipeEditorContainerProps {
    /** The active route locale, for locale-prefixed navigation. */
    readonly locale: string;
    /** The recipe to edit; absent for a new recipe. */
    readonly recipeId?: string;
}

/** The device draft for a ref, read once: `undefined` while it loads. */
type DraftSeedState = { readonly status: 'loading' } | { readonly status: 'ready'; readonly memento?: DraftMemento };

/**
 * Read a recipe's device draft once.
 *
 * @param drafts - The cook's draft store, once signed in.
 * @param ref - The recipe's ref, or `undefined` for a blank new recipe.
 * @returns The read's state. @sideEffect Reads the tab's session storage.
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

/** The web recipe editor: new or edit. */
export const RecipeEditorContainer: FC<RecipeEditorContainerProps> = ({ locale, recipeId }) => {
    const { recipes } = useMessages(webMessages);
    const client = useRecipeServiceClient();

    if (recipeId === undefined) {
        return <NewRecipeEditor locale={locale} />;
    }

    const detail = recipeQueries(client).detail(recipeId);

    return (
        <ClientQueryBoundary
            loading={
                <p
                    role="status"
                    aria-label={recipes.detail.loadingLabel}
                    className="px-4 py-8 text-body-md text-ink-muted"
                >
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
            <StoredRecipeEditor key={recipeId} locale={locale} recipeId={recipeId} detail={detail} />
        </ClientQueryBoundary>
    );
};

/** A new recipe: blank, or its device draft when the URL names one (a reload in the same tab). */
const NewRecipeEditor: FC<{ readonly locale: string }> = ({ locale }) => {
    const { userId } = useAuth();
    const drafts = editorDraftsFor(userId ?? undefined);
    const searchParams = useSearchParams();
    // ⛔ Read ONCE: the editor keeps the URL on its recipe through `history.replaceState`, which Next syncs into
    // `useSearchParams`, and a reactive read would re-key the session and reseed the editor mid-typing.
    const [draftRef] = useState(() => searchParams.get('draft') ?? undefined);
    // Home's first-run Paste ingredients opens the new editor at Ingredients with the paste sheet open (§7.5.4).
    const [openPaste] = useState(() => opensPasteSheet(searchParams));
    const seed = useDraftSeed(drafts, draftRef);

    if (seed.status === 'loading' || drafts === undefined) {
        return null;
    }

    return (
        <RecipeEditorSession
            key={draftRef ?? 'new'}
            locale={locale}
            mode="create"
            drafts={drafts}
            seed={seed.memento === undefined ? {} : { memento: seed.memento }}
            openPaste={openPaste}
        />
    );
};

/** An existing recipe, once read, with its device draft. */
const StoredRecipeEditor: FC<{
    readonly locale: string;
    readonly recipeId: string;
    readonly detail: ReturnType<ReturnType<typeof recipeQueries>['detail']>;
}> = ({ locale, recipeId, detail }) => {
    const { userId } = useAuth();
    const drafts = editorDraftsFor(userId ?? undefined);
    const { data: recipe } = useSuspenseQuery(detail);
    const seed = useDraftSeed(drafts, recipeId);

    if (seed.status === 'loading' || drafts === undefined) {
        return null;
    }

    return (
        <RecipeEditorSession
            locale={locale}
            mode="edit"
            drafts={drafts}
            seed={seed.memento === undefined ? { recipe } : { recipe, memento: seed.memento }}
        />
    );
};

/** Props for {@link RecipeEditorSession}. */
interface RecipeEditorSessionProps {
    readonly locale: string;
    readonly mode: 'create' | 'edit';
    readonly drafts: DraftStore;
    readonly seed: EditorSeed;
    /** Open Paste a list at once (Home's first-run Paste ingredients). */
    readonly openPaste?: boolean;
}

/** Keep the URL on the recipe the editor holds, without a navigation. @sideEffect Replaces the history entry. */
function replaceUrlFor(locale: string, ref: string): void {
    const local = ref.startsWith('local:');
    const path = local ? `/${locale}/recipes/new?draft=${encodeURIComponent(ref)}` : `/${locale}/recipes/${ref}/edit`;

    window.history.replaceState(window.history.state, '', `${path}${window.location.hash}`);
}

/** The editor over its seed. */
const RecipeEditorSession: FC<RecipeEditorSessionProps> = ({ locale, mode, drafts, seed, openPaste = false }) => {
    const router = useRouter();
    const client = useRecipeServiceClient();
    const queue = useSyncQueue();
    const profile = useUserProfile();
    const setVisibility = useSetRecipeVisibility();
    const { userId } = useAuth();
    const [initialSection] = useState<EditorSectionId | undefined>(() => sectionFromHash(window.location.hash));
    const [previewing, setPreviewing] = useState(false);
    const guided = useLibraryEmpty(recipeQueries(client).library({ sortBy: 'updatedAt' }).queryKey);
    const viewer = makeViewer({ id: userId ?? undefined, subscriptionTier: profile.data?.account.subscriptionTier });

    /** Published, or its changes saved: visibility follows (`visibilityFollowUp`), then the recipe opens. @sideEffect */
    const finished = (stored: RecipeDetail): void => {
        const visibility = visibilityFollowUp(editor.values.visibility, stored);

        if (visibility !== undefined) {
            setVisibility.mutate({ id: stored.id, visibility });
        }

        router.push(`/${locale}/recipes/${stored.id}` as Route);
    };

    const onExit = (exit: EditorExit): void => {
        switch (exit.kind) {
            case 'published':
            case 'changesSaved':
                finished(exit.recipe);

                return;

            case 'leftForRecipe':
                router.push(`/${locale}/recipes/${exit.recipeId}` as Route);

                return;

            case 'discarded':
                router.push(`/${locale}/recipes` as Route);

                return;

            default: {
                const unreachable: never = exit;

                return unreachable;
            }
        }
    };

    const editor = useRecipeEditor(seed, {
        locale,
        port: queue,
        drafts,
        keep: 'tabSession',
        onExit,
        onRecipeRef: (ref) => replaceUrlFor(locale, ref),
    });

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
    const { pendingEntryText } = rowEditor.entry;
    const { ingredients: ingredientsCopy } = useMessages(editorMessages);
    // Paste a list (§7.5.4): offered only while the recipe has no server row (D10).
    const paste = useIngredientsPaste({
        stored: editor.recipeId !== undefined,
        dispatch: editor.dispatch,
        lineCount: editor.values.ingredients.length,
        initiallyOpen: openPaste,
    });
    const blur = (): void => editor.checkpoint('fieldBlur');

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
                {editor.recipeId === undefined ? null : <RecipePhotoUploaderContainer recipeId={editor.recipeId} />}
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
                keep="tabSession"
                guided={guided}
                pendingEntryText={pendingEntryText}
                sections={sections}
                // §7.2 and §7.5.6: the rail's foot shows the Ingredients total too, from the same draft and read.
                railFooter={<IngredientsNutritionFoot values={editor.values} nutrition={nutrition} />}
                pastePending={paste.pending}
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
                {...(initialSection === undefined ? {} : { initialSection })}
                onClose={() => {
                    const id = editor.recipeId;

                    router.push((id === undefined ? `/${locale}/recipes` : `/${locale}/recipes/${id}`) as Route);
                }}
                onPreview={() => setPreviewing(true)}
                onRefused={rowEditor.refused}
                onOpenMyRecipes={() => router.push(`/${locale}/recipes` as Route)}
            />
            <RecipePreviewSheet
                open={previewing}
                recipe={previewRecipeOf({ values: editor.values, recipe: seed.recipe, now: new Date().toISOString() })}
                onClose={() => setPreviewing(false)}
            />
        </>
    );
};
