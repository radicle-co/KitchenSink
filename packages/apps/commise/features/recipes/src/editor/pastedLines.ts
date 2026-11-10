/**
 * @module @commise/features-recipes/editor — what a pasted list becomes (blueprint A5, build spec §7.5.4): which of its
 * lines are still reading, and, for each settled line, the rows the recipe gets. `usePasteIntoIngredients` polls the
 * parse job and commits what this settles, in paste order.
 *
 * A parsed line becomes one row per proposed food: the NAME the host joins it by (bound to the food its match names, or
 * as written: ADR-0071), the measure, and the phrase the parse lifted out (the create's `sourcePhrase`). The measure is
 * in the cook's own words (`statedMeasure`: "1 large", "a handful", "2 tbsp"), and `pastedLineRowOf` decides which foods
 * of a line carry it.
 *
 * ⛔ THERE IS NO TIME LIMIT (owner ruling 2026-10-13: "it takes as long as it takes"; plan 2026-10-15-011). A pending line
 * reads with the phase the SERVER reports (`progress.phase`, computed by `lineProgressOf`). Two kinds of line wait on
 * the COOK instead of on a clock: one the server calls `stalled` (nothing in the paste has moved for a while — it may
 * still move, so it is offered, never forced), and a `failed_retryable` one (the system stopped trying; since the worker
 * only claims a `pending` line, it will not land by itself). The cook's way out is Add as written: a line in
 * `typedByCook` settles through the add field's own reader (`readLeadingMeasure`) on the cook's own text, whatever
 * lands afterwards, so the choice is deterministic.
 *
 * The server's own terminals still settle a line without the cook: an expired job (expiry is the TIMESTAMP,
 * `parseJobIsLive`, not the status), an `unparseable` line, and a job that cannot be read at all. Such a row claims no
 * `sourcePhrase`: only a client that parsed the line may name the memo's key (`recipes.schema.ts`). A heading ending in a
 * colon settles into no row on every path, whatever the parse proposed for it; a line the reader finds no food in (a
 * measure alone) settles into none either.
 *
 * Pure and platform-agnostic: `now` is a parameter.
 *
 * @pattern Adapter — the parse job's answer to draft rows
 * @pattern Visitor — an exhaustive switch over the job line's status
 */
import { pastedLineRowOf } from '@kitchensink/recipe-core/parsing/pasted-line-measure';
import { parseJobIsLive } from '@kitchensink/recipe-service-client';
import type { ParseJobLinePhase, ParseJobLineView, ParseJobResponse, ParseProposal } from '@kitchensink/schema-recipe';

import { readLeadingMeasure, statedUnitOf } from '../form/leadingMeasure.js';
import type { LineMeasure } from '../hooks/lineCommit.js';

/** One row a settled line adds. */
export interface PastedRow {
    /** The food's name, for the existing lookup to resolve. */
    readonly name: string;
    readonly measure: LineMeasure;
    /** The phrase the parse lifted out of the line, for the create (its `sourcePhrase`); absent for a reader row. */
    readonly sourcePhrase?: string;
    /** The cook's own words for the food, when the parse chose to keep them; the draft line shows them (`displayText`). */
    readonly displayText?: string;
    /** A dimension the cook wrote in parentheses ("9 inch"), shown beside the food (`note`). */
    readonly note?: string;
    /**
     * Which food of the line's proposal this row is, so the host can find its match (`${lineIndex}:${foodIndex}`). Absent
     * for a reader row: it has no proposal food, so no match, and it joins as written.
     */
    readonly foodIndex?: number;
}

/** A pending line's step, as the server reports it — every phase but `stalled`, which waits on the cook. */
type PastedReadingPhase = Exclude<ParseJobLinePhase, 'stalled'>;

/** Why a line waits on the cook: the paste has gone quiet (`stalled`), or the system stopped trying (`retryable`). */
type PastedAwaitCause = 'stalled' | 'retryable';

/** One pasted line: still reading, waiting on the cook, or settled into its rows (none for a heading). */
export type PastedLine =
    | {
          readonly kind: 'reading';
          readonly lineIndex: number;
          readonly sourceLine: string;
          readonly phase: PastedReadingPhase;
      }
    | {
          readonly kind: 'awaitingCook';
          readonly lineIndex: number;
          readonly sourceLine: string;
          readonly cause: PastedAwaitCause;
      }
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
    /** Epoch milliseconds, for the job's deadline only. */
    readonly now: number;
    /** The lines the cook chose to add as written, by index: each settles through the reader. */
    readonly typedByCook: ReadonlySet<number>;
}

/** The row recipe-core builds for one food of a parse answer: the one rule the saved line and the paste list share. Pure. */
function pastedRowOf(proposal: ParseProposal, sourceLine: string, foodIndex: number) {
    const food = proposal.foods[foodIndex];

    return pastedLineRowOf({ ...proposal, sourceLine, display: food?.display ?? null }, foodIndex, food?.name ?? '');
}

/**
 * The words the SAVED line shows for one food of a parse answer: the cook's words when the parse keeps them
 * (`displayText`), else the proposal's food name. A paste row whose parse has answered and whose review is pending shows
 * these, so it reads as the line will read once saved. Pure.
 *
 * @param proposal - The line's parse answer.
 * @param sourceLine - The line as pasted.
 * @param foodIndex - Which food of the proposal.
 * @returns The words.
 */
export function savedWordsOf(proposal: ParseProposal, sourceLine: string, foodIndex: number): string {
    const row = pastedRowOf(proposal, sourceLine, foodIndex);

    return row.displayText ?? row.name;
}

/**
 * The rows a parsed proposal adds: one per food. Each row's measure and name are recipe-core's `pastedLineRowOf` (the
 * cook's own words, an amount on the first food only, a leading size word as the unit), the rule recipe-service's paste matcher keys
 * its verdict with (ADR-0071). The phrase the parse lifted out stays whole, as the memo's key grain. Pure.
 */
function proposedRowsOf(proposal: ParseProposal, sourceLine: string): readonly PastedRow[] {
    return proposal.foods.map((food, index) => {
        // `display` is the model's answer for THIS food (ADR-0026 §11); absent reads as no answer.
        const { name, quantity, unit, displayText, note } = pastedRowOf(proposal, sourceLine, index);

        return {
            name,
            measure: { quantity, unit, preparation: food.prep ?? '' },
            sourcePhrase: food.name,
            foodIndex: index,
            ...(displayText === undefined ? {} : { displayText }),
            ...(note === undefined ? {} : { note }),
        };
    });
}

/** A heading the cook pasted with the list (`For the dough:`): it names no food. */
const HEADING = /:\s*$/u;

/**
 * The rows the add field's reader makes of the cook's own text: one, or none when the line reads as a measure with
 * nothing after it (`2 cups`), which would otherwise become a food named "2 cups" and a write to the catalog. Pure.
 */
function readerRowsOf(sourceLine: string): readonly PastedRow[] {
    const reading = readLeadingMeasure(sourceLine);
    const { quantity, preparation, search } = reading;
    // The unit as the cook typed it, as a parsed line keeps it (spec §7.5.3), never `normalizeUnit`'s spelling.
    const unit = statedUnitOf(reading);

    return search === '' ? [] : [{ name: search, measure: { quantity, unit, preparation } }];
}

/** One job line, given whether the job has stopped moving and whether the cook chose to add it as written. Pure. */
function pastedLineOf(line: ParseJobLineView, stopped: boolean, typedByCook: boolean): PastedLine {
    const { lineIndex, sourceLine } = line;
    const settled = (rows: readonly PastedRow[]): PastedLine => ({ kind: 'settled', lineIndex, sourceLine, rows });

    // A heading names no food on EVERY path, a parse that proposed one for it included: tested before the status.
    if (HEADING.test(sourceLine)) {
        return settled([]);
    }

    // The cook's choice wins over whatever landed, so pressing Add as written means one thing.
    if (typedByCook) {
        return settled(readerRowsOf(sourceLine));
    }

    switch (line.status) {
        case 'parsed':
            return line.proposal === null
                ? settled(readerRowsOf(sourceLine))
                : settled(proposedRowsOf(line.proposal, sourceLine));
        // `withdrawn` on the server: the cook kept it as written, so no engine will answer — settle it the same way
        // even if this client no longer remembers the choice.
        case 'unparseable':
        case 'withdrawn':
            return settled(readerRowsOf(sourceLine));
        case 'failed_retryable':
            return stopped
                ? settled(readerRowsOf(sourceLine))
                : { kind: 'awaitingCook', lineIndex, sourceLine, cause: 'retryable' };

        case 'pending': {
            if (stopped) {
                return settled(readerRowsOf(sourceLine));
            }

            const phase = line.progress?.phase ?? 'queued';

            return phase === 'stalled'
                ? { kind: 'awaitingCook', lineIndex, sourceLine, cause: 'stalled' }
                : { kind: 'reading', lineIndex, sourceLine, phase };
        }
    }
}

/**
 * The lines of a paste that has no job (the daily limit refused it, 004 FR-022): each settles through the add field's
 * reader, as written. Pure.
 *
 * @param sourceLines - The pasted lines, as the splitter made them.
 * @returns Each line, settled, in paste order.
 */
export function readerLinesOf(sourceLines: readonly string[]): readonly PastedLine[] {
    return sourceLines.map((sourceLine, lineIndex): PastedLine => ({
        kind: 'settled',
        lineIndex,
        sourceLine,
        rows: HEADING.test(sourceLine) ? [] : readerRowsOf(sourceLine),
    }));
}

/**
 * The pasted lines, in paste order.
 *
 * @param input - The job, whether it can be read, the clock (for the deadline) and the cook's choices.
 * @returns Each line, reading, waiting on the cook, or settled. Pure.
 */
export function pastedLinesOf(input: PastedLinesInput): readonly PastedLine[] {
    const { job, jobFailed, now, typedByCook } = input;
    const stopped = jobFailed || job.status === 'expired' || !parseJobIsLive(job, now);

    return [...job.lines]
        .sort((left, right) => left.lineIndex - right.lineIndex)
        .map((line) => pastedLineOf(line, stopped, typedByCook.has(line.lineIndex)));
}
