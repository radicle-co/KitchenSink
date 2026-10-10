'use client';

/**
 * Orchestration container for the web one-page recipe editor (UI overhaul slice 7; owner decisions D1, D7, D10): one
 * container for `/recipes/new` and `/recipes/{id}/edit`. It reads what the editor is seeded from — the recipe (edit) and
 * the device draft from the tab's session storage, both suspense reads under `ClientQueryBoundary` — then mounts one
 * editor session keyed on the recipe, so editing another recipe is a fresh editor.
 *
 * The session (`useRecipeEditorSession`, shared with the native screen) binds the editor's lifecycle to its ports; this
 * container adds what only the web has: the router behind the session's navigation port (Publish and Save changes → the
 * recipe, Discard → My recipes), the URL that follows the recipe, and the web leaves (the status poller, the photo
 * uploader). What the page draws is `RecipeEditorView`'s.
 *
 * ⛔ The URL follows the recipe without a navigation: a new recipe's local ref is kept in `?draft=` so a reload in the
 * same tab reopens its draft (D7), and once the server has created it the URL becomes its edit address — both through
 * `history.replaceState`, because a router navigation would remount the page and reseed the editor mid-typing.
 *
 * ⚠️ Photos are added once the recipe exists on the server (its first checkpoint, which needs a title): the upload
 * endpoint takes a recipe id, and a picked photo's bytes cannot live in the device draft (ADR-0057).
 *
 * @pattern Mediator — the container wires the session's ports (outbox, drafts, navigation) and the web leaves
 * @pattern Adapter — the Next router behind the session's `EditorNavigation` port
 */
import {
    editorMessages,
    IngredientsNutritionFoot,
    nextEditorOpening,
    pendingIngredientIds,
    PasteListSheet,
    RecipeBasicsFields,
    PasteStepsControl,
    RecipeEditorView,
    RecipePreviewSheet,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeVisibilityField,
    sectionFromHash,
    useDeviceDraft,
    useRecipeEditorSession,
    type DraftStore,
    type EditorNavigation,
    type EditorSectionId,
} from '@commise/features-recipes';
import type { EditorSeed } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useSyncQueue } from '@commise/query/sync';
import { useAuth } from '@clerk/nextjs';
import { canGoPrivate, makeViewer } from '@kitchensink/recipe-core';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FC, type ReactNode } from 'react';

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

/** The signed-in cook and their draft store, or `undefined` while nobody is signed in. */
function useCookDrafts(): { readonly subject: string; readonly drafts: DraftStore } | undefined {
    const { userId } = useAuth();
    const drafts = editorDraftsFor(userId ?? undefined);

    return userId === null || userId === undefined || drafts === undefined ? undefined : { subject: userId, drafts };
}

/** The web recipe editor: new or edit. */
export const RecipeEditorContainer: FC<RecipeEditorContainerProps> = ({ locale, recipeId }) => {
    const { recipes } = useMessages(webMessages);
    const client = useRecipeServiceClient();
    // This opening of the editor, minted OUTSIDE the read boundary: its device-draft read is its own (`useDeviceDraft`).
    const [opening] = useState(nextEditorOpening);
    const loading = (
        <p role="status" aria-label={recipes.detail.loadingLabel} className="px-4 py-8 text-body-md text-ink-muted">
            {recipes.detail.loadingLabel}
        </p>
    );

    if (recipeId === undefined) {
        return (
            <ClientQueryBoundary
                loading={null}
                renderError={({ resetErrorBoundary }) => (
                    <div role="alert">
                        <p>{recipes.detail.errorTitle}</p>
                        <button type="button" onClick={resetErrorBoundary}>
                            {recipes.detail.retry}
                        </button>
                    </div>
                )}
            >
                <NewRecipeEditor locale={locale} opening={opening} />
            </ClientQueryBoundary>
        );
    }

    const detail = recipeQueries(client).detail(recipeId);

    return (
        <ClientQueryBoundary
            loading={loading}
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
            <StoredRecipeEditor key={recipeId} locale={locale} detail={detail} opening={opening} />
        </ClientQueryBoundary>
    );
};

/** A new recipe: blank, or its device draft when the URL names one (a reload in the same tab). */
const NewRecipeEditor: FC<{ readonly locale: string; readonly opening: number }> = ({ locale, opening }) => {
    const cook = useCookDrafts();
    const searchParams = useSearchParams();
    // ⛔ Read ONCE: the editor keeps the URL on its recipe through `history.replaceState`, which Next syncs into
    // `useSearchParams`, and a reactive read would re-key the session and reseed the editor mid-typing.
    const [draftRef] = useState(() => searchParams.get('draft') ?? undefined);
    // Home's first-run Paste ingredients opens the new editor at Ingredients with the paste sheet open (§7.5.4).
    const [openPaste] = useState(() => opensPasteSheet(searchParams));

    if (cook === undefined) {
        return null;
    }

    return (
        <SeededEditor
            key={draftRef ?? 'new'}
            locale={locale}
            mode="create"
            cook={cook}
            draftRef={draftRef}
            opening={opening}
            openPaste={openPaste}
        />
    );
};

/** An existing recipe, once read, with its device draft. */
const StoredRecipeEditor: FC<{
    readonly locale: string;
    readonly detail: ReturnType<ReturnType<typeof recipeQueries>['detail']>;
    readonly opening: number;
}> = ({ locale, detail, opening }) => {
    const cook = useCookDrafts();
    const { data: recipe } = useSuspenseQuery(detail);

    if (cook === undefined) {
        return null;
    }

    return (
        <SeededEditor
            locale={locale}
            mode="edit"
            cook={cook}
            recipe={recipe}
            draftRef={recipe.id}
            opening={opening}
            openPaste={false}
        />
    );
};

/** Props for {@link SeededEditor}. */
interface SeededEditorProps {
    readonly locale: string;
    readonly mode: 'create' | 'edit';
    readonly cook: { readonly subject: string; readonly drafts: DraftStore };
    /** The settled recipe (edit); absent for a new recipe. */
    readonly recipe?: EditorSeed['recipe'];
    /** The ref the device draft is kept under, or `undefined` for a blank new recipe. */
    readonly draftRef: string | undefined;
    readonly opening: number;
    readonly openPaste: boolean;
}

/** The device draft, read (a suspense read under the same boundary), then the session over it. */
const SeededEditor: FC<SeededEditorProps> = ({ recipe, draftRef, opening, cook, ...session }) => {
    const memento = useDeviceDraft({ drafts: cook.drafts, subject: cook.subject, ref: draftRef, opening });
    const seed: EditorSeed = {
        ...(recipe === undefined ? {} : { recipe }),
        ...(memento === undefined ? {} : { memento }),
    };

    return <RecipeEditorSession {...session} drafts={cook.drafts} seed={seed} />;
};

/** Props for {@link RecipeEditorSession}. */
interface RecipeEditorSessionProps {
    readonly locale: string;
    readonly mode: 'create' | 'edit';
    readonly drafts: DraftStore;
    readonly seed: EditorSeed;
    /** Open Paste a list at once (Home's first-run Paste ingredients). */
    readonly openPaste: boolean;
}

/** Keep the URL on the recipe the editor holds, without a navigation. @sideEffect Replaces the history entry. */
function replaceUrlFor(locale: string, ref: string): void {
    const local = ref.startsWith('local:');
    const path = local ? `/${locale}/recipes/new?draft=${encodeURIComponent(ref)}` : `/${locale}/recipes/${ref}/edit`;

    window.history.replaceState(window.history.state, '', `${path}${window.location.hash}`);
}

/** The editor over its seed. */
const RecipeEditorSession: FC<RecipeEditorSessionProps> = ({ locale, mode, drafts, seed, openPaste }) => {
    const router = useRouter();
    const queue = useSyncQueue();
    const profile = useUserProfile();
    const { userId } = useAuth();
    const [initialSection] = useState<EditorSectionId | undefined>(() => sectionFromHash(window.location.hash));
    const viewer = makeViewer({ id: userId ?? undefined, subscriptionTier: profile.data?.account.subscriptionTier });
    // The session's navigation port, on the Next router.
    const navigation: EditorNavigation = {
        finished: (recipeId) => router.push(`/${locale}/recipes/${recipeId}` as Route),
        leftForRecipe: (recipeId) => router.push(`/${locale}/recipes/${recipeId}` as Route),
        discarded: () => router.push(`/${locale}/recipes` as Route),
    };
    const session = useRecipeEditorSession({
        seed,
        locale,
        keep: 'tabSession',
        port: queue,
        drafts,
        navigation,
        onRecipeRef: (ref) => replaceUrlFor(locale, ref),
        openPaste,
    });
    const { editor, paste } = session;
    const { ingredients: ingredientsCopy } = useMessages(editorMessages);

    const sections: Readonly<Record<EditorSectionId, ReactNode>> = {
        details: (
            <RecipeBasicsFields
                values={editor.values}
                errors={editor.errors}
                onChange={editor.setValues}
                onFieldBlur={session.blur}
            />
        ),
        ingredients: (
            <>
                {pendingIngredientIds(editor.values).map((id) => (
                    <IngredientStatusPoller key={id} ingredientId={id} onStatus={session.applyLineStatus} />
                ))}
                <RecipeIngredientsFields
                    values={editor.values}
                    errors={editor.errors}
                    onChange={editor.setValues}
                    nutrition={session.nutrition}
                    lookupRetry={session.lookupRetry}
                    rowEditor={session.rowEditor}
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
                onFieldBlur={session.blur}
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
                guided={session.guided}
                pendingEntryText={session.rowEditor.entry.pendingEntryText}
                sections={sections}
                // §7.2 and §7.5.6: the rail's foot shows the Ingredients total too, from the same draft and read.
                railFooter={<IngredientsNutritionFoot values={editor.values} nutrition={session.nutrition} />}
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
                    steps: <PasteStepsControl onAdd={session.appendSteps} />,
                }}
                {...(initialSection === undefined ? {} : { initialSection })}
                onClose={() => {
                    const id = editor.recipeId;

                    router.push((id === undefined ? `/${locale}/recipes` : `/${locale}/recipes/${id}`) as Route);
                }}
                onPreview={session.preview.show}
                onRefused={session.rowEditor.refused}
                onOpenMyRecipes={() => router.push(`/${locale}/recipes` as Route)}
            />
            <RecipePreviewSheet
                open={session.preview.open}
                recipe={session.preview.recipe}
                onClose={session.preview.hide}
            />
        </>
    );
};
