'use client';

/**
 * @module home/skeletons/ResumeCookingWidgetSkeleton — the "Resume cooking" roadmap placeholder (web).
 *
 * Mirrors the mockup's resume-cooking strip SHAPE — a 64px thumbnail, a title line, a progress bar, and a
 * trailing action — with skeleton blocks throughout. Feature 009 replaces it by registering a live
 * `resume-cooking` widget; see `roadmapWidgets.ts`.
 *
 * The mockup's "Continue" button is rendered as a **shape, not a button**: a real control here would either
 * do nothing (a broken affordance) or need a destination that does not exist. A placeholder must not offer an
 * action it cannot honour.
 */
import type { JSX } from 'react';

import { useMessages } from '@commise/i18n/react';

import { webMessages } from '@/i18n/messages';

import { PlaceholderWidgetCard } from './PlaceholderWidgetCard';

/**
 * The resume-cooking widget's skeleton placeholder.
 *
 * @returns The resume-cooking strip's shape with no session data in it.
 */
export function ResumeCookingWidgetSkeleton(): JSX.Element {
    const { home } = useMessages(webMessages);

    return (
        <PlaceholderWidgetCard title={home.roadmap.titles['resume-cooking']}>
            <div aria-hidden="true" className="flex items-center gap-4">
                {/* The 64px recipe thumbnail. */}
                <div className="size-16 shrink-0 rounded-xl bg-pearl" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {/* The in-progress recipe's title, then its progress bar (an empty track — any filled
                        width would assert a real progress figure). */}
                    <div className="h-4 w-3/4 rounded bg-pearl" />
                    <div className="h-1 w-full rounded-full bg-pearl" />
                </div>
                {/* The "Continue" action, as a shape. */}
                <div className="h-9 w-24 shrink-0 rounded-full bg-pearl" />
            </div>
        </PlaceholderWidgetCard>
    );
}
