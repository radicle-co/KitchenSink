/**
 * @module The kept record's timer and the reducer's timer are two shapes of one thing: the record holds ISO instants
 * and a `state`, the reducer holds ms and a `kind`. This module is the only place that turns one into the other, so
 * neither shape learns the other. The label is never stored (ADR-0094 section 2): it is dropped on the way
 * out and absent on the way in, and the caller derives it from the matched step (R8a).
 *
 * @pattern Adapter — converts between the persisted timer and the cooking-core timer.
 */
import type { ActiveTimer, TimerBase } from '@kitchensink/cooking-core';

import type { KeptTimer } from './keptRecord.js';

/** What both shapes carry under the same name. */
function sharedOf(timer: KeptTimer): Omit<TimerBase, 'label'> {
    const { id, run, recipeId, stepIndex, stepDigest, ordinal, durationMs, origin } = timer;

    return { id, run, recipeId, stepIndex, stepDigest, ordinal, durationMs, origin };
}

/**
 * The reducer's timer for a stored one.
 *
 * @param timer - A timer read from the record.
 * @returns The same timer in ms, with no label. Pure.
 */
export function activeTimerOf(timer: KeptTimer): ActiveTimer {
    const shared = { ...sharedOf(timer), label: undefined };

    switch (timer.state) {
        case 'running':
            return { ...shared, kind: 'running', endsAt: Date.parse(timer.endsAt) };
        case 'paused':
            return { ...shared, kind: 'paused', remainingMs: timer.remainingMs };
        case 'ringing':
            return { ...shared, kind: 'ringing', endedAt: Date.parse(timer.endedAt) };
        case 'endedAway':
            return { ...shared, kind: 'endedAway', endedAt: Date.parse(timer.endedAt) };
    }
}

/**
 * The stored form of a reducer's timer.
 *
 * `pausedAt` is the instant a pause was made, which the reducer does not hold: it carries over from a paused prior,
 * else it is `nowMs`, the clock of the command that paused it. `announcedAt` belongs to an ended-away timer's run, so
 * it carries only from an ended-away prior of the same run.
 *
 * @param timer - The timer as the reducer holds it. Its label is not written.
 * @param prior - The stored timer of the same id before this change, when there was one.
 * @param nowMs - The clock of the change, in ms.
 * @returns The timer as the record holds it. Pure.
 */
export function keptTimerOf(timer: ActiveTimer, prior: KeptTimer | undefined, nowMs: number): KeptTimer {
    const { id, run, recipeId, stepIndex, stepDigest, ordinal, durationMs, origin } = timer;
    const shared = { id, run, recipeId, stepIndex, stepDigest, ordinal, durationMs, origin };

    switch (timer.kind) {
        case 'running':
            return { ...shared, state: 'running', endsAt: new Date(timer.endsAt).toISOString() };
        case 'paused':
            return {
                ...shared,
                state: 'paused',
                remainingMs: timer.remainingMs,
                pausedAt: prior?.state === 'paused' ? prior.pausedAt : new Date(nowMs).toISOString(),
            };
        case 'ringing':
            return { ...shared, state: 'ringing', endedAt: new Date(timer.endedAt).toISOString() };
        case 'endedAway': {
            const announcedAt = prior?.state === 'endedAway' && prior.run === run ? prior.announcedAt : undefined;

            return {
                ...shared,
                state: 'endedAway',
                endedAt: new Date(timer.endedAt).toISOString(),
                ...(announcedAt === undefined ? {} : { announcedAt }),
            };
        }
    }
}
