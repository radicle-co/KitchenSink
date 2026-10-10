'use client';

/**
 * @module @commise/features-recipes/editor — one editor session, as both platforms mount it (UI overhaul slice 7; owner
 * decisions D1, D10). The web container and the native screen each read the recipe and the device draft, then call
 * this; what they keep for themselves is their router, their read boundary and their platform leaves (the status
 * poller, the photo uploader).
 *
 * The session binds the editor's lifecycle (`useRecipeEditor`) to everything else it needs:
 *
 * - **The hand-offs, through a navigation port** ({@link EditorNavigation}): the editor says how it handed off, and each
 *   platform says where that goes (web pushes a route, native goes back or to the recipe). A Publish or Save changes
 *   first sends the visibility the write's answer lacks (`visibilityFollowUp`).
 * - **A leave by another route than ×**: the exit checkpoint. Native hears Back and the swipe through `subscribeToLeave`
 *   (`beforeRemove`); on both platforms the editor UNMOUNTING is a leave too, because the web has no such event — browser
 *   Back or a shell link simply unmounts it.
 * - **The row editor, its line-status answers and the lookup retry**, every answer meeting the draft as it is then
 *   (`editor.dispatch`).
 * - **Paste a list**: offered while the editor says so (`pasteOffered`, D10), each line keeping its source while the
 *   editor says so (`pastedLineKeepsSource`), and a paste still joining holding the server create (`serverWriteFor`).
 *   The paste is composed after the editor, which it dispatches into, so the hold is made BEFORE both and handed to
 *   each (`pasteHold.ts`): the paste writes it, a checkpoint reads it.
 *
 * No JSX: the sections each container draws are page composition (`docs/CODING_STANDARDS.md` §14.2).
 *
 * @pattern Mediator — the editor, the row editor, the paste and the navigation port coordinated in one place
 * @pattern Port — {@link EditorNavigation}, the platform's router behind the editor's hand-offs
 */
import type { Locale } from '@commise/i18n';
import type { RecipeDetail } from '@kitchensink/recipe-core';
import { recipeQueries } from '@kitchensink/recipe-service-client';
import {
    useRebindIngredientLine,
    useRecipeServiceClient,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import type { LookupRetry, ObservedIngredientStatus, SettledAnswer } from '../form/ingredientStatus.js';
import { rebindRequestOf } from '../hooks/lineCommit.js';
import { useIngredientRowEditor, type IngredientRowEditor } from '../hooks/useIngredientRowEditor.js';
import { useLibraryEmpty } from '../hooks/useLibraryEmpty.js';
import { useLineNutrition } from '../hooks/useLineNutrition.js';
import { useLookupRetry } from '../hooks/useLookupRetry.js';
import {
    useRecipeEditor,
    type EditorExit,
    type EditorSeed,
    type EditorWritePort,
    type UseRecipeEditorResult,
} from '../hooks/useRecipeEditor.js';
import type { DraftStore } from './draftStore.js';
import { createPasteHold } from './pasteHold.js';
import { previewRecipeOf } from './previewRecipe.js';
import type { DraftKeep } from './saveStatus.js';
import { useIngredientsPaste, type IngredientsPaste } from './useIngredientsPaste.js';
import { visibilityFollowUp } from './visibilityFollowUp.js';

/** Where the editor's hand-offs go: the platform's router, behind the editor's own vocabulary. */
export interface EditorNavigation {
    /** The recipe was published, or its changes saved: show it. */
    readonly finished: (recipeId: string) => void;
    /** The cook kept the server's copy, or discarded a published recipe's device changes: back to the recipe. */
    readonly leftForRecipe: (recipeId: string) => void;
    /** A recipe never published was discarded: go to My recipes. */
    readonly discarded: () => void;
    /**
     * Hear the editor being left by a route other than × (native Back, the swipe: React Navigation's `beforeRemove`).
     * Returns the unsubscribe. Each leave runs the exit checkpoint, which does nothing once the editor has handed off.
     */
    readonly subscribeToLeave?: (listener: () => void) => () => void;
}

/** Options for {@link useRecipeEditorSession}. */
export interface UseRecipeEditorSessionOptions {
    /** What the editor opens with: the settled recipe (edit) and the device draft. Captured once. */
    readonly seed: EditorSeed;
    readonly locale: Locale;
    /** Where the device draft is kept: on disk (native) or in this tab (web, D7). */
    readonly keep: DraftKeep;
    /** The offline write path (the app's `SyncQueue`). */
    readonly port: EditorWritePort;
    readonly drafts: DraftStore;
    readonly navigation: EditorNavigation;
    /** Called with a new recipe's local ref once minted, and its server id once created (the web's URL keeps it). */
    readonly onRecipeRef?: (ref: string) => void;
    /** Open Paste a list at once: Home's first-run Paste ingredients (§7.5.4). */
    readonly openPaste: boolean;
}

/** The preview sheet's state and the recipe it shows. */
export interface EditorPreview {
    readonly open: boolean;
    readonly show: () => void;
    readonly hide: () => void;
    /** The draft as a recipe, for the sheet. */
    readonly recipe: RecipeDetail;
}

/** What a container draws the editor with. */
export interface RecipeEditorSession {
    readonly editor: UseRecipeEditorResult;
    readonly rowEditor: IngredientRowEditor;
    readonly nutrition: ReturnType<typeof useLineNutrition>;
    readonly lookupRetry: LookupRetry;
    readonly paste: IngredientsPaste;
    /** A polled line's status answer, for the platform's status poller. */
    readonly applyLineStatus: (polledId: string, observed: ObservedIngredientStatus) => void;
    /** A field lost focus: the checkpoint the fields report. */
    readonly blur: () => void;
    /** Append pasted steps (Steps' heading action). */
    readonly appendSteps: (instructions: readonly string[]) => void;
    /** Whether the cook's library is empty: the editor guides a first recipe. */
    readonly guided: boolean;
    readonly preview: EditorPreview;
}

/**
 * One editor session.
 *
 * @param options - The seed, the ports and the navigation.
 * @returns What the container draws the editor with.
 * @sideEffect Through the editor and its hooks: device draft writes, outbox submits, lookups and the visibility write.
 */
export function useRecipeEditorSession(options: UseRecipeEditorSessionOptions): RecipeEditorSession {
    const { seed, locale, keep, port, drafts, navigation, onRecipeRef, openPaste } = options;
    const client = useRecipeServiceClient();
    const setVisibility = useSetRecipeVisibility();
    const rebind = useRebindIngredientLine();
    const guided = useLibraryEmpty(recipeQueries(client).library({ sortBy: 'updatedAt' }).queryKey);
    const [previewing, setPreviewing] = useState(false);
    // Made before the editor and the paste, which each need the other: the paste writes it, a checkpoint reads it.
    const [pasteHold] = useState(createPasteHold);

    /** Published, or its changes saved: visibility follows its answer, then the recipe shows. @sideEffect */
    const finished = (stored: RecipeDetail): void => {
        const visibility = visibilityFollowUp(editor.values.visibility, stored);

        if (visibility !== undefined) {
            setVisibility.mutate({ id: stored.id, visibility });
        }

        navigation.finished(stored.id);
    };

    const onExit = (exit: EditorExit): void => {
        switch (exit.kind) {
            case 'published':
            case 'changesSaved':
                finished(exit.recipe);

                return;

            case 'leftForRecipe':
                navigation.leftForRecipe(exit.recipeId);

                return;

            case 'discarded':
                navigation.discarded();

                return;

            default: {
                const unreachable: never = exit;

                return unreachable;
            }
        }
    };

    const editor = useRecipeEditor(seed, {
        locale,
        port,
        drafts,
        keep,
        onExit,
        ...(onRecipeRef === undefined ? {} : { onRecipeRef }),
        rebindLine: (address, target) => rebind.mutateAsync(rebindRequestOf(address, target)),
        pasteHold,
    });

    // Every way out of the editor does what × does (build spec §3.5, ADR-0057 §2): the exit checkpoint. × runs its own
    // first; any later one is refused while that write is on the wire, finds nothing changed, or finds the lane closed by
    // a hand-off (Publish, Save changes, Discard), so a second exit does nothing.
    const { subscribeToLeave } = navigation;
    const onLeave = useEffectEvent((): void => editor.checkpoint('editorExit'));
    useEffect(() => subscribeToLeave?.(() => onLeave()), [subscribeToLeave]);
    // ⛔ The unmount is a leave (browser Back, a shell link, the session ending). It runs AT the cleanup, never deferred:
    // a session end clears the cook's stores from the provider's effect in the same commit, which runs after this
    // cleanup, so the clear is queued behind whatever this checkpoint writes. ⚠️ StrictMode's development replay runs
    // it once at mount as well: an untouched editor writes nothing, and a reopened draft's exit checkpoint is one it
    // would take at its first section change anyway.
    useEffect(() => () => onLeave(), []);

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
                ? { kind: 'createForm', dispatch }
                : { kind: 'editForm', dispatch, command: editor.lineCommand },
        lines: editor.values.ingredients,
    });
    const paste = useIngredientsPaste({
        offered: editor.pasteAvailable,
        keepsSource: editor.pasteKeepsSource,
        dispatch,
        lineCount: editor.values.ingredients.length,
        initiallyOpen: openPaste,
        hold: pasteHold,
    });

    return {
        editor,
        rowEditor,
        nutrition,
        lookupRetry,
        paste,
        applyLineStatus,
        blur: () => editor.checkpoint('fieldBlur'),
        appendSteps: (instructions) => dispatch({ kind: 'appendSteps', instructions }),
        guided,
        preview: {
            open: previewing,
            show: () => setPreviewing(true),
            hide: () => setPreviewing(false),
            recipe: previewRecipeOf({ values: editor.values, recipe: seed.recipe, now: new Date().toISOString() }),
        },
    };
}
