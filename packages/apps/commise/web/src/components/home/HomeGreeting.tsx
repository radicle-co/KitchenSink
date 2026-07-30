'use client';

/**
 * @module home/HomeGreeting — the time-of-day Home greeting + date subtitle (web; US-000 / FR-046).
 *
 * The mockup's "Good afternoon, Chef!" over "Saturday, May 31, 2026". Both are derived from the viewer's
 * LOCAL clock: the greeting from the hour-of-day bucket ({@link greetingBucketForHour}) and the subtitle from
 * {@link formatHomeDate} — the shared, locale-aware formatters in `@commise/features-core`, so web and mobile
 * greet identically (FR-044).
 *
 * Reading the clock happens in render, and the surface is server-rendered then hydrated, so the server (its
 * timezone) and the client (the viewer's) can disagree on the hour or the calendar day. `suppressHydration
 * Warning` is the React-sanctioned answer for exactly this clock-derived text: the client value wins on
 * hydration with no console noise, and the greeting reflects where the VIEWER actually is.
 */
import { formatHomeDate, greetingBucketForHour } from '@commise/features-core';
import { useLocale, useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';

import { webMessages } from '@/i18n/messages';

/**
 * The Home greeting header.
 *
 * @returns The time-of-day greeting and the localized full-date subtitle.
 */
export function HomeGreeting(): JSX.Element {
    const { home } = useMessages(webMessages);
    const locale = useLocale();

    const now = new Date();
    const greeting = home.greetings[greetingBucketForHour(now.getHours())];
    const date = formatHomeDate(now, locale);

    return (
        <div>
            <h2 suppressHydrationWarning className="mb-1 font-display text-3xl font-bold text-charcoal">
                {greeting}
            </h2>
            <p suppressHydrationWarning className="text-slate">
                {date}
            </p>
        </div>
    );
}
