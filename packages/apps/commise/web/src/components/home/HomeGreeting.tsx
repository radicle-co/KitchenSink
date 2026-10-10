'use client';

/**
 * @module home/HomeGreeting — Home's large title: the time-of-day greeting as the page's H1 and the date under it (web;
 * US-000 / FR-046; `docs/design/uiOverhaul/buildSpec.md` §4.2), drawn by the design system's `LargeTitleHeader` with the
 * header's action (the avatar) and the floating create button right after the H1.
 *
 * "Good afternoon, Eliza" over "Sunday, May 31, 2026"; "Good afternoon" when the cook has no name yet. Both are derived from the viewer's
 * LOCAL clock: the greeting from the hour-of-day bucket ({@link greetingBucketForHour}) and the subtitle from
 * {@link formatHomeDate} — the shared, locale-aware formatters in `@commise/features-core`, so web and mobile
 * greet identically (FR-044).
 *
 * ## Why the clock is read AFTER hydration, not during the server render (#144)
 *
 * This surface is server-rendered and then hydrated, and only ONE of those two runtimes knows the viewer's
 * timezone: the client. Whatever the Next server's `new Date()` says is the server's zone, so a server-computed
 * bucket greets an Auckland viewer at 9am with "Good evening" and can be a whole calendar day out.
 *
 * `suppressHydrationWarning` was the previous answer and it does NOT work: React never patches a suppressed
 * text mismatch — it KEEPS the server-rendered text — so the greeting and the long date were permanently the
 * server's clock (measured: with the browser clock pinned to 03:00, the `night` bucket, the DOM still read
 * "Good afternoon, Chef!"). Suppression silences the warning about the divergence; it does not resolve it.
 *
 * So the reading is gated on hydration ({@link useIsHydrated}) and the server pass renders a reserved,
 * `aria-hidden` placeholder instead of a guess. Three consequences, all deliberate:
 *  - **No flash of a WRONG greeting.** The pre-hydration frame commits to no bucket at all, so the text never
 *    changes from one greeting to a different one — the correction that would itself be the defect.
 *  - **No layout shift.** The placeholder lines carry the SAME typography classes as the real ones, so each
 *    reserves its exact line box (`mb-1` included) rather than a hand-guessed pixel height.
 *  - **The greeting becomes testable end-to-end.** A browser-side clock pin (Playwright's `page.clock`) cannot
 *    reach the Next server, which is why the visual suites had to MASK these two lines. Now that the client
 *    clock is the authority, the pin reaches the render and the masks can be replaced by real assertions.
 *
 * A viewer's-timezone header (Vercel's geo-IP `x-vercel-ip-timezone`) or a zone cookie were both rejected: the
 * former is provider-coupled and wrong behind a VPN, the latter is wrong on the first visit — and neither is
 * reachable from a browser test, so both would keep the masks.
 */
import { formatHomeDate, greetingBucketForHour } from '@commise/features-core';
import { useLocale, useMessages } from '@commise/i18n/react';
import {
    LARGE_SUBTITLE_CLASS,
    LARGE_TITLE_CLASS,
    LargeTitleHeader,
    type HeaderAction,
} from '@commise/ui/large-title-header';
import type { JSX, ReactNode } from 'react';

import { useIsHydrated } from '@/hooks/useIsHydrated';
import { webMessages } from '@/i18n/messages';

/**
 * The greeting line's typography, stated ONCE so the real line and the reserved placeholder cannot drift into
 * different heights (which is what would reintroduce a layout shift at hydration).
 */
const GREETING_LINE = `${LARGE_TITLE_CLASS} focus:outline-none`;

/** The date line's typography — same single-statement reason as {@link GREETING_LINE}. */
const DATE_LINE = LARGE_SUBTITLE_CLASS;

/** The id of Home's H1. */
export const HOME_TITLE_ID = 'home-title';

/** Props for {@link HomeGreeting}. */
export interface HomeGreetingProps {
    /** The cook's display name, if any. */
    readonly name?: string;
    /** The header's action: the avatar, below 840. */
    readonly action?: HeaderAction;
    /** What comes right after the H1: the floating create button. */
    readonly afterTitle?: ReactNode;
}

/** The skeleton shape utilities: the repo's reserved `pearl` skeleton fill (see `RecipeCardGridSkeleton`). */
const PLACEHOLDER_BAR = 'max-w-full rounded-md bg-surface-muted';

/**
 * The Home large title.
 *
 * @param props - The cook's name, the header's action, and what follows the H1.
 * @returns The time-of-day greeting as the H1 and the localized full-date subtitle once the viewer's clock is readable;
 *          before that, the same two lines reserved as an `aria-hidden` placeholder.
 */
export function HomeGreeting({ name, action, afterTitle }: HomeGreetingProps = {}): JSX.Element {
    const { home } = useMessages(webMessages);
    const locale = useLocale();
    const hydrated = useIsHydrated();

    if (!hydrated) {
        // Hidden from assistive tech rather than labelled: there is nothing to say yet, and an empty <h1> is a
        // heading with no accessible name. No pulse either — nothing is being fetched, so a shimmer would
        // claim a wait that is not happening (and would then owe `prefers-reduced-motion` handling).
        return (
            <div aria-hidden="true">
                <div className={`${GREETING_LINE} w-64 ${PLACEHOLDER_BAR}`}>&nbsp;</div>
                <div className={`${DATE_LINE} w-44 ${PLACEHOLDER_BAR}`}>&nbsp;</div>
            </div>
        );
    }

    const now = new Date();
    const bucket = greetingBucketForHour(now.getHours());
    const greeting = name === undefined ? home.greetings[bucket] : home.greetingsNamed[bucket].replace('{name}', name);

    return (
        <LargeTitleHeader
            headingId={HOME_TITLE_ID}
            title={greeting}
            subtitle={formatHomeDate(now, locale)}
            {...(action === undefined ? {} : { action })}
            {...(afterTitle === undefined ? {} : { afterTitle })}
        />
    );
}
