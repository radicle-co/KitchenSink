'use client';

/**
 * @module home/skeletons/MealPlanWidgetSkeleton — the "This Week's Meals" roadmap placeholder (web).
 *
 * Mirrors the mockup's weekly strip SHAPE — seven day tiles, each a weekday label over a meal thumbnail —
 * with a skeleton block where each meal would be. Feature 005 replaces it by registering a live `meal-plan`
 * widget; see `roadmapWidgets.ts`.
 *
 * The weekday labels are **real, locale-formatted data** (via `weekdayLabels`), so they are exposed to
 * assistive tech as a real list; only the MEAL is unknown, and only the meal is a skeleton block. The
 * mockup's "See all →" control is omitted entirely — it has nowhere to go.
 */
import type { JSX } from 'react';

import { weekdayLabels } from '@commise/features-core';
import { useLocale, useMessages } from '@commise/i18n/react';

import { webMessages } from '@/i18n/messages';

import { PlaceholderWidgetCard } from './PlaceholderWidgetCard';

/**
 * The meal-plan widget's skeleton placeholder: the week as seven equal tiles (`buildSpec.md` §4.2, `repeat(7, 1fr)`).
 *
 * A tile shows the narrow name ("M") below the regular container and the short one ("Mon") above it, and is announced
 * by the full weekday. Seven columns fit 320 px with no sideways scroller, which a keyboard could not reach (F16). The
 * strip borrows 4 px of the card's padding at each side below `@regular`, so a tile keeps the spec's 36 px at 320.
 *
 * @returns The week strip's shape: real weekdays, no meals.
 */
export function MealPlanWidgetSkeleton(): JSX.Element {
    const { home } = useMessages(webMessages);
    const locale = useLocale();
    const narrow = weekdayLabels(locale, 'narrow');
    const short = weekdayLabels(locale, 'short');

    return (
        <PlaceholderWidgetCard title={home.roadmap.titles['meal-plan']}>
            <ul className="-mx-1 grid grid-cols-7 gap-0.5 @regular/main:mx-0 @regular/main:gap-2">
                {weekdayLabels(locale, 'long').map((day, index) => (
                    <li
                        key={day}
                        className="flex min-w-0 flex-col items-center gap-2 rounded-sm border border-line-divider px-0.5 py-2"
                    >
                        <span aria-hidden="true" className="text-caption text-ink-muted @regular/main:hidden">
                            {narrow[index]}
                        </span>
                        <span aria-hidden="true" className="hidden text-caption text-ink-muted @regular/main:inline">
                            {short[index]}
                        </span>
                        <span className="sr-only">{day}</span>
                        {/* The meal thumbnail — the only unknown on this tile. */}
                        <div aria-hidden="true" className="aspect-square w-full max-w-12 rounded-sm bg-surface-muted" />
                    </li>
                ))}
            </ul>
        </PlaceholderWidgetCard>
    );
}
