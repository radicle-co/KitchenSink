'use client';

/**
 * @module home/skeletons/NutritionWidgetSkeleton — the "Today's Nutrition" roadmap placeholder (web).
 *
 * Mirrors the mockup's nutrition panel SHAPE — a 64px progress ring beside a calorie block — with skeleton
 * blocks where the ring's percentage and the calorie figures would be. Feature 007 replaces it by registering
 * a live `nutrition` widget; see `roadmapWidgets.ts`.
 *
 * Every number in the mockup ("62%", "1,240", "of 2,000 cal") is deliberately absent: a hard-coded figure
 * would read to a viewer as their real intake, which is the specific harm CR-001 forbids.
 */
import type { JSX } from 'react';

import { useMessages } from '@commise/i18n/react';

import { webMessages } from '@/i18n/messages';

import { PlaceholderWidgetCard } from './PlaceholderWidgetCard';

/**
 * The nutrition widget's skeleton placeholder.
 *
 * @returns The nutrition panel's shape with no data in it.
 */
export function NutritionWidgetSkeleton(): JSX.Element {
    const { home } = useMessages(webMessages);

    return (
        <PlaceholderWidgetCard title={home.roadmap.titles.nutrition}>
            <div aria-hidden="true" className="flex items-center gap-5">
                {/* The 64px ring: an unfilled track, since a filled arc would assert a real percentage. */}
                <div className="size-16 shrink-0 rounded-full border-4 border-pearl" />
                <div className="flex flex-1 flex-col gap-2">
                    {/* "CALORIES" overline, the figure, and the "of N cal" caption — as blocks, not values. */}
                    <div className="h-3 w-20 rounded bg-pearl" />
                    <div className="h-7 w-28 rounded bg-pearl" />
                    <div className="h-3 w-24 rounded bg-pearl" />
                </div>
            </div>
        </PlaceholderWidgetCard>
    );
}
