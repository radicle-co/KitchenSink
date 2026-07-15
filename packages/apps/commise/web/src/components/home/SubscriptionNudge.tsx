'use client';

/**
 * @module home/SubscriptionNudge — the once-per-session subscription upgrade nudge (web).
 *
 * FR-046: a free-tier viewer who taps a premium-gated entry point on Home sees an upgrade nudge **at most
 * once per session**. The nudge is host-owned chrome; a widget triggers it through {@link useHomeNudge}
 * (the seam a future premium-gated widget calls). In Home v1 no live widget is premium-gated, so the
 * mechanism ships ready for the first gated widget (005–009) rather than firing on any current surface.
 *
 * "Once per session" is deliberately **component state** (a ref guard), not persisted — the requirement is
 * per-session, and a page reload legitimately starts a new session.
 */
import { createContext, useCallback, useContext, useRef, useState, type JSX } from 'react';

import { useMessages } from '@commise/i18n/react';

import { webMessages } from '@/i18n/messages';

/** The nudge trigger seam exposed to widgets via {@link HomeNudgeContext}. */
export interface HomeNudge {
    /** Request the upgrade nudge. A no-op after the nudge has already been shown once this session. */
    readonly trigger: () => void;
}

/** Context carrying the {@link HomeNudge} trigger down to widgets (provided by the Home surface). */
export const HomeNudgeContext = createContext<HomeNudge | null>(null);

/**
 * Read the Home nudge trigger. A premium-gated widget calls `useHomeNudge().trigger()` when a free-tier
 * viewer taps its gated entry point.
 *
 * @throws {Error} when used outside the Home widget surface (no provider).
 */
export function useHomeNudge(): HomeNudge {
    const nudge = useContext(HomeNudgeContext);

    if (nudge === null) {
        throw new Error('useHomeNudge must be used within the Home widget surface.');
    }

    return nudge;
}

/** The live nudge state owned by the Home surface: whether it is visible plus its trigger/dismiss controls. */
export interface OncePerSessionNudge {
    /** Whether the nudge is currently shown. */
    readonly visible: boolean;
    /** Show the nudge — a no-op once it has already been shown this session. */
    readonly trigger: () => void;
    /** Hide the nudge (does not re-arm it — it stays spent for the session). */
    readonly dismiss: () => void;
}

/**
 * Own the once-per-session nudge state. The first {@link OncePerSessionNudge.trigger} shows it; a ref guard
 * makes every later trigger a no-op for the session, so it can appear at most once regardless of how many
 * gated taps occur. Dismissing hides it without re-arming.
 */
export function useOncePerSessionNudge(): OncePerSessionNudge {
    const [visible, setVisible] = useState(false);
    const shown = useRef(false);

    const trigger = useCallback(() => {
        if (shown.current) {
            return;
        }

        shown.current = true;
        setVisible(true);
    }, []);

    const dismiss = useCallback(() => setVisible(false), []);

    return { visible, trigger, dismiss };
}

/** Props for {@link SubscriptionNudge}. */
export interface SubscriptionNudgeProps {
    /** Whether the nudge is shown. */
    readonly open: boolean;
    /** Invoked when the viewer dismisses the nudge. */
    readonly onDismiss: () => void;
}

/**
 * The upgrade nudge dialog. Renders nothing when closed. Copy is localized via the web dictionary.
 *
 * The upgrade action currently dismisses (the subscription surface is owned by 010, not yet shipped); it is
 * wired as a distinct action so it becomes a real destination without a structural change when 010 lands.
 */
export function SubscriptionNudge({ open, onDismiss }: SubscriptionNudgeProps): JSX.Element | null {
    const { home } = useMessages(webMessages);

    if (!open) {
        return null;
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={home.nudge.title}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-md flex-col gap-3 rounded-t-2xl bg-white p-6 shadow-xl"
        >
            <h2 className="font-display text-lg font-semibold text-charcoal">{home.nudge.title}</h2>
            <p className="text-sm text-slate">{home.nudge.body}</p>
            <div className="flex justify-end gap-3">
                <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded-full px-4 py-2 text-sm font-medium text-slate"
                >
                    {home.nudge.dismiss}
                </button>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="rounded-full bg-seafoam px-5 py-2 text-sm font-semibold text-white"
                >
                    {home.nudge.upgrade}
                </button>
            </div>
        </div>
    );
}
