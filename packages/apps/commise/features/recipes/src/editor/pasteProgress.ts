/**
 * @module @commise/features-recipes/editor — the paste's VISIBLE state (plan 2026-10-15-011, UX spec there): the row
 * state of each pasted line not in the recipe yet, the one progress block over them, and the milestone the polite
 * region may speak. `usePasteIntoIngredients` feeds it what it knows; both platforms' leaves draw what it answers.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Adapter — the paste's lines and session to the rows and progress block the leaves draw
 * @pattern Visitor — exhaustive switches over the pasted line's kind and the row state
 */
import type {
    PasteMilestone,
    PasteProgress,
    PasteProgressStatus,
    PasteReadingRow,
    PasteRowState,
} from '../form/props.js';
import type { PastedLine } from './pastedLines.js';

/** What the rows are built from. */
export interface PasteRowsInput {
    readonly jobId: string;
    /** Every pasted line, in paste order. */
    readonly lines: readonly PastedLine[];
    /** How many lines, in paste order, have joined the recipe. */
    readonly done: number;
    /** The line whose lookup failed, by its index, until Try again. */
    readonly failedAt: number | undefined;
    /** The paste's work is paused for a connection. */
    readonly waiting: boolean;
}

/** A line's own state, before the session's overrides. Pure. */
function ownStateOf(line: PastedLine, isNext: boolean): PasteRowState {
    switch (line.kind) {
        case 'reading':
            return line.phase;
        case 'awaitingCook':
            return line.cause;
        case 'settled':
            return isNext ? 'joining' : 'ready';
    }
}

/**
 * The rows for the lines not in the recipe yet, in paste order.
 *
 * @param input - The lines and what the session knows about them.
 * @returns One row per unjoined line. Pure.
 */
export function pasteRowsOf(input: PasteRowsInput): readonly PasteReadingRow[] {
    const { jobId, lines, done, failedAt, waiting } = input;

    return lines.slice(done).map((line, offset) => {
        const own = ownStateOf(line, offset === 0);
        const state: PasteRowState = failedAt === line.lineIndex ? 'lookupFailed' : waiting ? 'waiting' : own;

        return {
            key: `${jobId}:${String(line.lineIndex)}`,
            lineIndex: line.lineIndex,
            sourceLine: line.sourceLine,
            state,
        };
    });
}

/** The row states the server still holds (pending lines), as opposed to the cook's or the client's. */
const SERVER_HELD: ReadonlySet<PasteRowState> = new Set(['queued', 'reading', 'retrying', 'delayed', 'stalled']);

/** The states that name a step, for the status line. */
type StepState = Extract<PasteProgressStatus, { kind: 'step' }>['step'];

const STEPS: ReadonlySet<PasteRowState> = new Set<StepState>(['queued', 'reading', 'retrying', 'delayed', 'joining']);

/** Whether a row state names a step. Pure. */
function isStep(state: PasteRowState): state is StepState {
    return STEPS.has(state);
}

/** The status line, first match wins (UX spec). Pure. */
function statusOf(rows: readonly PasteReadingRow[]): PasteProgressStatus {
    const needsYou = rows.filter((row) => row.state === 'retryable' || row.state === 'lookupFailed').length;

    if (needsYou > 0) {
        return { kind: 'needsYou', count: needsYou };
    }

    if (rows.some((row) => row.state === 'waiting')) {
        return { kind: 'offline' };
    }

    const held = rows.filter((row) => SERVER_HELD.has(row.state));

    if (held.length > 0 && held.every((row) => row.state === 'stalled')) {
        return { kind: 'stalled' };
    }

    // The head line's step — or, when the head is stalled while a later line moves, the line being worked on.
    const working = rows.find((row) => isStep(row.state));

    return working !== undefined && isStep(working.state)
        ? { kind: 'step', step: working.state, position: working.lineIndex + 1 }
        : { kind: 'stalled' };
}

/**
 * The progress block over a paste's unjoined lines.
 *
 * @param rows - The rows `pasteRowsOf` answered.
 * @param done - Lines already in the recipe.
 * @param count - Lines in the paste.
 * @returns The block's model. Pure.
 */
export function pasteProgressOf(rows: readonly PasteReadingRow[], done: number, count: number): PasteProgress {
    return {
        done,
        count,
        status: statusOf(rows),
        retryCount: rows.filter((row) => row.state === 'retryable').length,
        restCount: rows.filter((row) => row.state === 'retryable' || row.state === 'stalled').length,
    };
}

/** The condition a paste is in, for the milestones: what the status line says, without its numbers. */
export type PasteCondition = 'needsYou' | 'offline' | 'stalled' | 'moving';

/**
 * The paste's condition.
 *
 * @param progress - The block's model.
 * @returns Its condition. Pure.
 */
export function pasteMilestoneOf(progress: PasteProgress): PasteCondition {
    switch (progress.status.kind) {
        case 'needsYou':
        case 'offline':
        case 'stalled':
            return progress.status.kind;
        case 'step':
            return 'moving';
    }
}

/**
 * The milestone a change of condition is worth saying, or `undefined` when it is worth nothing: a paste starting, the
 * first line that needs the cook, the whole paste stalling, going offline, and work moving again after any of those.
 *
 * @param previous - The condition last seen, or `undefined` before the paste's first.
 * @param next - The condition now.
 * @returns The milestone to say. Pure.
 */
export function milestoneOnChange(
    previous: PasteCondition | undefined,
    next: PasteCondition,
): PasteMilestone | undefined {
    if (previous === undefined) {
        return 'started';
    }

    if (previous === next) {
        return undefined;
    }

    return next === 'moving' ? 'resumed' : next;
}
