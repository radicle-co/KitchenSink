import type { KeptDocument, KeptEntry, KeptTimer, PausedTimer, RunningTimer } from '../keptRecord.js';

/** One base instant every case counts from. */
export const T0 = Date.parse('2026-06-01T12:00:00.000Z');
export const HOUR = 60 * 60 * 1000;
export const iso = (ms: number): string => new Date(ms).toISOString();

/** A valid UUIDv7 for timer number `n`. */
export const timerId = (n: number): string => `01890a5d-ac96-774b-8cb9-b22e1d4a${String(n).padStart(4, '0')}`;

export const makeCooking = (over: Partial<Extract<KeptEntry, { kind: 'cooking' }>> = {}): KeptEntry => ({
    kind: 'cooking',
    step: { index: 3, digest: 's1:0000000d' },
    marks: [],
    lineTicks: [],
    ticks: [],
    lastTouch: iso(T0),
    ...over,
});

export const makePage = (over: Partial<Extract<KeptEntry, { kind: 'page' }>> = {}): KeptEntry => ({
    kind: 'page',
    ticks: [],
    lastTouch: iso(T0),
    ...over,
});

const timerBase = { id: timerId(1), recipeId: 'r1', stepIndex: 3, stepDigest: 's1:0000000d', ordinal: 1 };

type Over<T> = Partial<Omit<T, 'state'>>;

export const makeTimer = (over: Over<RunningTimer> = {}): RunningTimer => ({
    ...timerBase,
    state: 'running',
    endsAt: iso(T0 + HOUR),
    ...over,
});

export const makePaused = (over: Over<PausedTimer> = {}): PausedTimer => ({
    ...timerBase,
    state: 'paused',
    remainingMs: HOUR,
    pausedAt: iso(T0),
    ...over,
});

export const makeEnded = (
    state: 'ringing' | 'endedAway',
    { announcedAt, ...over }: Over<RunningTimer> & { readonly endedAt?: string; readonly announcedAt?: string } = {},
): KeptTimer => {
    const base = { ...timerBase, endsAt: iso(T0), endedAt: iso(T0), ...over };

    return state === 'ringing'
        ? { ...base, state }
        : { ...base, state, ...(announcedAt === undefined ? {} : { announcedAt }) };
};

export const makeDoc = (over: Partial<KeptDocument> = {}): KeptDocument => ({
    v: 1,
    rev: 1,
    entries: {},
    timers: [],
    ...over,
});
