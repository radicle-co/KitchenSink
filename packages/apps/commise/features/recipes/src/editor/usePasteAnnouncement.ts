'use client';

/**
 * @module @commise/features-recipes/editor — what a paste's ONE polite region says, and when (UX spec, plan
 * 2026-10-15-011). It speaks at milestones only — the paste starting, a line needing the cook, the whole paste
 * stalling, going offline, and work moving again — never per row, and at most once per
 * {@link PASTE_ANNOUNCE_INTERVAL_MS}. Inside the interval the newest milestone waits; when the interval ends it is said
 * only if the paste's condition still differs from the one last said, so a stall that clears in a few seconds is never
 * announced at all.
 *
 * @pattern Observer — over the paste's condition, throttled by a timer
 */
import { useEffect, useState } from 'react';

import type { PasteMilestone } from '../form/props.js';
import { milestoneOnChange, type PasteCondition } from './pasteProgress.js';

/** The least time between two things said, in milliseconds. Judgement (UX spec), not a standard. */
export const PASTE_ANNOUNCE_INTERVAL_MS = 10_000;

/** One thing said: the leaf words it; `occurrence` moves so the same words are said again. */
export interface PasteAnnouncement {
    readonly milestone: PasteMilestone;
    /** The lines it is about: the paste's size when it starts, the lines needing the cook when they do. */
    readonly count: number;
    readonly occurrence: number;
}

/** The announcer's memory. */
interface Announcer {
    readonly session: string | undefined;
    readonly condition: PasteCondition | undefined;
    readonly said: (PasteAnnouncement & { readonly at: number; readonly condition: PasteCondition }) | undefined;
    readonly owed: { readonly milestone: PasteMilestone; readonly count: number } | undefined;
}

const QUIET: Announcer = { session: undefined, condition: undefined, said: undefined, owed: undefined };

/** Say `milestone` now. Pure. */
function say(
    current: Announcer,
    milestone: PasteMilestone,
    count: number,
    condition: PasteCondition,
    now: number,
): Announcer {
    return {
        ...current,
        condition,
        owed: undefined,
        said: { milestone, count, occurrence: (current.said?.occurrence ?? 0) + 1, at: now, condition },
    };
}

/**
 * Take in the paste's condition as it is now: a change worth saying is OWED, and the timer decides when it is said.
 *
 * @returns The same object when nothing changed. Pure.
 */
function observe(
    current: Announcer,
    session: string | undefined,
    condition: PasteCondition | undefined,
    count: number,
): Announcer {
    if (session === undefined || condition === undefined) {
        return { ...current, session, condition: undefined, owed: undefined };
    }

    const previous = current.session === session ? current.condition : undefined;
    const milestone = milestoneOnChange(previous, condition);

    return {
        ...current,
        session,
        condition,
        // A start not yet said stays owed: the paste's first words are that it started.
        owed: current.owed?.milestone === 'started' || milestone === undefined ? current.owed : { milestone, count },
    };
}

/** How long what is owed must wait: nothing for a paste starting or after a quiet interval. Pure. */
function waitFor(current: Announcer, now: number): number {
    if (current.said === undefined || current.owed?.milestone === 'started') {
        return 0;
    }

    return Math.max(0, current.said.at + PASTE_ANNOUNCE_INTERVAL_MS - now);
}

/** The interval has passed: say what is owed, unless the paste is back where it was when last spoken of. Pure. */
function flush(current: Announcer, now: number): Announcer {
    const { owed, condition } = current;

    if (owed === undefined || condition === undefined) {
        return current;
    }

    // A paste starting is always said; anything else only if the paste is not back where it was when last spoken of.
    if (owed.milestone !== 'started' && current.said?.condition === condition) {
        return { ...current, owed: undefined };
    }

    return say(current, owed.milestone, owed.count, condition, now);
}

/**
 * The polite region's words for one paste.
 *
 * @param session - The paste's job id, or `undefined` when no paste is unfinished.
 * @param condition - The paste's condition (`pasteMilestoneOf`), or `undefined` before its job is read.
 * @param count - The lines the condition is about.
 * @returns What to say, or `undefined` when nothing is (the finish is the `added` region's).
 * @sideEffect Schedules a timer while a milestone waits out the interval.
 */
export function usePasteAnnouncement(
    session: string | undefined,
    condition: PasteCondition | undefined,
    count: number,
): PasteAnnouncement | undefined {
    const [state, setState] = useState<Announcer>(QUIET);

    // The condition moved: what it is worth saying is owed. Adjusted during render (React's "information from previous
    // renders" pattern), because it reads no clock — the timer below does.
    if (state.session !== session || state.condition !== condition) {
        setState(observe(state, session, condition, count));
    }

    const { owed, said } = state;

    // @sideEffect Waits out the interval (or nothing, for a start or after a quiet spell), then says what is owed.
    useEffect(() => {
        if (owed === undefined) {
            return undefined;
        }

        const timer = setTimeout(
            () => setState((current) => flush(current, Date.now())),
            waitFor({ ...QUIET, owed, said }, Date.now()),
        );

        return () => clearTimeout(timer);
    }, [owed, said]);

    if (session === undefined || said === undefined) {
        return undefined;
    }

    return { milestone: said.milestone, count: said.count, occurrence: said.occurrence };
}
