'use client';

/**
 * @module CookingScreen — the web cooking screen: the read-level orchestration of cooking mode. It decides which screen to draw before
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

import { exitOf } from './cookingCopy.js';
import { CookingFrame } from './CookingFrame.js';
import { CookingLoading } from './CookingLoading.js';
import { CookingNav } from './CookingNav.js';
import { CookingSessionScreen } from './CookingSessionScreen.js';
import { CookingStateNotice } from './CookingStateNotice.js';
import { CookingTopBar } from './CookingTopBar.js';
import type { CookingScreenProps } from './cookingViewProps.js';
import type { LoadingPhase } from './loadingPhase.js';
import { cookingMessages, type CookingMessages } from './messages.js';
import { useCookingEntry } from './cookingEntry.js';
import { cookingEntryViewOf } from './cookingEntryView.js';

/** The disabled pair's handler while loading: a disabled control is never pressed. */
const noop = (): void => undefined;

/** A full-screen notice: no top bar, no foot. */
const noticeFrame = (notice: StateNoticeProps) => (
    <CookingFrame topBar={null} busy={false} body={<CookingStateNotice {...notice} />} />
);

/** What {@link loadingFrame} draws from. */
interface LoadingFrameInput {
    readonly copy: CookingMessages;
    readonly phase: Exclude<LoadingPhase, 'slow'>;
    readonly onLeave: () => void;
}

/** The loading frame: Exit live, the place muted, Back and Next drawn and disabled, the skeleton in the body. Pure. */
const loadingFrame = ({ copy, phase, onLeave }: LoadingFrameInput) => (
    <CookingFrame
        busy
        topBar={<CookingTopBar exit={exitOf(copy.top, onLeave)} place={{ text: copy.loading.place, tone: 'muted' }} />}
        body={<CookingLoading phase={phase} label={copy.loading.label} />}
        foot={{
            actions: (
                <CookingNav
                    disabled
                    back={{ label: copy.nav.back, onPress: noop }}
                    forward={{ label: copy.nav.next, onPress: noop, tone: 'quiet' }}
                />
            ),
        }}
    />
);

/** The web cooking screen. */
export const CookingScreen: FC<CookingScreenProps> = ({ read, onLeave, onEdit, onHome }) => {
    const copy = useMessages(cookingMessages);
    const entry = useCookingEntry(read, onEdit);

    const view = cookingEntryViewOf({ ...entry, read, copy, onLeave, onEdit, onHome });

    switch (view.kind) {
        case 'loading':
            return loadingFrame({ copy, phase: view.phase, onLeave });
        case 'notice':
            return noticeFrame(view.notice);
        case 'session':
            return <CookingSessionScreen key={view.recipe.id} recipe={view.recipe} onLeave={onLeave} />;
    }
};
