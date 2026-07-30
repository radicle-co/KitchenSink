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
 * The meal-plan widget's skeleton placeholder.
 *
 * @returns The week strip's shape: real weekdays, no meals.
 */
export function MealPlanWidgetSkeleton(): JSX.Element {
    const { home } = useMessages(webMessages);
    const locale = useLocale();

    return (
        <PlaceholderWidgetCard title={home.roadmap.titles['meal-plan']}>
            <ul className="flex gap-3 overflow-x-auto pb-1">
                {weekdayLabels(locale).map((day) => (
                    <li
                        key={day}
                        className="flex w-24 shrink-0 flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-white/30 bg-white/50 p-3"
                    >
                        <span className="text-xs font-medium uppercase tracking-wider text-slate">{day}</span>
                        {/* The meal thumbnail — the only unknown on this tile. */}
                        <div aria-hidden="true" className="size-12 rounded-xl bg-pearl" />
                    </li>
                ))}
            </ul>
        </PlaceholderWidgetCard>
    );
}
