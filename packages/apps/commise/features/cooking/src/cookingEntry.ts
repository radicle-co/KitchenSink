'use client';

/**
 * @module cookingEntry — what the cook sees BEFORE a session exists: the read of the recipe, the cook link's
 * outcome and the step count decide the first screen, and an owner's draft is sent to the editor.
 *
 * It is the read-level half of cooking mode. The session half (`useCookingSession`) mounts below it, only once there is
 * a recipe with steps to cook, so the session's own status and ticks never reach this hook.
 *
 * @pattern Headless hook — an effect and a clock over the pure {@link cookingEntryOf} rule
 */
import { cookLinkOutcome, countCookableSteps } from '@kitchensink/cooking-core';
import { useEffect, useEffectEvent } from 'react';

import type { CookingScreenProps, CookingScreenRead } from './cookingViewProps.js';
import { useLoadingPhase, type LoadingPhase } from './loadingPhase.js';
import { cookingScreenStateOf, type CookingScreenState } from './screenState.js';

/** The entry decision. */
export interface CookingEntryRule {
    /** The screen to draw before a session exists. */
    readonly state: CookingScreenState;
    /** Whether the cook is being sent to the editor. Only the loading frame is painted until the replace lands. */
    readonly redirecting: boolean;
}

/**
 * Decide the first screen for a read. An owner's draft goes to the editor, and until the replace lands only the loading
 * frame is painted, never the recipe: a cook who is sent on must not see the recipe flash first. A recipe the API
 * returned is readable by this viewer.
 *
 * @param read - Where the read of the recipe stands.
 * @returns The screen and whether the cook is being redirected. Pure.
 */
export function cookingEntryOf(read: CookingScreenRead): CookingEntryRule {
    const stepCount =
        read.kind === 'ready' ? countCookableSteps(read.recipe.steps.map(({ instruction }) => instruction)) : 0;
    const outcome =
        read.kind === 'ready'
            ? cookLinkOutcome({
                  status: read.recipe.status,
                  stepCount,
                  isOwner: read.viewerIsOwner,
                  readable: true,
              })
            : undefined;
    const redirecting = outcome === 'editor';

    return {
        redirecting,
        state: cookingScreenStateOf({
            read: redirecting ? 'pending' : outcome === 'gone' ? 'gone' : read.kind,
            offline: read.kind === 'failed' && read.offline,
            stepCount,
            sessionStatus: 'cooking',
            everyLineTicked: false,
        }),
    };
}

/** What the entry hook hands a screen. */
export interface CookingEntry {
    readonly state: CookingScreenState;
    /** How long the loading frame has been up, for the skeleton and the slow-load notice. */
    readonly phase: LoadingPhase;
}

/**
 * The first screen for a read, the redirect for an owner's draft, and the loading clock.
 *
 * @param read - Where the read of the recipe stands.
 * @param onEdit - Sends the owner to the editor, replacing the cook route.
 * @returns The screen state and the loading phase.
 * @sideEffect Calls `onEdit` once each time a redirect begins, and runs the loading clock.
 */
export function useCookingEntry(read: CookingScreenProps['read'], onEdit: CookingScreenProps['onEdit']): CookingEntry {
    const { state, redirecting } = cookingEntryOf(read);
    const toEditor = useEffectEvent(onEdit);

    useEffect(() => {
        if (redirecting) {
            toEditor();
        }
    }, [redirecting]);

    return { state, phase: useLoadingPhase(read.kind === 'pending' || redirecting) };
}
