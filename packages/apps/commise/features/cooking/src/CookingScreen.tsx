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
import type { FC } from 'react';

import { exitOf } from './cookingCopy.js';
import { CookingFrame } from './CookingFrame.js';
import { CookingLoading } from './CookingLoading.js';
import { CookingNav } from './CookingNav.js';
import { CookingSessionScreen } from './CookingSessionScreen.js';
import { CookingStateNotice } from './CookingStateNotice.js';
import { CookingTopBar } from './CookingTopBar.js';
import type { CookingScreenProps } from './cookingViewProps.js';
import { cookingMessages } from './messages.js';
import { useCookingEntry } from './cookingEntry.js';

/** The disabled pair's handler while loading: a disabled control is never pressed. */
const noop = (): void => undefined;

/** The web cooking screen. */
export const CookingScreen: FC<CookingScreenProps> = ({ read, onLeave, onEdit, onHome }) => {
    const copy = useMessages(cookingMessages);
    const { state, phase } = useCookingEntry(read, onEdit);

    switch (state.kind) {
        case 'loading':
            if (phase === 'slow' && read.kind === 'pending') {
                return (
                    <CookingFrame
                        topBar={null}
                        busy={false}
                        body={
                            <CookingStateNotice
                                title={copy.error.title}
                                body={copy.error.body}
                                primary={{ label: copy.error.retry, icon: 'refreshCw', onPress: read.retry }}
                                secondary={{ label: copy.error.back, icon: 'chevronLeft', onPress: onLeave }}
                            />
                        }
                    />
                );
            }

            return (
                <CookingFrame
                    busy
                    topBar={
                        <CookingTopBar
                            exit={exitOf(copy.top, onLeave)}
                            place={{ text: copy.loading.place, tone: 'muted' }}
                        />
                    }
                    body={<CookingLoading phase={phase === 'slow' ? 'label' : phase} label={copy.loading.label} />}
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
        case 'error':
            return (
                <CookingFrame
                    topBar={null}
                    busy={false}
                    body={
                        <CookingStateNotice
                            title={copy.error.title}
                            body={state.offline ? copy.error.offlineBody : copy.error.body}
                            {...(read.kind === 'failed'
                                ? { primary: { label: copy.error.retry, icon: 'refreshCw', onPress: read.retry } }
                                : {})}
                            secondary={{ label: copy.error.back, icon: 'chevronLeft', onPress: onLeave }}
                        />
                    }
                />
            );
        case 'gone':
            return (
                <CookingFrame
                    topBar={null}
                    busy={false}
                    body={
                        <CookingStateNotice
                            title={copy.gone.title}
                            secondary={{ label: copy.gone.home, icon: 'house', onPress: onHome }}
                        />
                    }
                />
            );

        case 'noSteps': {
            const owner = read.kind === 'ready' && read.viewerIsOwner;

            return (
                <CookingFrame
                    topBar={null}
                    busy={false}
                    body={
                        <CookingStateNotice
                            title={copy.empty.title}
                            body={owner ? copy.empty.body : copy.empty.bodyOther}
                            {...(owner
                                ? { primary: { label: copy.empty.edit, icon: 'pencilLine', onPress: onEdit } }
                                : {})}
                            secondary={{ label: copy.empty.back, icon: 'chevronLeft', onPress: onLeave }}
                        />
                    }
                />
            );
        }

        case 'ready':
            // `useCookingEntry` only reaches `ready` with a ready read; the narrowing keeps the type honest.
            return read.kind === 'ready' ? (
                <CookingSessionScreen key={read.recipe.id} recipe={read.recipe} onLeave={onLeave} />
            ) : null;
    }
};
