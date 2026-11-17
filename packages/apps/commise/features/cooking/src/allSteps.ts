/**
 * @module allSteps — the rows of All steps: which mark a step shows and which timers it carries.
 *
 * The rows are decided here and nowhere else, so no render component decides a mark or a timer part. The caller feeds
 * positions that are already matched to the recipe's current steps (the kept store's re-read does that), never a saved
 * index.
 *
 * @pattern Specification — `allStepsRowsOf` is a pure rule over the session's facts; `allStepsRowCopyOf` maps a row's
 *     discriminated unions to words with exhaustive switches (Visitor).
 */
import { pluralOf } from '@commise/i18n';
import { allLinesTicked, tickedLineCount, timerOrder } from '@kitchensink/cooking-core';
import type { ActiveTimer, CookingStep, LineTicks, TimerState } from '@kitchensink/cooking-core';

import type { CookingAllStepsMessages } from './messages.js';

/** How a step reads in the list. The session's step is Now even when it is also in `marks`. */
export type AllStepsMark =
    | { readonly kind: 'now' }
    | { readonly kind: 'done' }
    | { readonly kind: 'allTicked' }
    | { readonly kind: 'linesLeft'; readonly count: number };

/** A timer state the row names. A ringing and an ended-away timer are both `done`: each waits for the cook. */
export type TimerPartKind = 'done' | 'running' | 'paused';

/** How many of one kind of timer a step holds. */
export interface TimerPart {
    readonly kind: TimerPartKind;
    readonly count: number;
}

/** One step's row. */
export interface AllStepsRow {
    readonly index: number;
    readonly stepNumber: number;
    readonly firstLine: string;
    readonly mark: AllStepsMark;
    /** One part per kind, in the order each kind first appears in `timerOrder`. */
    readonly timerParts: readonly TimerPart[];
}

/** What the rows are decided from. */
export interface AllStepsInput {
    readonly steps: readonly CookingStep[];
    /** The session's step. */
    readonly stepIndex: number;
    /** The steps the cook has finished, by index. */
    readonly marks: readonly number[];
    readonly lineTicks: LineTicks;
    readonly timers: TimerState;
    readonly recipeId: string;
}

const markOf = (input: AllStepsInput, index: number): AllStepsMark => {
    if (index === input.stepIndex) {
        return { kind: 'now' };
    }

    if (input.marks.includes(index)) {
        return { kind: 'done' };
    }

    if (allLinesTicked(input.lineTicks, index, input.steps)) {
        return { kind: 'allTicked' };
    }

    const lineCount = input.steps[index]?.lines.length ?? 0;

    return { kind: 'linesLeft', count: lineCount - tickedLineCount(input.lineTicks, index) };
};

const partKindOf = (timer: ActiveTimer): TimerPartKind => {
    switch (timer.kind) {
        case 'ringing':
        case 'endedAway':
            return 'done';
        case 'running':
            return 'running';
        case 'paused':
            return 'paused';
    }
};

const timerPartsOf = (input: AllStepsInput, index: number): readonly TimerPart[] => {
    const counts = new Map<TimerPartKind, number>();

    for (const entry of timerOrder(input.timers)) {
        if (entry.kind === 'live' && entry.timer.recipeId === input.recipeId && entry.timer.stepIndex === index) {
            const kind = partKindOf(entry.timer);

            counts.set(kind, (counts.get(kind) ?? 0) + 1);
        }
    }

    return [...counts].map(([kind, count]) => ({ kind, count }));
};

/**
 * Every step's row, in recipe order. Pure.
 *
 * @param input - The steps and the session's facts.
 * @returns One row per step.
 */
export function allStepsRowsOf(input: AllStepsInput): readonly AllStepsRow[] {
    return input.steps.map((step, index) => ({
        index,
        stepNumber: step.stepNumber,
        firstLine: step.lines[0] ?? '',
        mark: markOf(input, index),
        timerParts: timerPartsOf(input, index),
    }));
}

/** A row's words. */
export interface AllStepsRowCopy {
    readonly mark: string;
    /** The timer parts joined, or `undefined` when the step has no timer. */
    readonly timers: string | undefined;
}

const markCopyOf = (mark: AllStepsMark, copy: CookingAllStepsMessages, locale: string): string => {
    switch (mark.kind) {
        case 'now':
            return copy.now;
        case 'done':
            return copy.done;
        case 'allTicked':
            return copy.allTicked;
        case 'linesLeft':
            return pluralOf(copy.linesLeft, mark.count, locale);
    }
};

const partCopyOf = (part: TimerPart, copy: CookingAllStepsMessages, locale: string): string => {
    switch (part.kind) {
        case 'done':
            return pluralOf(copy.timersDone, part.count, locale);
        case 'running':
            return pluralOf(copy.timersRunning, part.count, locale);
        case 'paused':
            return pluralOf(copy.timersPaused, part.count, locale);
    }
};

/**
 * The words of one row. Pure.
 *
 * @param row - The row.
 * @param copy - The All steps copy.
 * @param locale - The active locale, for the plural rule.
 * @returns The mark's text and the timers' text.
 */
export function allStepsRowCopyOf(row: AllStepsRow, copy: CookingAllStepsMessages, locale: string): AllStepsRowCopy {
    return {
        mark: markCopyOf(row.mark, copy, locale),
        timers:
            row.timerParts.length === 0
                ? undefined
                : row.timerParts.map((part) => partCopyOf(part, copy, locale)).join(copy.timerJoin),
    };
}
