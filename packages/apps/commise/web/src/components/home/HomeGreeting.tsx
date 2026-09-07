'use client';

/**
 * @module home/HomeGreeting — the time-of-day Home greeting + date subtitle (web; US-000 / FR-046).
 *
 * The mockup's "Good afternoon, Chef!" over "Saturday, May 31, 2026". Both are derived from the viewer's
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
import { useSyncExternalStore, type JSX } from 'react';

import { webMessages } from '@/i18n/messages';

/**
 * The greeting line's typography, stated ONCE so the real line and the reserved placeholder cannot drift into
 * different heights (which is what would reintroduce a layout shift at hydration).
 */
const GREETING_LINE = 'mb-1 font-display text-3xl font-bold text-charcoal';

/** The date line's typography — same single-statement reason as {@link GREETING_LINE}. */
const DATE_LINE = 'text-slate';

/** The skeleton shape utilities: the repo's reserved `pearl` skeleton fill (see `RecipeCardGridSkeleton`). */
const PLACEHOLDER_BAR = 'max-w-full rounded-md bg-pearl';

/**
 * A store that never emits, whose snapshot is `true` on the client and `false` on the server. Subscribing is a
 * no-op because the value it reports — "React has hydrated this tree" — transitions exactly once, and React
 * itself performs that transition by re-reading the client snapshot after hydration.
 *
 * @returns The unsubscribe callback. Pure.
 */
const subscribeToNothing = (): (() => void) => () => undefined;

/** The client snapshot: reached only once this tree is running in the browser. */
const onClient = (): boolean => true;

/** The server snapshot: also what React reads during the hydration pass, so the two passes agree. */
const onServer = (): boolean => false;

/**
 * Whether this tree has hydrated — i.e. whether reading the viewer's clock is meaningful yet.
 *
 * `useSyncExternalStore` with a server snapshot is chosen over `useState` + `useEffect` on purpose: React uses
 * `getServerSnapshot` for the server render AND the hydration render (so hydration matches byte-for-byte, with
 * no suppression), while a client-side navigation to Home — which performs no hydration — reads the CLIENT
 * snapshot on its very first render and therefore paints the real greeting immediately, with no placeholder
 * frame at all.
 *
 * @returns `false` on the server and during hydration; `true` thereafter.
 */
function useIsHydrated(): boolean {
    return useSyncExternalStore(subscribeToNothing, onClient, onServer);
}

/**
 * The Home greeting header.
 *
 * @returns The time-of-day greeting and the localized full-date subtitle once the viewer's clock is readable;
 *          before that, the same two lines reserved as an `aria-hidden` placeholder.
 */
export function HomeGreeting(): JSX.Element {
    const { home } = useMessages(webMessages);
    const locale = useLocale();
    const hydrated = useIsHydrated();

    if (!hydrated) {
        // Hidden from assistive tech rather than labelled: there is nothing to say yet, and an empty <h2> is a
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
    const greeting = home.greetings[greetingBucketForHour(now.getHours())];
    const date = formatHomeDate(now, locale);

    return (
        <div>
            <h2 className={GREETING_LINE}>{greeting}</h2>
            <p className={DATE_LINE}>{date}</p>
        </div>
    );
}
