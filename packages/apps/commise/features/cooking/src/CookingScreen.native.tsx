/**
 * @module CookingScreen — the native cooking screen: the read-level orchestration of cooking mode. It decides which screen to draw before
 * a session exists (`useCookingEntry`: loading, error, gone, no steps) and mounts `CookingSessionScreen` only once the
 * recipe is ready to cook. Where to go (the recipe, the editor, Home) is the route adapter's: it hands callbacks in.
 *
 * Because the session is mounted below this switch and keyed by the recipe, the read always wins at the join: a read
 * that goes back to loading, or arrives with no steps, replaces Done rather than sitting under it.
 *
 * @pattern Visitor — an exhaustive switch over the read-level screen state, each case picking one render component
 */
import { useMessages } from '@commise/i18n/react';
import type { StateNoticeProps } from '@commise/ui/state-notice';
import type { FC } from 'react';
import { useWindowDimensions } from 'react-native';

import { exitOf } from './cookingCopy.js';
import { NARROW_ROW, SHORT_SCREEN } from './cookingLayout.js';
import { CookingFrame } from './CookingFrame.native.js';
import { CookingLoading } from './CookingLoading.native.js';
import { CookingNav } from './CookingNav.native.js';
import { CookingSessionScreen } from './CookingSessionScreen.native.js';
import { CookingStateNotice } from './CookingStateNotice.native.js';
import { CookingTopBar } from './CookingTopBar.native.js';
import type { CookingScreenProps } from './cookingViewProps.js';
import type { LoadingPhase } from './loadingPhase.js';
import { cookingMessages, type CookingMessages } from './messages.js';
import { useCookingEntry } from './cookingEntry.js';

/** The disabled pair's handler while loading: a disabled control is never pressed. */
const noop = (): void => undefined;

/** A full-screen notice: no top bar, no foot. */
const noticeFrame = (notice: StateNoticeProps) => (
    <CookingFrame topBar={null} busy={false} body={<CookingStateNotice {...notice} />} />
);

/** What {@link loadingFrame} draws from. */
interface LoadingFrameInput {
    readonly copy: CookingMessages;
    readonly phase: LoadingPhase;
    readonly narrow: boolean;
    readonly onLeave: () => void;
}

/** The loading frame: Exit live, the place muted, Back and Next drawn and disabled, the skeleton in the body. Pure. */
const loadingFrame = ({ copy, phase, narrow, onLeave }: LoadingFrameInput) => (
    <CookingFrame
        busy
        topBar={
            <CookingTopBar
                exit={exitOf(copy.top, onLeave)}
                place={{ text: copy.loading.place, tone: 'muted' }}
                narrow={narrow}
            />
        }
        body={<CookingLoading phase={phase === 'slow' ? 'label' : phase} label={copy.loading.label} />}
        foot={{
            actions: (
                <CookingNav
                    disabled
                    narrow={narrow}
                    back={{ label: copy.nav.back, onPress: noop }}
                    forward={{ label: copy.nav.next, onPress: noop, tone: 'quiet' }}
                />
            ),
        }}
    />
);

/** The native cooking screen. */
export const CookingScreen: FC<CookingScreenProps> = ({ read, onLeave, onEdit, onHome }) => {
    const copy = useMessages(cookingMessages);
    const { state, phase } = useCookingEntry(read, onEdit);
    // The window is read once, here, because a leaf never reads the device. Both rules are measured in text, like web's
    // rem container queries: the width and height are divided by the cook's text size, so the largest text on a wide phone
    // still takes the narrow layout.
    const { width, height, fontScale } = useWindowDimensions();
    const narrow = width / fontScale < NARROW_ROW.maxPx;
    const short = height / fontScale < SHORT_SCREEN.maxHeightPx;

    switch (state.kind) {
        case 'loading':
            if (phase === 'slow' && read.kind === 'pending') {
                return noticeFrame({
                    title: copy.error.title,
                    body: copy.error.body,
                    primary: { label: copy.error.retry, icon: 'refreshCw', onPress: read.retry },
                    secondary: { label: copy.error.back, icon: 'chevronLeft', onPress: onLeave },
                });
            }

            return loadingFrame({ copy, phase, narrow, onLeave });
        case 'error':
            return noticeFrame({
                title: copy.error.title,
                body: state.offline ? copy.error.offlineBody : copy.error.body,
                ...(read.kind === 'failed'
                    ? { primary: { label: copy.error.retry, icon: 'refreshCw', onPress: read.retry } }
                    : {}),
                secondary: { label: copy.error.back, icon: 'chevronLeft', onPress: onLeave },
            });
        case 'gone':
            return noticeFrame({
                title: copy.gone.title,
                secondary: { label: copy.gone.home, icon: 'house', onPress: onHome },
            });

        case 'noSteps': {
            const owner = read.kind === 'ready' && read.viewerIsOwner;

            return noticeFrame({
                title: copy.empty.title,
                body: owner ? copy.empty.body : copy.empty.bodyOther,
                ...(owner ? { primary: { label: copy.empty.edit, icon: 'pencilLine', onPress: onEdit } } : {}),
                secondary: { label: copy.empty.back, icon: 'chevronLeft', onPress: onLeave },
            });
        }

        case 'ready':
            // `useCookingEntry` only reaches `ready` with a ready read; the narrowing keeps the type honest.
            return read.kind === 'ready' ? (
                <CookingSessionScreen
                    key={read.recipe.id}
                    recipe={read.recipe}
                    onLeave={onLeave}
                    narrow={narrow}
                    short={short}
                    width={width}
                />
            ) : null;
    }
};
