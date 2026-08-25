/**
 * Unit tier for the ORACLE FIXTURE — the properties that make a committed adjudication auditable.
 *
 * ⛔ THIS SUITE DOES NOT CHECK WHETHER A VERDICT IS RIGHT, and it cannot. There is no ground truth above
 * the oracle; the oracle IS the ground truth. What it checks is everything that makes the oracle
 * READABLE BY A HUMAN WHO WANTS TO DISAGREE WITH IT: that every ruling names the clause that decided it,
 * that every clause names its source or is flagged as invented, that a seed identifies exactly one case,
 * and that the census is not vacuous.
 *
 * ⚠️ Anti-vacuity is the load-bearing half. A fixture that silently lost a regime would still pass every
 * shape assertion above while measuring nothing about that regime — the failure mode the plan names
 * ("randomised suites fail silently by generating uninteresting data"), and the one this session already
 * met once when a verification reported "ALL DATABASES MATCH" over zero relations.
 */
import { describe, expect, it } from 'vitest';

import {
    ORACLE_REGIMES,
    PARSE_ORACLE,
    PARSE_RUBRIC,
    RUBRIC_CLAUSES,
    findOracleCase,
    isRuledOracleCase,
    isUndecidedOracleCase,
    oracleClauseCensus,
    oracleRegimeCensus,
} from '../../../tests/__fixtures__/parseOracle.js';

describe('the rubric', () => {
    it('states a source for every clause it does not flag as invented', () => {
        const unsourced = RUBRIC_CLAUSES.filter(
            (clause) => !PARSE_RUBRIC[clause].invented && PARSE_RUBRIC[clause].source.trim() === '',
        );

        expect(unsourced, `clauses claiming a source but stating none: ${unsourced.join(', ')}`).toEqual([]);
    });

    it('states what every clause decides', () => {
        const silent = RUBRIC_CLAUSES.filter((clause) => PARSE_RUBRIC[clause].statement.trim() === '');

        expect(silent, `clauses with no statement: ${silent.join(', ')}`).toEqual([]);
    });

    it('names every invented clause in its own statement, so a reader cannot miss it', () => {
        const invented = RUBRIC_CLAUSES.filter((clause) => PARSE_RUBRIC[clause].invented);
        const unannounced = invented.filter((clause) => !PARSE_RUBRIC[clause].statement.includes('INVENTED'));

        expect(unannounced, `invented clauses that do not say so: ${unannounced.join(', ')}`).toEqual([]);
    });
});

describe('the oracle census', () => {
    it('is not empty', () => {
        expect(PARSE_ORACLE.length).toBeGreaterThan(0);
    });

    it('gives every case a seed that identifies exactly one case', () => {
        const seen = new Map<string, number>();

        for (const entry of PARSE_ORACLE) {
            seen.set(entry.seed, (seen.get(entry.seed) ?? 0) + 1);
        }

        const duplicated = [...seen].filter(([, count]) => count > 1).map(([seed]) => seed);

        expect(duplicated, `seeds naming more than one case: ${duplicated.join(', ')}`).toEqual([]);
    });

    it('reproduces any case from its seed alone', () => {
        for (const entry of PARSE_ORACLE) {
            expect(findOracleCase(entry.seed), `seed ${entry.seed} did not resolve`).toEqual(entry);
        }
    });

    it('quotes a non-empty source line on every case', () => {
        const blank = PARSE_ORACLE.filter((entry) => entry.line.trim() === '');

        expect(
            blank.map((entry) => entry.seed),
            'cases quoting no line',
        ).toEqual([]);
    });

    it('counts at least one real corpus occurrence per case', () => {
        const impossible = PARSE_ORACLE.filter((entry) => entry.occurrences < 1);

        expect(
            impossible.map((entry) => entry.seed),
            'cases covering no corpus line',
        ).toEqual([]);
    });
});

describe('every decision names the clause that made it', () => {
    it('gives every ruled case a clause the rubric actually carries', () => {
        const ruled = PARSE_ORACLE.filter(isRuledOracleCase);
        const dangling = ruled.filter((entry) => !RUBRIC_CLAUSES.includes(entry.verdict.clause));

        expect(
            dangling.map((entry) => entry.seed),
            'rulings citing a clause the rubric does not carry',
        ).toEqual([]);
    });

    it('leaves no case verdictless — a verdict is `ruled` or `undecided`, never absent', () => {
        const kinds = new Set(PARSE_ORACLE.map((entry) => entry.verdict.kind));

        expect([...kinds].sort()).toEqual(['ruled', 'undecided']);
    });

    it('records three lenses and a reason on every undecided case', () => {
        const undecided = PARSE_ORACLE.filter(isUndecidedOracleCase);
        const thin = undecided.filter(
            (entry) =>
                entry.verdict.note.trim() === '' ||
                entry.verdict.lenses.cookAloud.trim() === '' ||
                entry.verdict.lenses.catalog.trim() === '' ||
                entry.verdict.lenses.sourceSentence.trim() === '',
        );

        expect(
            thin.map((entry) => entry.seed),
            'undecided cases that do not say why',
        ).toEqual([]);
    });

    it('keeps the undecided bucket a first-class outcome rather than an empty formality', () => {
        const undecided = PARSE_ORACLE.filter(isUndecidedOracleCase);

        // ⚠️ Not a quality threshold. It asserts the bucket is REACHABLE: an oracle that decided
        // everything would be a model's opinion wearing a rubric's clothes, which is the one outcome the
        // plan forbids outright.
        expect(
            undecided.length,
            'the rubric decided every case, which is the failure this bucket exists to prevent',
        ).toBeGreaterThan(0);
    });
});

describe('⛔ anti-vacuity — the census covers every regime, and the failure says which one it lost', () => {
    it('represents all seven regimes with a proven non-zero floor', () => {
        const census = oracleRegimeCensus(PARSE_ORACLE);
        const empty = ORACLE_REGIMES.filter((regime) => census[regime] === 0);

        expect(
            empty,
            `regimes with NO case in the census: ${empty.join(', ') || '(none)'} — counted ${JSON.stringify(census)}`,
        ).toEqual([]);
    });

    it('names every regime it counts, so a regime cannot be added without being counted', () => {
        const census = oracleRegimeCensus(PARSE_ORACLE);

        expect(Object.keys(census).sort()).toEqual([...ORACLE_REGIMES].sort());
    });

    it('reports how many cases each clause decided', () => {
        const census = oracleClauseCensus(PARSE_ORACLE);
        const decided = RUBRIC_CLAUSES.filter((clause) => census[clause] > 0);

        expect(Object.keys(census).sort()).toEqual([...RUBRIC_CLAUSES].sort());
        expect(decided.length, `no clause decided anything — counted ${JSON.stringify(census)}`).toBeGreaterThan(0);
    });

    it('counts every ruled case under exactly one clause', () => {
        const census = oracleClauseCensus(PARSE_ORACLE);
        const total = RUBRIC_CLAUSES.reduce((sum, clause) => sum + census[clause], 0);
        const ruled = PARSE_ORACLE.filter(isRuledOracleCase).length;

        expect(total).toBe(ruled);
    });
});

describe('the readings the oracle states', () => {
    const readings = PARSE_ORACLE.filter(isRuledOracleCase);

    it('never states an empty food name — an unnamed food is an absent one', () => {
        const blank = readings.filter((entry) => entry.verdict.reading.foods.some((food) => food.name.trim() === ''));

        expect(
            blank.map((entry) => entry.seed),
            'readings naming a food with no name',
        ).toEqual([]);
    });

    it('never spells an absent preparation as an empty string', () => {
        const blank = readings.filter((entry) => entry.verdict.reading.foods.some((food) => food.prep === ''));

        expect(
            blank.map((entry) => entry.seed),
            "readings spelling 'no preparation' as ''",
        ).toEqual([]);
    });

    it('never states a range whose upper bound is below its lower one', () => {
        const inverted = readings.filter(
            (entry) =>
                entry.verdict.reading.quantity.kind === 'range' &&
                entry.verdict.reading.quantity.high < entry.verdict.reading.quantity.low,
        );

        expect(
            inverted.map((entry) => entry.seed),
            'readings stating an inverted range',
        ).toEqual([]);
    });

    it('never states a unit without an amount to measure, nor an amount it calls absent alongside a number', () => {
        const incoherent = readings.filter(
            (entry) => entry.verdict.reading.unit !== null && entry.verdict.reading.quantity.kind === 'absent',
        );

        expect(
            incoherent.map((entry) => entry.seed),
            'readings naming a unit for an amount the source did not state',
        ).toEqual([]);
    });
});
