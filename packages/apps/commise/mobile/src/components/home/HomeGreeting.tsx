/**
 * @module home/HomeGreeting — Home's large title on native (US-000 / FR-046; `docs/design/uiOverhaul/buildSpec.md`
 * §4.2): the time-of-day greeting as the screen's header, "Good afternoon, Eliza" ("Good afternoon" without a name),
 * over the local calendar date, drawn by the design system's `LargeTitleHeader` with the avatar as its action.
 *
 * Both lines derive from the viewer's local clock via the SHARED formatters in `@commise/features-core`
 * ({@link greetingBucketForHour} + {@link formatHomeDate}), so web and mobile greet identically (FR-044). The surface is
 * client-rendered on device, so (unlike web) there is no hydration concern — reading the clock in render is fine.
 */
import { formatHomeDate, greetingBucketForHour } from '@commise/features-core';
import { useLocale, useMessages } from '@commise/i18n/react';
import { LargeTitleHeader, type HeaderAction } from '@commise/ui/large-title-header';
import type { JSX } from 'react';

import { mobileMessages } from '../../i18n/messages.js';

/** The id of Home's large title. */
export const HOME_TITLE_ID = 'home-title';

/**
 * Home's title now: the greeting for the hour, with the cook's name when there is one.
 *
 * @param name - The cook's display name, if any.
 * @returns The greeting.
 * @sideEffect Reads the clock.
 */
export function useHomeGreeting(name: string | undefined): string {
    const { home } = useMessages(mobileMessages);
    const bucket = greetingBucketForHour(new Date().getHours());

    return name === undefined ? home.greetings[bucket] : home.greetingsNamed[bucket].replace('{name}', name);
}

/** Props for {@link HomeGreeting}. */
export interface HomeGreetingProps {
    /** The cook's display name, if any. */
    readonly name?: string;
    /** The header's action: the avatar. */
    readonly action?: HeaderAction;
}

/**
 * Home's large title (native).
 *
 * @param props - The cook's name and the header's action.
 * @returns The greeting as the header and the localized full date under it.
 */
export function HomeGreeting({ name, action }: HomeGreetingProps = {}): JSX.Element {
    const locale = useLocale();
    const greeting = useHomeGreeting(name);

    return (
        <LargeTitleHeader
            headingId={HOME_TITLE_ID}
            title={greeting}
            subtitle={formatHomeDate(new Date(), locale)}
            {...(action === undefined ? {} : { action })}
        />
    );
}
