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
 * ⛔ The URL follows a new recipe without a navigation, because a router navigation would remount the page and reseed
 * the editor mid-typing. It stays on the new route: `?draft=` names the recipe's local ref, and once the server has
 * created it, its server id. The new route, reopened (a reload, Back, Forward), goes to the edit route of a recipe the
 * server holds — named by id, or by a local ref the outbox's journal resolved after the editor had closed — and opens
 * the device draft otherwise (D7). ⛔ The URL is replaced through Next's own shallow-update path
 * (`history.replaceState(null, …)`): passing `history.state` carries Next's `__NA` flag, which makes Next skip its
 * router sync, so it never learned the URL, rewrote it on its next commit, and restored the new-recipe tree under an
 * edit address on Back, where typing created a second recipe. The path never changes, so the tree Next records for the
 * entry is always the tree that renders it.
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
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { isLocalRef, outboxMutatorFor } from '@kitchensink/sync';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FC, type ReactNode } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';
import { EditorStateFrame } from '@/components/recipes/EditorStateFrame';
import { webDeviceStore } from '@/components/recipes/deviceSession';
import { editorDraftsFor } from '@/components/recipes/editorDrafts';
import { opensPasteSheet } from '@/components/recipes/pasteIngredientsHref';
import { IngredientStatusPoller } from '@/components/recipes/IngredientStatusPoller';
import { RecipeLoadError } from '@/components/recipes/RecipeLoadError';
import { RecipePhotoUploaderContainer } from '@/components/recipes/RecipePhotoUploaderContainer';
import { useUserProfile } from '@/hooks/useUserProfile';
import { isRecipeRouteId } from '@/lib/recipeRouteId';
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
        <EditorStateFrame>
            <p role="status" aria-label={recipes.detail.loadingLabel} className="py-8 text-body-md text-ink-muted">
                {recipes.detail.loadingLabel}
            </p>
        </EditorStateFrame>
    );

    if (recipeId === undefined) {
        return (
            <ClientQueryBoundary
                loading={null}
                renderError={({ error, resetErrorBoundary }) => (
                    <EditorStateFrame>
                        <RecipeLoadError error={error} onRetry={resetErrorBoundary} />
                    </EditorStateFrame>
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
            renderError={({ error, resetErrorBoundary }) => (
                <EditorStateFrame>
                    <RecipeLoadError error={error} onRetry={resetErrorBoundary} />
                </EditorStateFrame>
            )}
            resetKeys={[recipeId]}
        >
            <StoredRecipeEditor key={recipeId} locale={locale} detail={detail} opening={opening} />
        </ClientQueryBoundary>
    );
};

/** A new recipe: blank, its device draft when the URL names one, or — when the server holds it — its edit route. */
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

    // ⛔ Keyed by the cook as well as the ref: a switch of cook (Clerk multi-session) must remount the editor, so the
    // previous cook's exit checkpoint runs against THEIR ports before the session scope clears their stores. Suspense
    // keeps a subtree's state, so an unkeyed editor resumed the first cook's draft with the second cook's outbox.
    return (
        <DraftDestination
            key={`${cook.subject}:${draftRef ?? 'new'}`}
            locale={locale}
            cook={cook}
            draftRef={draftRef}
            opening={opening}
            openPaste={openPaste}
        />
    );
};

/** Where a `?draft=` ref leads: the recipe the server holds, or the device draft (a suspense read of the journal). */
const DraftDestination: FC<{
    readonly locale: string;
    readonly cook: { readonly subject: string; readonly drafts: DraftStore };
    readonly draftRef: string | undefined;
    readonly opening: number;
    readonly openPaste: boolean;
}> = ({ locale, cook, draftRef, opening, openPaste }) => {
    const stored = useStoredRecipeOf({ subject: cook.subject, ref: draftRef, opening });

    if (stored !== undefined) {
        return <OpenStoredRecipe locale={locale} recipeId={stored} />;
    }

    return (
        <SeededEditor
            locale={locale}
            mode="create"
            cook={cook}
            draftRef={draftRef !== undefined && isLocalRef(draftRef) ? draftRef : undefined}
            opening={opening}
            openPaste={openPaste}
        />
    );
};

/**
 * The server id a `?draft=` ref names: the ref itself when it is a recipe id, or what the outbox's journal resolved a
 * local ref to (the editor closed before its create answered, and the outbox's observer moved the draft to the id).
 * Read from the journal, not `useSyncQueue().resolutionOf`, which mirrors it only once the provider's own read lands.
 *
 * @sideEffect Reads the outbox journal once per opening of the editor.
 */
function useStoredRecipeOf(read: {
    readonly subject: string;
    readonly ref: string | undefined;
    readonly opening: number;
}): string | undefined {
    const { subject, ref, opening } = read;
    const { data } = useSuspenseQuery({
        queryKey: ['editor', 'draftDestination', subject, ref ?? null, opening],
        // TanStack refuses `undefined` data, so "a new recipe" is `null` here.
        queryFn: async (): Promise<string | null> => {
            if (ref === undefined) {
                return null;
            }

            if (!isLocalRef(ref)) {
                return isRecipeRouteId(ref) ? ref : null;
            }

            const log = await outboxMutatorFor(webDeviceStore, subject)
                .read()
                .catch(() => undefined);

            return log?.resolutions[ref] ?? null;
        },
        // A device read, never paused offline, read fresh for each opening.
        networkMode: 'always',
        staleTime: Number.POSITIVE_INFINITY,
        gcTime: 0,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });

    return data ?? undefined;
}

/** The server holds this recipe: open its edit route in place of the new-recipe entry. @sideEffect Navigates. */
const OpenStoredRecipe: FC<{ readonly locale: string; readonly recipeId: string }> = ({ locale, recipeId }) => {
    const router = useRouter();

    useEffect(() => {
        router.replace(`/${locale}/recipes/${recipeId}/edit${window.location.hash}` as Route);
    }, [router, locale, recipeId]);

    return null;
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

    // Keyed by the cook, for `NewRecipeEditor`'s reason.
    return (
        <SeededEditor
            key={cook.subject}
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

/**
 * Keep a new recipe's URL on the recipe the editor holds — its local ref, then its server id — without a navigation,
 * through Next's own shallow-update path (`null` state, so Next syncs its router to it). Never for a stored recipe: its
 * edit route already names it.
 *
 * ⛔ Only while the URL is still the new route's. Browser Back or a link moves the URL before the editor unmounts, and
 * the exit checkpoint the unmount runs mints the ref (and its create's answer adopts the id) after that: following it
 * then overwrote the URL of the page the cook had gone to.
 *
 * @sideEffect Replaces the history entry.
 */
function replaceUrlFor(locale: string, ref: string): void {
    if (!window.location.pathname.endsWith(`/${locale}/recipes/new`)) {
        return;
    }

    // Relative: only the query changes, so the path (and a preview's base path, ADR-0033) is kept as it is.
    window.history.replaceState(null, '', `?draft=${encodeURIComponent(ref)}${window.location.hash}`);
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
        ...(mode === 'create' ? { onRecipeRef: (ref: string) => replaceUrlFor(locale, ref) } : {}),
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
