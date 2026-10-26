/**
 * @module @commise/features-recipes/editor — WHICH pasted line joins the draft next, and HOW each of its rows joins
 * (ADR-0071; owner rulings 2026-10-25). The one specification the host's join queue asks, so paste order and the binding
 * rule live in a single place.
 *
 * - **Lines join in paste order, whole.** The first line not yet joined decides: a line still reading, or waiting on the
 *   cook, blocks every line after it, and a line whose join failed holds until Try again. A line joins all its rows
 *   together or none.
 * - **A line waits for its foods' matches.** A join that ran before the match arrived would join as written a food the
 *   server was about to bind. A food does not hold its line once its match request failed, or once the job can no longer
 *   match (expired or unreadable): it joins as written, and its line says so (`optionsFailed`).
 * - **Only a confident match that names a food binds** (confident lines bind; owner ruling 2026-10-25). Every other state
 *   joins AS WRITTEN: a default is shown with its tag and NEVER selected for the cook (ADR-0070 section 5), a doubtful or
 *   unmatched line needs the cook, and a checking line is bound only by its review or the cook later.
 * - **A reader row** (a line the parse could not read, one the cook chose to add as written) has no proposal food, so no
 *   match, and joins as written.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Specification — `nextJoinOf` is the one predicate that says what joins next
 */
import type { ParseJobResponse } from '@kitchensink/schema-recipe';

import type { BoundBy } from '../ingredientMatching/matchLine.js';
import { foodKeyOf } from './matchDemand.js';
import { boundByOf } from './pasteMatchLines.js';
import type { PastedLine, PastedRow } from './pastedLines.js';

/** The food a confident match binds a row to. */
export interface BoundFood {
    /** A root's or a variant's id (`variant` says which admission it takes). */
    readonly id: string;
    readonly name: string;
    readonly variant: boolean;
}

/** How one row joins. */
export type RowJoin =
    /** Bound to the food a confident match proposed. */
    | {
          readonly kind: 'bound';
          readonly key: string;
          readonly row: PastedRow;
          readonly food: BoundFood;
          readonly boundBy: Exclude<BoundBy, 'cook'>;
      }
    /** Joined as the cook wrote it; the cook (or a later review) chooses its food. `key` is absent for a reader row. */
    | { readonly kind: 'asWritten'; readonly key?: string; readonly row: PastedRow };

/** The line to join next. */
export interface NextJoin {
    readonly lineIndex: number;
    readonly sourceLine: string;
    readonly rows: readonly RowJoin[];
}

/** What the specification reads. */
export interface PasteJoinInput {
    /** The pasted lines, in paste order (`pastedLinesOf`). */
    readonly lines: readonly PastedLine[];
    /** The job as last read, for its matches; `undefined` for a paste with no job (the daily limit refused it). */
    readonly job: ParseJobResponse | undefined;
    /** The lines already in the draft, by index. */
    readonly joined: ReadonlySet<number>;
    /** The foods whose match request failed. */
    readonly optionsFailed: ReadonlySet<string>;
    /** No match will come: the job expired or cannot be read. */
    readonly matchesGone: boolean;
    /** The line whose join failed, until Try again. */
    readonly failedAt: number | undefined;
}

/** A food's match, or `undefined` when the line or food has none. Pure. */
function matchOf(job: ParseJobResponse | undefined, lineIndex: number, foodIndex: number) {
    return job?.lines.find((line) => line.lineIndex === lineIndex)?.proposal?.foods[foodIndex]?.match ?? undefined;
}

/**
 * How one row joins, or `undefined` while it must wait for its match. Pure.
 *
 * @param input - What the specification reads.
 * @param lineIndex - The row's line.
 * @param row - The row.
 * @returns The join, or `undefined` while the row's match has not arrived.
 */
function rowJoinOf(input: PasteJoinInput, lineIndex: number, row: PastedRow): RowJoin | undefined {
    if (row.foodIndex === undefined) {
        return { kind: 'asWritten', row };
    }

    const key = foodKeyOf(lineIndex, row.foodIndex);
    const match = matchOf(input.job, lineIndex, row.foodIndex);

    if (match === undefined) {
        return input.optionsFailed.has(key) || input.matchesGone ? { kind: 'asWritten', key, row } : undefined;
    }

    if (match.state === 'confident' && match.proposed !== null) {
        return {
            kind: 'bound',
            key,
            row,
            food: { id: match.proposed.id, name: match.proposed.name, variant: match.proposed.kind === 'variant' },
            boundBy: boundByOf(match.reason),
        };
    }

    return { kind: 'asWritten', key, row };
}

/**
 * The line to join next, or `undefined` when nothing may join now (everything has joined, the next line is still
 * reading or waits on the cook, its join failed, or one of its foods has no match yet). Pure.
 *
 * @param input - The lines, the job, what has joined and what failed.
 * @returns The line and how each of its rows joins.
 */
export function nextJoinOf(input: PasteJoinInput): NextJoin | undefined {
    const line = input.lines.find((each) => !input.joined.has(each.lineIndex));

    if (line === undefined || line.kind !== 'settled' || input.failedAt === line.lineIndex) {
        return undefined;
    }

    const rows = line.rows.map((row) => rowJoinOf(input, line.lineIndex, row));

    return rows.every((row): row is RowJoin => row !== undefined)
        ? { lineIndex: line.lineIndex, sourceLine: line.sourceLine, rows }
        : undefined;
}
