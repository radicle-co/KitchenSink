/**
 * The native one-page recipe editor screen (UI overhaul slice 7; owner decisions D1, D10): one screen for a new recipe
 * and an existing one. It reads what the editor is seeded from — the recipe and the device draft from AsyncStorage,
 * both suspense reads under `QueryBoundary` — then mounts one editor session keyed on the recipe.
 *
 * The session (`useRecipeEditorSession`, shared with the web container) binds the editor's lifecycle to its ports; this
 * screen adds what only the app has: the navigator behind the session's navigation port (the hand-offs the route wires,
 * and a leave by system Back or the swipe), and the native leaves (the status poller, the photo uploader). What the
 * screen draws is `RecipeEditorView`'s (its native leaf).
 *
 * ⚠️ A new recipe's draft is found again only within the session that made it, or once the server created it (then by
 * its id, from My recipes). A cook who types only ingredients and leaves keeps them on the device but has nothing to
 * reopen them from (blueprint A4, accepted).
 *
 * ⚠️ Photos are added once the recipe exists on the server (its first checkpoint, which needs a title): the upload takes
 * a recipe id, and a picked photo's bytes cannot live in the device draft (ADR-0057).
 *
 * @pattern Mediator — the screen wires the session's ports (outbox, drafts, navigation) and the native leaves
 * @pattern Adapter — the route's hand-offs behind the session's `EditorNavigation` port
 */
import {
    pendingIngredientIds,
    IngredientsNutritionFoot,
    nextEditorOpening,
    RecipeBasicsFields,
    PasteListSheet,
    PasteStepsControl,
    editorMessages,
    RecipeEditorView,
    RecipePreviewSheet,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeVisibilityField,
    useDeviceDraft,
    useRecipeEditorSession,
    type DraftStore,
    type EditorNavigation,
    type EditorSectionId,
} from '@commise/features-recipes';
import type { EditorSeed } from '@commise/features-recipes/hooks';
import { useLocale, useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useSyncQueue } from '@commise/query/sync';
import { Button } from '@commise/ui/button';
import { useAuth } from '@clerk/expo';
import { canGoPrivate, makeViewer, type RecipeDetail } from '@kitchensink/recipe-core';
import { isNotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useState, type JSX, type ReactNode } from 'react';
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

/** The signed-in cook and their draft store, or `undefined` while nobody is signed in. */
function useCookDrafts(): { readonly subject: string; readonly drafts: DraftStore } | undefined {
    const { userId } = useAuth();
    const drafts = editorDraftsFor(userId ?? undefined);

    return userId === null || userId === undefined || drafts === undefined ? undefined : { subject: userId, drafts };
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
    // This opening of the editor, minted OUTSIDE the read boundary: its device-draft read is its own (`useDeviceDraft`).
    const [opening] = useState(nextEditorOpening);

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
            <StoredRecipeEditor key={recipeId} {...props} recipeId={recipeId} opening={opening} />
        </QueryBoundary>
    );
}

/** A new recipe: blank. */
function NewRecipeEditor(props: RecipeEditorScreenProps): JSX.Element | null {
    const cook = useCookDrafts();

    if (cook === undefined) {
        return null;
    }

    // ⛔ Keyed by the cook: a switch of cook must remount the editor, so the previous cook's exit checkpoint runs against
    // THEIR outbox and draft store, and the next cook opens a fresh editor rather than the previous cook's draft.
    return <RecipeEditorSession key={cook.subject} {...props} mode="create" drafts={cook.drafts} seed={{}} />;
}

/** An existing recipe, once read, with its device draft. */
function StoredRecipeEditor(
    props: RecipeEditorScreenProps & { readonly recipeId: string; readonly opening: number },
): JSX.Element | null {
    const cook = useCookDrafts();
    const { data: recipe } = useSuspenseQuery(recipeQueries(useRecipeServiceClient()).detail(props.recipeId));

    // Keyed by the cook, for `NewRecipeEditor`'s reason.
    return cook === undefined ? null : <SeededEditor key={cook.subject} {...props} cook={cook} recipe={recipe} />;
}

/** The device draft, read (a suspense read under the same boundary), then the session over it. */
function SeededEditor({
    cook,
    recipe,
    opening,
    ...props
}: RecipeEditorScreenProps & {
    readonly recipeId: string;
    readonly opening: number;
    readonly cook: { readonly subject: string; readonly drafts: DraftStore };
    readonly recipe: RecipeDetail;
}): JSX.Element {
    const memento = useDeviceDraft({ drafts: cook.drafts, subject: cook.subject, ref: recipe.id, opening });

    return (
        <RecipeEditorSession
            {...props}
            mode="edit"
            drafts={cook.drafts}
            seed={memento === undefined ? { recipe } : { recipe, memento }}
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
    const queue = useSyncQueue();
    const profile = useUserProfile();
    const viewer = makeViewer({ subscriptionTier: profile.data?.account.subscriptionTier });
    // The session's navigation port, on the route's hand-offs: leaving for the recipe goes back where it was opened.
    const navigation: EditorNavigation = {
        finished: onFinished,
        leftForRecipe: () => onClose(),
        discarded: onDiscarded,
        ...(subscribeToLeave === undefined ? {} : { subscribeToLeave }),
    };
    const session = useRecipeEditorSession({
        seed,
        locale,
        keep: 'disk',
        port: queue,
        drafts,
        navigation,
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
                guided={session.guided}
                pendingEntryText={session.rowEditor.entry.pendingEntryText}
                pastePending={paste.pending}
                sections={sections}
                // §7.2 and §7.5.6: a wide tablet's rail foot shows the Ingredients total too, from the same draft and read.
                railFooter={<IngredientsNutritionFoot values={editor.values} nutrition={session.nutrition} />}
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
                {...(section === undefined ? {} : { initialSection: section })}
                onClose={onClose}
                onPreview={session.preview.show}
                onRefused={session.rowEditor.refused}
                onOpenMyRecipes={onDiscarded}
            />
            <RecipePreviewSheet
                open={session.preview.open}
                recipe={session.preview.recipe}
                onClose={session.preview.hide}
            />
        </>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
