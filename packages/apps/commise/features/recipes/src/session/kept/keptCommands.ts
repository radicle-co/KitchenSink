/**
 * @module Every change to the kept record, as a value (ADR-0094 section 6). The store runs a command
 * inside its exclusive section against the document as re-read, so a stale tab can never overwrite another tab's work.
 *
 * @pattern Command — a discriminated union applied by one pure reducer with an exhaustive switch (the Visitor).
 */
import { matchStep, matchStepStrict } from '@kitchensink/cooking-core';

import { sessionClock, timerClock } from './sessionClock.js';
import type { CookingEntry, KeptDocument, KeptEntry, KeptTimer, LineTickRef, StepMark } from './keptRecord.js';

/** The snapshot End keeps in memory for Undo (ADR-0094 section 8). */
export interface EndedSnapshot {
    readonly recipeId: string;
    readonly entry: CookingEntry;
    readonly timers: readonly KeptTimer[];
}

export type KeptCommand =
    | { readonly type: 'tickPage'; readonly recipeId: string; readonly ingredientId: string; readonly ticked: boolean }
    | { readonly type: 'startSession'; readonly recipeId: string; readonly step: StepMark }
    /** Resume's "Start from step 1": ends the session and starts a new one. */
    | { readonly type: 'resetSession'; readonly recipeId: string; readonly step: StepMark }
    | { readonly type: 'setStep'; readonly recipeId: string; readonly step: StepMark }
    | { readonly type: 'tickLine'; readonly recipeId: string; readonly line: LineTickRef; readonly ticked: boolean }
    /** Keeps the recipe's timers (ADR-0094 section 2). */
    | { readonly type: 'finish'; readonly recipeId: string }
    /** Removes the entry and its timers. */
    | { readonly type: 'endSession'; readonly recipeId: string }
    | { readonly type: 'restoreSession'; readonly snapshot: EndedSnapshot }
    /** Moves a recipe's step, marks and line ticks onto the recipe's current steps (ADR-0094 section 9). The timers move in the S4a timer unit, through the reducer's `rematch`. */
    | { readonly type: 'rebind'; readonly recipeId: string; readonly stepDigests: readonly string[] }
    | { readonly type: 'prune' };

export type KeptOutcome =
    | { readonly kind: 'applied'; readonly doc: KeptDocument }
    /** No write: a no-op, or a stale command dropped. */
    | { readonly kind: 'unchanged' }
    /** `startSession` over an existing cooking entry (ADR-0094 section 2): nothing written, open at this step. */
    | { readonly kind: 'joined'; readonly step: StepMark };

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
    change: (entry: CookingEntry) => CookingEntry | undefined,
): KeptOutcome {
    const entry = doc.entries[recipeId];
    const next = entry?.kind === 'cooking' ? change(entry) : undefined;

    return next === undefined ? UNCHANGED : applied(doc, { entries: withEntry(doc, recipeId, next) });
}

function restoreSession(doc: KeptDocument, c: Extract<KeptCommand, { type: 'restoreSession' }>): KeptOutcome {
    const { snapshot } = c;
    const existing = doc.entries[snapshot.recipeId];

    if (existing?.kind === 'cooking') {
        return UNCHANGED;
    }

    let entry: CookingEntry = snapshot.entry;

    if (existing !== undefined) {
        const existingLater = Date.parse(existing.lastTouch) > Date.parse(entry.lastTouch);
        const servings = (existingLater ? existing : entry).servings ?? (existingLater ? entry : existing).servings;
        const { servings: _drop, ...rest } = entry;

        entry = {
            ...rest,
            ticks: [...new Set([...entry.ticks, ...existing.ticks])],
            ...(servings === undefined ? {} : { servings }),
            lastTouch: existingLater ? existing.lastTouch : entry.lastTouch,
        };
    }

    return applied(doc, {
        entries: withEntry(doc, snapshot.recipeId, entry),
        // The timer limit is not applied here: T3 applies it through `reduceTimer`'s `restore` (ADR-0094 section 2).
        timers: [...doc.timers, ...snapshot.timers],
    });
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

    // Both sides are built in the same key order, so string equality means no change.
    return JSON.stringify(entries) === JSON.stringify(doc.entries) ? UNCHANGED : applied(doc, { entries });
}

/**
 * Applies one change to the document as just re-read.
 *
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
        case 'rebind':
            return rebind(doc, command);
        case 'prune':
            return prune(doc, now);
    }
}

/**
 * Captures what End removes, for Undo.
 *
 * @param doc - The document.
 * @param recipeId - The recipe being ended.
 * @returns What Undo needs to bring the entry and its timers back, or `undefined` unless the recipe has a `cooking`
 * entry (End only ever ends a session).
 */
export function snapshotForEnd(doc: KeptDocument, recipeId: string): EndedSnapshot | undefined {
    const entry = doc.entries[recipeId];

    if (entry?.kind !== 'cooking') {
        return undefined;
    }

    return { recipeId, entry, timers: doc.timers.filter((t) => t.recipeId === recipeId) };
}
