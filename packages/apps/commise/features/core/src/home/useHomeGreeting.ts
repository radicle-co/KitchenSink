/**
 * @module @commise/features-core/home — Home's title and date line, read from the viewer's clock (FR-044: web and
 * mobile greet identically). Web's hydration placeholder and mobile's condensed title bar stay in the apps.
 */
import { useLocale, useMessages } from '@commise/i18n/react';

import { formatHomeDate } from '../utils/formatDate.js';
import { homeGreetingOf } from './homeGreeting.js';
import { homeMessages } from './messages.js';

/** Home's two header lines. */
export interface HomeGreeting {
    /** The time-of-day greeting, with the cook's name when there is one. */
    readonly title: string;
    /** The viewer's local calendar date, long form, in their locale. */
    readonly subtitle: string;
}

/**
 * Home's title for the viewer's LOCAL hour and the date under it, from one reading of the clock so the two lines can
 * never disagree across midnight.
 *
 * @param name - The cook's display name, if any.
 * @returns The title and the date line.
 * @sideEffect Reads the clock.
 */
export function useHomeGreeting(name: string | undefined): HomeGreeting {
    const copy = useMessages(homeMessages);
    const locale = useLocale();
    const now = new Date();

    return { title: homeGreetingOf(copy, name, now.getHours()), subtitle: formatHomeDate(now, locale) };
}
