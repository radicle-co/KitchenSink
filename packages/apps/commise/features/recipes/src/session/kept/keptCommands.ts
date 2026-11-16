/**
 * @module Every change to the kept record, as a value (plan 0003 KTD5, blueprint S57). The store runs a command
 * inside its exclusive section against the document as re-read, so a stale tab can never overwrite another tab's work.
 *
 * @pattern Command — a discriminated union applied by one pure reducer with an exhaustive switch (the Visitor).
 */
import { matchStep, matchStepStrict } from '@kitchensink/cooking-core';

import { sessionClock, timerClock } from './sessionClock.js';
import type { KeptDocument, KeptEntry, KeptTimer, LineTickRef, StepMark } from './keptRecord.js';

/** S4a keeps S3's one-timer rule in the command, not in the format (plan 0003 KTD1). */
const TIMER_LIMIT = 1;

/** The timer a start command creates. The id is a UUIDv7 minted by the caller, so the reducer stays pure. */
export interface NewTimer {
    readonly id: string;
    readonly recipeId: string;
    readonly stepIndex: number;
    readonly stepDigest: string;
    readonly endsAt: string;
}

/** What a timer command was issued against; a command whose expectation no longer holds is dropped (KTD9a). */
export interface TimerExpectation {
    readonly state: KeptTimer['state'];
    readonly endsAt?: string | undefined;
}

/** The snapshot End keeps in memory for Undo (KTD13). */
export interface EndedSnapshot {
    readonly recipeId: string;
    readonly entry: KeptEntry;
    readonly timers: readonly KeptTimer[];
}

export type KeptCommand =
    | { readonly type: 'tickPage'; readonly recipeId: string; readonly ingredientId: string; readonly ticked: boolean }
    | { readonly type: 'startSession'; readonly recipeId: string; readonly step: StepMark }
    /** Resume's "Start from step 1": ends the session and starts a new one. */
    | { readonly type: 'resetSession'; readonly recipeId: string; readonly step: StepMark }
    | { readonly type: 'setStep'; readonly recipeId: string; readonly step: StepMark }
    | { readonly type: 'tickLine'; readonly recipeId: string; readonly line: LineTickRef; readonly ticked: boolean }
    /** Keeps the recipe's timers (S3 R12a). */
    | { readonly type: 'finish'; readonly recipeId: string }
    /** Removes the entry and its timers. */
    | { readonly type: 'endSession'; readonly recipeId: string }
    | {
          readonly type: 'restoreSession';
          readonly snapshot: EndedSnapshot;
          readonly stepDigests: readonly string[] | undefined;
      }
    | { readonly type: 'startTimer'; readonly timer: NewTimer; readonly stepDigests: readonly string[] }
    | {
          readonly type: 'pauseTimer' | 'resumeTimer' | 'cancelTimer';
          readonly id: string;
          readonly expect: TimerExpectation;
      }
    /** Moves a recipe's step, marks, line ticks and timers onto the recipe's current steps (KTD7, B1, B6). */
    | { readonly type: 'rebind'; readonly recipeId: string; readonly stepDigests: readonly string[] }
    | { readonly type: 'prune' };

export type KeptOutcome =
    | { readonly kind: 'applied'; readonly doc: KeptDocument }
    /** No write: a no-op, or a stale command dropped. */
    | { readonly kind: 'unchanged' }
    /** `startSession` over an existing cooking entry (D45): nothing written, open at this step. */
    | { readonly kind: 'joined'; readonly step: StepMark }
    | { readonly kind: 'refused'; readonly reason: 'timerLimit' };

const UNCHANGED: KeptOutcome = { kind: 'unchanged' };

const applied = (doc: KeptDocument, patch: Partial<Pick<KeptDocument, 'entries' | 'timers'>>): KeptOutcome => ({
    kind: 'applied',
    doc: { ...doc, ...patch, rev: doc.rev + 1 },
});

const withEntry = (doc: KeptDocument, recipeId: string, entry: KeptEntry): KeptDocument['entries'] => ({
    ...doc.entries,
    [recipeId]: entry,
});

function withoutEntry(entries: KeptDocument['entries'], recipeId: string): KeptDocument['entries'] {
    return Object.fromEntries(Object.entries(entries).filter(([id]) => id !== recipeId));
}

/**
 * @param timers - Timers held.
 * @param recipeId - The recipe.
 * @param stepIndex - The matched step.
 * @returns The lowest positive ordinal no timer of that recipe and step holds, in any state. A missing ordinal reads as
 * 1 (B2, B3).
 */
export function lowestFreeOrdinal(timers: readonly KeptTimer[], recipeId: string, stepIndex: number): number {
    const used = new Set(
        timers.filter((t) => t.recipeId === recipeId && t.stepIndex === stepIndex).map((t) => t.ordinal ?? 1),
    );
    let ordinal = 1;

    while (used.has(ordinal)) {
        ordinal += 1;
    }

    return ordinal;
}

/** Timers of one recipe follow their step; a clash on the new step takes the lowest free ordinal there (B6). */
function rebindTimerList(
    timers: readonly KeptTimer[],
    recipeId: string,
    stepDigests: readonly string[],
): readonly KeptTimer[] {
    if (stepDigests.length === 0) {
        return timers;
    }

    const result = [...timers];

    result.forEach((timer, i) => {
        if (timer.recipeId !== recipeId) {
            return;
        }

        const matched = matchStep({ index: timer.stepIndex, digest: timer.stepDigest }, stepDigests) ?? timer.stepIndex;

        if (matched === timer.stepIndex) {
            return;
        }

        const others = result.filter((_, j) => j !== i);
        const clash = others.some(
            (o) => o.recipeId === recipeId && o.stepIndex === matched && (o.ordinal ?? 1) === (timer.ordinal ?? 1),
        );

        result[i] = {
            ...timer,
            stepIndex: matched,
            ...(clash ? { ordinal: lowestFreeOrdinal(others, recipeId, matched) } : {}),
        };
    });

    return result;
}

function rebindEntry(entry: KeptEntry, stepDigests: readonly string[]): KeptEntry {
    if (entry.kind === 'page' || stepDigests.length === 0) {
        return entry;
    }

    const step = matchStep(entry.step, stepDigests) ?? entry.step.index;
    const marks = entry.marks.flatMap((mark) => {
        const index = matchStepStrict(mark, stepDigests);

        return index === undefined ? [] : [{ index, digest: mark.digest }];
    });
    const lineTicks = entry.lineTicks.flatMap((tick) => {
        const stepIndex = matchStepStrict({ index: tick.stepIndex, digest: tick.stepDigest }, stepDigests);

        return stepIndex === undefined ? [] : [{ ...tick, stepIndex }];
    });

    return { ...entry, step: { index: step, digest: entry.step.digest }, marks, lineTicks };
}

const sameTick = (a: LineTickRef, b: LineTickRef): boolean =>
    a.stepIndex === b.stepIndex && a.stepDigest === b.stepDigest && a.lineIndex === b.lineIndex;

function tickPage(doc: KeptDocument, c: Extract<KeptCommand, { type: 'tickPage' }>, now: string): KeptOutcome {
    const entry = doc.entries[c.recipeId];
    const ticks = entry?.ticks ?? [];

    if (ticks.includes(c.ingredientId) === c.ticked) {
        return UNCHANGED;
    }

    const next = c.ticked ? [...ticks, c.ingredientId] : ticks.filter((id) => id !== c.ingredientId);
    const updated: KeptEntry =
        entry === undefined ? { kind: 'page', ticks: next, lastTouch: now } : { ...entry, ticks: next, lastTouch: now };

    return applied(doc, { entries: withEntry(doc, c.recipeId, updated) });
}

function startSession(doc: KeptDocument, recipeId: string, step: StepMark, now: string): KeptOutcome {
    const entry = doc.entries[recipeId];

    if (entry?.kind === 'cooking') {
        return { kind: 'joined', step: entry.step };
    }

    const started: KeptEntry = {
        kind: 'cooking',
        step,
        marks: [],
        lineTicks: [],
        ticks: entry?.ticks ?? [],
        ...(entry?.servings === undefined ? {} : { servings: entry.servings }),
        lastTouch: now,
    };

    return applied(doc, { entries: withEntry(doc, recipeId, started) });
}

function resetSession(doc: KeptDocument, recipeId: string, step: StepMark, now: string): KeptOutcome {
    const started: KeptEntry = { kind: 'cooking', step, marks: [], lineTicks: [], ticks: [], lastTouch: now };

    return applied(doc, {
        entries: withEntry(doc, recipeId, started),
        timers: doc.timers.filter((t) => t.recipeId !== recipeId),
    });
}

function onCooking(
    doc: KeptDocument,
    recipeId: string,
    change: (entry: Extract<KeptEntry, { kind: 'cooking' }>) => KeptEntry | undefined,
): KeptOutcome {
    const entry = doc.entries[recipeId];
    const next = entry?.kind === 'cooking' ? change(entry) : undefined;

    return next === undefined ? UNCHANGED : applied(doc, { entries: withEntry(doc, recipeId, next) });
}

function restoreSession(doc: KeptDocument, c: Extract<KeptCommand, { type: 'restoreSession' }>): KeptOutcome {
    const { snapshot, stepDigests } = c;
    const existing = doc.entries[snapshot.recipeId];

    if (existing?.kind === 'cooking') {
        return UNCHANGED;
    }

    if (doc.timers.length + snapshot.timers.length > TIMER_LIMIT) {
        return { kind: 'refused', reason: 'timerLimit' };
    }

    let entry = snapshot.entry;

    if (existing !== undefined) {
        const existingLater = Date.parse(existing.lastTouch) > Date.parse(entry.lastTouch);
        const servings = (existingLater ? existing : entry).servings ?? (existingLater ? entry : existing).servings;
        const { servings: _drop, ...rest } = entry;

        entry = {
            ...rest,
            ticks: [...new Set([...entry.ticks, ...existing.ticks])],
            ...(servings === undefined ? {} : { servings }),
            lastTouch: existingLater ? existing.lastTouch : entry.lastTouch,
        } as KeptEntry;
    }

    const timers = [...doc.timers, ...snapshot.timers];

    return applied(doc, {
        entries: withEntry(doc, snapshot.recipeId, entry),
        timers: stepDigests === undefined ? timers : rebindTimerList(timers, snapshot.recipeId, stepDigests),
    });
}

function startTimer(doc: KeptDocument, c: Extract<KeptCommand, { type: 'startTimer' }>): KeptOutcome {
    if (doc.timers.length >= TIMER_LIMIT) {
        return { kind: 'refused', reason: 'timerLimit' };
    }

    const held = rebindTimerList(doc.timers, c.timer.recipeId, c.stepDigests);
    const timer: KeptTimer = {
        ...c.timer,
        state: 'running',
        ordinal: lowestFreeOrdinal(held, c.timer.recipeId, c.timer.stepIndex),
    };

    return applied(doc, { timers: [...held, timer] });
}

function timerCommand(doc: KeptDocument, c: Extract<KeptCommand, { id: string }>, now: string): KeptOutcome {
    const timer = doc.timers.find((t) => t.id === c.id);

    if (
        timer === undefined ||
        timer.state !== c.expect.state ||
        (c.expect.endsAt !== undefined && timer.endsAt !== c.expect.endsAt)
    ) {
        return UNCHANGED;
    }

    const replace = (next: KeptTimer | undefined): KeptOutcome =>
        applied(doc, { timers: doc.timers.flatMap((t) => (t.id !== c.id ? [t] : next === undefined ? [] : [next])) });

    if (c.type === 'cancelTimer') {
        return replace(undefined);
    }

    const { endsAt, remainingMs, pausedAt: _pausedAt, ...rest } = timer;

    if (c.type === 'pauseTimer') {
        return replace({
            ...rest,
            state: 'paused',
            remainingMs: Math.max(0, Date.parse(endsAt ?? now) - Date.parse(now)),
            pausedAt: now,
        });
    }

    return replace({ ...rest, state: 'running', endsAt: new Date(Date.parse(now) + (remainingMs ?? 0)).toISOString() });
}

function prune(doc: KeptDocument, now: string): KeptOutcome {
    const ended = new Set(
        Object.entries(doc.entries)
            .filter(
                ([id, entry]) =>
                    sessionClock(
                        entry,
                        doc.timers.filter((t) => t.recipeId === id),
                        now,
                    ) === 'ended',
            )
            .map(([id]) => id),
    );
    const entries = Object.fromEntries(Object.entries(doc.entries).filter(([id]) => !ended.has(id)));
    const timers = doc.timers.filter((t) => {
        if (ended.has(t.recipeId) && doc.entries[t.recipeId]?.kind === 'cooking') {
            return false;
        }

        return timerClock(t, entries[t.recipeId]?.kind === 'cooking', now) === 'kept';
    });

    return ended.size === 0 && timers.length === doc.timers.length ? UNCHANGED : applied(doc, { entries, timers });
}

function rebind(doc: KeptDocument, c: Extract<KeptCommand, { type: 'rebind' }>): KeptOutcome {
    const entry = doc.entries[c.recipeId];
    const entries = entry === undefined ? doc.entries : withEntry(doc, c.recipeId, rebindEntry(entry, c.stepDigests));
    const timers = rebindTimerList(doc.timers, c.recipeId, c.stepDigests);

    return JSON.stringify([entries, timers]) === JSON.stringify([doc.entries, doc.timers])
        ? UNCHANGED
        : applied(doc, { entries, timers });
}

/**
 * @param doc - The document as just re-read.
 * @param command - The change.
 * @param now - ISO instant from the injected clock.
 * @returns `applied` with the new document at `rev + 1`, or why nothing was written. Pure.
 */
export function applyKeptCommand(doc: KeptDocument, command: KeptCommand, now: string): KeptOutcome {
    switch (command.type) {
        case 'tickPage':
            return tickPage(doc, command, now);
        case 'startSession':
            return startSession(doc, command.recipeId, command.step, now);
        case 'resetSession':
            return resetSession(doc, command.recipeId, command.step, now);
        case 'setStep':
            return onCooking(doc, command.recipeId, (e) => ({ ...e, step: command.step, lastTouch: now }));
        case 'tickLine':
            return onCooking(doc, command.recipeId, (e) => {
                const has = e.lineTicks.some((t) => sameTick(t, command.line));

                if (has === command.ticked) {
                    return undefined;
                }

                const lineTicks = command.ticked
                    ? [...e.lineTicks, command.line]
                    : e.lineTicks.filter((t) => !sameTick(t, command.line));

                return { ...e, lineTicks, lastTouch: now };
            });
        case 'finish':
            return doc.entries[command.recipeId]?.kind === 'cooking'
                ? applied(doc, { entries: withoutEntry(doc.entries, command.recipeId) })
                : UNCHANGED;
        case 'endSession':
            return doc.entries[command.recipeId] === undefined &&
                !doc.timers.some((t) => t.recipeId === command.recipeId)
                ? UNCHANGED
                : applied(doc, {
                      entries: withoutEntry(doc.entries, command.recipeId),
                      timers: doc.timers.filter((t) => t.recipeId !== command.recipeId),
                  });
        case 'restoreSession':
            return restoreSession(doc, command);
        case 'startTimer':
            return startTimer(doc, command);
        case 'pauseTimer':
        case 'resumeTimer':
        case 'cancelTimer':
            return timerCommand(doc, command, now);
        case 'rebind':
            return rebind(doc, command);
        case 'prune':
            return prune(doc, now);
    }
}

/**
 * @param doc - The document.
 * @param recipeId - The recipe being ended.
 * @returns What Undo needs to bring the entry and its timers back, or `undefined` when there is no entry.
 */
export function snapshotForEnd(doc: KeptDocument, recipeId: string): EndedSnapshot | undefined {
    const entry = doc.entries[recipeId];

    return entry === undefined
        ? undefined
        : { recipeId, entry, timers: doc.timers.filter((t) => t.recipeId === recipeId) };
}
