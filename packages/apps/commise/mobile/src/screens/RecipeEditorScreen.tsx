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
 * Photos can be added on a new recipe too: a pick waits in the editor's photo session until the first checkpoint (which
 * needs a title) gives the recipe an id. Its bytes cannot live in the device draft (ADR-0057), so the route's leave guard
 * asks before a leave would lose one (`renderLeaveGuard`), and the finish waits for them (`useEditorPhotos`).
 *
 * @pattern Mediator — the screen wires the session's ports (outbox, drafts, navigation) and the native leaves
 * @pattern Adapter — the route's hand-offs behind the session's `EditorNavigation` port
 */
import {
    arrivalOf,
    nextEditorOpening,
    useDeviceDraft,
    useRecipeEditorSession,
    useRecipePrivate,
    type DraftStore,
    type EditorNavigation,
    type EditorSectionId,
    type EditorFinish,
    type LineAddress,
} from '@commise/features-recipes';
import { recipeActionMessages, recipeMessages } from '@commise/features-recipes';
import { recipeLoadMessages, RecipeLoadError } from '@commise/features-recipes/detail';
import { cookDraftsOf, RecipeEditorSurface, type CookDrafts } from '@commise/features-recipes/editor';
import type { EditorSeed } from '@commise/features-recipes/hooks';
import { useLocale, useMessages } from '@commise/i18n/react';
import { QueryBoundary } from '@commise/query/boundary';
import { useSyncQueue } from '@commise/query/sync';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { useAuth } from '@clerk/expo';
import { knownPaidFeaturesOf, paidFeatureStateOf } from '@commise/features-account';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useState, type JSX, type ReactNode } from 'react';

import { RecipePhotoUploader } from '../components/RecipePhotoUploader.js';
import { useUserProfile } from '../hooks/useUserProfile.js';
import { reportErrorToSentry } from '../observability/sentryErrorReporter.js';
import { nativeDeviceStore } from '../storage/deviceSession.js';
import { useScreenTrace } from '../screenTrace/useScreenTrace.js';

/** Where the editor hands off: the navigator decides what each means. */
export interface RecipeEditorScreenProps {
    /** The recipe to edit; absent for a new recipe. */
    readonly recipeId?: string;
    /** The section a deep link names (route param, blueprint A16). */
    readonly section?: EditorSectionId;
    /** The ingredient a deep link names (route param); parsed again here, as restored navigation state is untrusted. */
    readonly line?: LineAddress;
    /** Open Paste a list at once: Home's first-run Paste ingredients (build spec §7.5.4). A new recipe only. */
    readonly openPaste?: boolean;
    /** The recipe was published, or its changes saved: show it, and say which, or that it stayed public (E8). */
    readonly onFinished: (recipeId: string, finish: EditorFinish) => void;
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
    /**
     * The route's guard against a leave that would lose a photo not uploaded yet (`navigation/PreventLeave`): told when to
     * hold (`when`) and whom to ask (`onBlocked`, the editor's ask). The screen stays unaware of the navigator.
     */
    readonly renderLeaveGuard?: (guard: LeaveGuard) => ReactNode;
    /** Open a food's page above the editor (the refusal's Open food and a row's `⋯ Open food`). */
    readonly onOpenFood?: (foodId: string) => void;
}

/** What the route's leave guard is told. */
export interface LeaveGuard {
    /** A photo is not uploaded yet: hold every leave. */
    readonly when: boolean;
    /** A leave was held: ask, and call `proceed` to leave after all. */
    readonly onBlocked: (proceed: () => void) => void;
}

/** The signed-in cook and their draft store, or `undefined` while nobody is signed in. */
function useCookDrafts(): CookDrafts | undefined {
    return cookDraftsOf(nativeDeviceStore, useAuth().userId);
}

/**
 * The recipe editor screen.
 *
 * @param props - The recipe (absent for a new one), a deep link's section, and the hand-offs.
 * @returns The editor, or the read boundary around it.
 */
export function RecipeEditorScreen(props: RecipeEditorScreenProps): JSX.Element {
    useScreenTrace('RecipeEditorScreen');
    const { recipeId } = props;
    const loadCopy = useMessages(recipeLoadMessages);
    const { detail } = useMessages(recipeMessages);
    const { detailActions } = useMessages(recipeActionMessages);
    // This opening of the editor, minted OUTSIDE the read boundary: its device-draft read is its own (`useDeviceDraft`).
    const [opening] = useState(nextEditorOpening);

    if (recipeId === undefined) {
        return <NewRecipeEditor {...props} />;
    }

    return (
        <QueryBoundary
            loading={<LoadingNotice label={loadCopy.loadingLabel} />}
            renderError={({ error, resetErrorBoundary }) => (
                <RecipeLoadError
                    error={error}
                    onRetry={resetErrorBoundary}
                    back={{
                        label: detail.backTo.replace('{parent}', detailActions.backToRecipes),
                        icon: 'chevronLeft',
                        onPress: props.onClose,
                    }}
                />
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
    readonly cook: CookDrafts;
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
    line,
    openPaste = false,
    onFinished,
    onClose,
    onDiscarded,
    subscribeToLeave,
    renderLeaveGuard,
    onOpenFood,
    mode,
    drafts,
    seed,
}: RecipeEditorScreenProps & {
    readonly mode: 'create' | 'edit';
    readonly drafts: DraftStore;
    readonly seed: EditorSeed;
}): JSX.Element {
    const locale = useLocale();
    // A route param can arrive unparsed from restored navigation state: it is parsed here, once, at the edge.
    const arrival = arrivalOf(section, line);
    const queue = useSyncQueue();
    const profile = useUserProfile();
    const paidFeatures = paidFeatureStateOf(profile);
    // What a WRITE may rely on: the profile's own answer, never the display's fail-closed `hidden` (review B1).
    const knownPaidFeatures = knownPaidFeaturesOf(profile);
    // ADR-0073: which rule the recipe's Private is under, where the cook stands on private slots (the server's read), and
    // the refusal that is KNOWN - what the session must not send.
    // Only `standing` and `refusal` are read from this. The Private RULE the surface uses follows the DRAFT's source
    // (`source.privateRule`, ADR-0089), not the stored kind passed here.
    const recipePrivate = useRecipePrivate({
        sourceType: seed.recipe?.sourceType,
        sourceKind: seed.recipe?.sourceKind ?? null,
        knownPaidFeatures,
    });
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
        reportError: reportErrorToSentry,
        openPaste,
        privateRefusal: recipePrivate.refusal,
    });

    return (
        <>
            {renderLeaveGuard?.({ when: session.photos.atRisk, onBlocked: session.photos.leave.request })}
            <RecipeEditorSurface
                session={session}
                seed={seed}
                mode={mode}
                keep="disk"
                // Every removal of the route is held by its own guard (`renderLeaveGuard`), so the page asks nothing.
                leaveAsk="byNavigator"
                paidFeatures={paidFeatures}
                knownPaidFeatures={knownPaidFeatures}
                slotStanding={recipePrivate.standing}
                renderPhotos={(target) => <RecipePhotoUploader {...target} />}
                {...(arrival === undefined ? {} : { arrival })}
                onClose={onClose}
                onOpenMyRecipes={onDiscarded}
                foodOpensOverEditor
                {...(onOpenFood === undefined ? {} : { onOpenFood })}
            />
        </>
    );
}
