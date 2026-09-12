/**
 * @module instructionGate — the corpus measurement plan 001 §6 owes before the instruction gate may ship: which lines
 * a rule skips, and which of those named a food by an independent oracle.
 *
 * ⛔ A unit suite cannot settle whether the gate drops real ingredients; ADR-0026's recorded lesson is that food
 * losses were found only by a corpus-wide diff. So the ship gate is these reports: zero ADJUDICATED false refusals on
 * both runs. Each report lists the candidates in full, because a count alone cannot be adjudicated.
 *
 * Pure reducers over a corpus; the script owns every read and the CRF process.
 *
 * @pattern Strategy — the rule is a parameter; the script passes `readsAsInstruction` (`../parsing/lineAdmission.ts`),
 *   the function the import runs, and the tests pass a stand-in so they measure these reducers and not the lexicon
 */

/** A rule under measurement: whether a line is skipped (never sent to the parser). */
export type SkipRule = (line: string) => boolean;

/** One labelled NYT row: the line a cook wrote, and the food a person named in it (`''` for none). */
export interface LabelledRow {
    readonly input: string;
    readonly name: string;
}

/** Run 1's report. */
export interface LabelledRowReport {
    readonly total: number;
    readonly skipped: number;
    /** Every skipped row a person labelled with a food: each is a false refusal. */
    readonly falseRefusals: readonly LabelledRow[];
}

/** Run 2's report. */
export interface ClauseReport {
    readonly total: number;
    readonly skipped: number;
    /** Every skipped clause the oracle named a food in: a person decides whether each is a false refusal. */
    readonly toAdjudicate: readonly { readonly clause: string; readonly oracleNamed: readonly string[] }[];
}

/**
 * Measure the gate over rows a person labelled. Pure.
 *
 * @param rows - The labelled rows.
 * @param skips - The rule under measurement.
 * @returns The skip count and every false refusal.
 */
export function gateOverLabelledRows(rows: readonly LabelledRow[], skips: SkipRule): LabelledRowReport {
    const skipped = rows.filter((row) => skips(row.input));

    return {
        total: rows.length,
        skipped: skipped.length,
        falseRefusals: skipped.filter((row) => row.name.trim() !== ''),
    };
}

/**
 * Measure the gate over unlabelled clauses, with an oracle that names the foods in a clause. Pure over the oracle.
 *
 * @param clauses - The clauses.
 * @param skips - The rule under measurement.
 * @param oracleNamed - The foods an independent engine named in a clause.
 * @returns The skip count and every skipped clause the oracle named a food in.
 */
export function gateOverClauses(
    clauses: readonly string[],
    skips: SkipRule,
    oracleNamed: (clause: string) => readonly string[],
): ClauseReport {
    const skipped = clauses.filter((clause) => skips(clause));

    return {
        total: clauses.length,
        skipped: skipped.length,
        toAdjudicate: skipped
            .map((clause) => ({ clause, oracleNamed: oracleNamed(clause) }))
            .filter((entry) => entry.oracleNamed.length > 0),
    };
}
