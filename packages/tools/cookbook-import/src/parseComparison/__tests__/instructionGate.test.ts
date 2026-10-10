/**
 * The instruction gate's corpus measurement (plan 001 §6): which lines a rule skips, and which of those named a food
 * by an independent oracle — each one a false refusal a person must adjudicate before the gate may ship.
 *
 * Run 1 uses the NYT ingredient corpus, whose `name` column is a person's label: a skipped row with a name is a false
 * refusal. Run 2 uses the 1919 clauses with the local CRF as the oracle: a skipped clause the CRF named something in
 * goes on the adjudication list, which errs toward listing too much.
 *
 * The rule is a parameter, and these tests pass a stand-in that skips exactly the lines they list, so they measure the
 * reducers and not the lexicon. The real rule's cases are `src/parsing/__tests__/lineAdmission.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { gateOverClauses, gateOverLabelledRows } from '../instructionGate.js';

/** A stand-in rule that skips exactly `lines`. */
function skipsOnly(...lines: readonly string[]): (line: string) => boolean {
    return (line) => lines.includes(line);
}

describe('gateOverLabelledRows (run 1: NYT, a person labelled each row)', () => {
    it('counts the skipped rows and lists every skipped row that names a food', () => {
        const report = gateOverLabelledRows(
            [
                { input: '2 cups flour', name: 'flour' },
                { input: 'Mix well', name: '' },
                { input: 'Serve hot with rice', name: 'rice' },
                { input: 'Butter, for greasing', name: 'butter' },
            ],
            skipsOnly('Mix well', 'Serve hot with rice'),
        );

        expect(report).toStrictEqual({
            total: 4,
            skipped: 2,
            falseRefusals: [{ input: 'Serve hot with rice', name: 'rice' }],
        });
    });

    it('treats a name of only whitespace as no name', () => {
        expect(
            gateOverLabelledRows([{ input: 'Mix well', name: '  ' }], skipsOnly('Mix well')).falseRefusals,
        ).toStrictEqual([]);
    });

    it('lists no false refusal for a named row the rule admits', () => {
        expect(gateOverLabelledRows([{ input: 'Add salt', name: 'salt' }], skipsOnly()).falseRefusals).toStrictEqual(
            [],
        );
    });
});

describe('gateOverClauses (run 2: the 1919 clauses, the CRF as oracle)', () => {
    it('lists every skipped clause the oracle named a food in, for a person to adjudicate', () => {
        const named = new Map([
            ['Rub to a cream.', ['cream']],
            ['Put on a platter.', []],
            ['2 cups flour', ['flour']],
        ]);

        const report = gateOverClauses(
            ['Rub to a cream.', 'Put on a platter.', '2 cups flour'],
            skipsOnly('Rub to a cream.', 'Put on a platter.'),
            (clause) => named.get(clause) ?? [],
        );

        expect(report).toStrictEqual({
            total: 3,
            skipped: 2,
            toAdjudicate: [{ clause: 'Rub to a cream.', oracleNamed: ['cream'] }],
        });
    });

    it('never asks the oracle about a clause the rule admits', () => {
        const asked: string[] = [];

        gateOverClauses(['2 cups flour', 'Put on a platter.'], skipsOnly('Put on a platter.'), (clause) => {
            asked.push(clause);

            return [];
        });

        expect(asked).toStrictEqual(['Put on a platter.']);
    });
});
