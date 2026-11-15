/**
 * @module cookingEntryView — what the read of a recipe draws, written once for both platforms: the loading frame, one of
 * the notices (load error, recipe gone, no steps) with its copy and actions, or the session. A screen renders these three
 * cases and owns nothing else about the read.
 */
import type { StateNoticeProps } from '@commise/ui/state-notice';

import type { CookingEntry } from './cookingEntry.js';
import type { CookingRecipe, CookingScreenProps } from './cookingViewProps.js';
import type { LoadingPhase } from './loadingPhase.js';
import type { CookingMessages } from './messages.js';

/** What the read draws. */
export type CookingEntryView =
    | { readonly kind: 'loading'; readonly phase: Exclude<LoadingPhase, 'slow'> }
    | { readonly kind: 'notice'; readonly notice: StateNoticeProps }
    | { readonly kind: 'session'; readonly recipe: CookingRecipe };

/** Inputs to {@link cookingEntryViewOf}: the entry rule's answer, the read it came from, the copy and where each action goes. */
export interface CookingEntryViewInput
    extends CookingEntry, Pick<CookingScreenProps, 'read' | 'onLeave' | 'onEdit' | 'onHome'> {
    readonly copy: CookingMessages;
}

/**
 * What the read draws. A pending read that has been slow for 10 s becomes the load error, so a cook is never left on a
 * skeleton, but a draft redirect that is slow has no read to retry and stays on the label frame.
 *
 * @param input - The entry state and phase, the read, the copy and the three destinations.
 * @returns The loading frame, a notice, or the recipe to cook. Pure.
 */
export function cookingEntryViewOf({
    state,
    phase,
    read,
    copy,
    onLeave,
    onEdit,
    onHome,
}: CookingEntryViewInput): CookingEntryView {
    const back = { label: copy.error.back, icon: 'chevronLeft', onPress: onLeave } as const;

    switch (state.kind) {
        case 'loading':
            return phase === 'slow' && read.kind === 'pending'
                ? {
                      kind: 'notice',
                      notice: {
                          title: copy.error.title,
                          body: copy.error.body,
                          primary: { label: copy.error.retry, icon: 'refreshCw', onPress: read.retry },
                          secondary: back,
                      },
                  }
                : { kind: 'loading', phase: phase === 'slow' ? 'label' : phase };
        case 'error':
            return {
                kind: 'notice',
                notice: {
                    title: copy.error.title,
                    body: state.offline ? copy.error.offlineBody : copy.error.body,
                    ...(read.kind === 'failed'
                        ? { primary: { label: copy.error.retry, icon: 'refreshCw', onPress: read.retry } }
                        : {}),
                    secondary: back,
                },
            };
        case 'gone':
            return {
                kind: 'notice',
                notice: {
                    title: copy.gone.title,
                    secondary: { label: copy.gone.home, icon: 'house', onPress: onHome },
                },
            };

        case 'noSteps': {
            const owner = read.kind === 'ready' && read.viewerIsOwner;

            return {
                kind: 'notice',
                notice: {
                    title: copy.empty.title,
                    body: owner ? copy.empty.body : copy.empty.bodyOther,
                    ...(owner ? { primary: { label: copy.empty.edit, icon: 'pencilLine', onPress: onEdit } } : {}),
                    secondary: { label: copy.empty.back, icon: 'chevronLeft', onPress: onLeave },
                },
            };
        }

        case 'ready':
            // `useCookingEntry` only reaches `ready` with a ready read; the narrowing keeps the type honest.
            return read.kind === 'ready'
                ? { kind: 'session', recipe: read.recipe }
                : { kind: 'loading', phase: 'blank' };
    }
}
