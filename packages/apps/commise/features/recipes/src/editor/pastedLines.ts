/**
 * @module @commise/features-recipes/editor — what a pasted list becomes (blueprint A5, build spec §7.5.4): which of its
 * lines are still reading, and, for each settled line, the rows the recipe gets. `usePasteIntoIngredients` polls the
 * parse job and commits what this settles, in paste order.
 *
 * A parsed line becomes one row per proposed food: the NAME the existing lookup resolves (R19: the parse binds
 * nothing), the measure, and the phrase the parse lifted out (the create's `sourcePhrase`). The first food carries the
 * line's measure; a second food on the same line states none, because the line gave one amount.
 *
 * ⛔ No row reads for good. Three facts about the service decide when a line has stopped moving:
 *
 * 1. a `partial` job is NOT terminal — its retryable lines may still land on their own, so they keep reading;
 * 2. expiry is the TIMESTAMP (`parseJobIsLive`), not the status: for up to a quarter hour a `running` job is already
 *    dead;
 * 3. a `running` job has no server-side bound short of its 24-hour TTL: a line whose message went to the dead-letter
 *    queue stays `pending` forever.
 *
 * So past {@link PASTE_STALL_BOUND_MS}, on an expired job, for an `unparseable` line, and for a job that cannot be read
 * at all, the line settles through the add field's own reader (`readLeadingMeasure`) on the cook's own text. Such a row
 * claims no `sourcePhrase`: only a client that parsed the line may name the memo's key (`recipes.schema.ts`).
 *
 * Pure and platform-agnostic: `now` is a parameter.
 *
 * @pattern Adapter — the parse job's answer to draft rows
 * @pattern Visitor — an exhaustive switch over the job line's status
 */
import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';
import { parseJobIsLive } from '@kitchensink/recipe-service-client';
import type { ParseJobLineView, ParseJobResponse, ParseProposal } from '@kitchensink/schema-recipe';

import { readLeadingMeasure } from '../form/leadingMeasure.js';
import type { LineMeasure } from '../hooks/lineCommit.js';

/**
 * How long a pasted line may read before it settles through the reader. The retired review page's stall bound: an
 * estimate (no production parse timing exists), and guessing low costs only a line read by the simpler reader.
 */
export const PASTE_STALL_BOUND_MS = 180_000;

/** One row a settled line adds. */
export interface PastedRow {
    /** The food's name, for the existing lookup to resolve. */
    readonly name: string;
    readonly measure: LineMeasure;
    /** The phrase the parse lifted out of the line, for the create (its `sourcePhrase`); absent for a reader row. */
    readonly sourcePhrase?: string;
}

/** One pasted line: still reading, or settled into its rows (none for a heading). */
export type PastedLine =
    | { readonly kind: 'reading'; readonly lineIndex: number; readonly sourceLine: string }
    | {
          readonly kind: 'settled';
          readonly lineIndex: number;
          readonly sourceLine: string;
          readonly rows: readonly PastedRow[];
      };

/** What the projection reads. */
export interface PastedLinesInput {
    /** The job, as last read. */
    readonly job: ParseJobResponse;
    /** The job cannot be read (gone, or refused): nothing more will land. */
    readonly jobFailed: boolean;
    /** Epoch milliseconds. */
    readonly now: number;
    /** When the cook pasted, epoch milliseconds. */
    readonly runningSince: number;
}

const NO_MEASURE: LineMeasure = { quantity: ABSENT_QUANTITY, unit: '', preparation: '' };

/** The rows a parsed proposal adds: one per food, the first carrying the line's measure. Pure. */
function proposedRowsOf(proposal: ParseProposal): readonly PastedRow[] {
    return proposal.foods.map((food, index) => ({
        name: food.name,
        measure:
            index === 0
                ? { quantity: proposal.quantity, unit: proposal.unit ?? '', preparation: food.prep ?? '' }
                : { ...NO_MEASURE, preparation: food.prep ?? '' },
        sourcePhrase: food.name,
    }));
}

/** The one row the add field's reader makes of the cook's own text. Pure. */
function readerRowOf(sourceLine: string): PastedRow {
    const { quantity, unit, preparation, search } = readLeadingMeasure(sourceLine);

    return { name: search === '' ? sourceLine.trim() : search, measure: { quantity, unit, preparation } };
}

/** One job line, given whether the job has stopped moving for it. Pure. */
function pastedLineOf(line: ParseJobLineView, stopped: boolean): PastedLine {
    const { lineIndex, sourceLine } = line;
    const settled = (rows: readonly PastedRow[]): PastedLine => ({ kind: 'settled', lineIndex, sourceLine, rows });

    switch (line.status) {
        case 'parsed':
            return line.proposal === null ? settled([readerRowOf(sourceLine)]) : settled(proposedRowsOf(line.proposal));
        case 'unparseable':
            return settled([readerRowOf(sourceLine)]);
        case 'pending':
        case 'failed_retryable':
            return stopped ? settled([readerRowOf(sourceLine)]) : { kind: 'reading', lineIndex, sourceLine };
    }
}

/**
 * The pasted lines, in paste order.
 *
 * @param input - The job, whether it can be read, and the clock.
 * @returns Each line, reading or settled. Pure.
 */
export function pastedLinesOf(input: PastedLinesInput): readonly PastedLine[] {
    const { job, jobFailed, now, runningSince } = input;
    const stopped =
        jobFailed || job.status === 'expired' || !parseJobIsLive(job, now) || now - runningSince > PASTE_STALL_BOUND_MS;

    return [...job.lines]
        .sort((left, right) => left.lineIndex - right.lineIndex)
        .map((line) => pastedLineOf(line, stopped));
}
