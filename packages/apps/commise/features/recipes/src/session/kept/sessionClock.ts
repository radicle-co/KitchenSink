/**
 * @module The kept record's idle and end policy (plan 0003 KTD6). Pure: the clock is an argument, and no background job
 * runs. The schema refuses an unparseable instant before these functions run, so they assume valid instants.
 *
 * @pattern Specification — two predicates over a session or a timer and a clock.
 */
import type { KeptEntry, KeptTimer } from './keptRecord.js';

const ASK_AFTER_MS = 4 * 60 * 60 * 1000;
const END_AFTER_MS = 24 * 60 * 60 * 1000;

export type SessionClockVerdict = 'resumeStraight' | 'askFirst' | 'ended';

const ms = (instant: string): number => Date.parse(instant);

/** The instant a timer that is not paused ends (or ended): `endsAt` while running, `endedAt` once it rang. */
function endOf(timer: Exclude<KeptTimer, { state: 'paused' }>): number {
    return ms(timer.state === 'running' ? timer.endsAt : timer.endedAt);
}

/**
 * Classifies a kept entry as resume straight, ask first or ended.
 *
 * @param entry - The recipe's kept entry.
 * @param recipeTimers - That recipe's timers (with several, the latest instant counts).
 * @param now - ISO instant.
 * @returns `resumeStraight`, `askFirst` (idle from 4 h) or `ended` (idle from 24 h). Idle runs from the later of the last
 * touch and every timer's end; a paused timer adds nothing; a clock that went back counts idle as 0. Every boundary is
 * "at or after". A `page` entry is only `resumeStraight` or `ended`, 24 h after its last touch.
 */
export function sessionClock(entry: KeptEntry, recipeTimers: readonly KeptTimer[], now: string): SessionClockVerdict {
    const anchor =
        entry.kind === 'page'
            ? ms(entry.lastTouch)
            : Math.max(ms(entry.lastTouch), ...recipeTimers.flatMap((t) => (t.state === 'paused' ? [] : [endOf(t)])));
    const idle = Math.max(0, ms(now) - anchor);

    if (idle >= END_AFTER_MS) {
        return 'ended';
    }

    return entry.kind === 'cooking' && idle >= ASK_AFTER_MS ? 'askFirst' : 'resumeStraight';
}

/**
 * Decides whether a timer is kept or removed.
 *
 * @param timer - A timer.
 * @param hasSession - Whether its recipe has a `cooking` entry.
 * @param now - ISO instant.
 * @returns `removed` for a session-less timer 24 h (at or after) past its end, or past `pausedAt` if paused. A timer
 * whose recipe has a session ends with that entry, never here.
 */
export function timerClock(timer: KeptTimer, hasSession: boolean, now: string): 'kept' | 'removed' {
    if (hasSession) {
        return 'kept';
    }

    const base = timer.state === 'paused' ? ms(timer.pausedAt) : endOf(timer);

    return ms(now) - base >= END_AFTER_MS ? 'removed' : 'kept';
}
