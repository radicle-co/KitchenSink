/**
 * Building the snapshot of an item's match lines from its parse job and the stored matches (ADR-0072 §4).
 *
 * The snapshot is the import's own copy of what the one-day parse job knew, so it must carry everything the wizard, the lists
 * and the save need, and nothing the job's expiry could take away. What each case guards:
 *
 *  - **The row is the one the editor saves** (`pastedLineRowOf`): the cook's own words win, only the first food of a line
 *    carries the measure, a leading size word is the unit, a dimension in parentheses is a NOTE and never the unit, and the
 *    cook's words are the shown name when the parse chose them (owner ruling 2026-11-08). The saved recipe line and the verdict
 *    key therefore agree with the proposal's, and the save path does not pay the gate again for a judgement on record. This
 *    was REWRITTEN for #166's row rule; the snapshot used to store the measure alone, which saved "3 large large eggs".
 *  - **One snapshot line per (line, food)**, copied from the CURRENT stored match: its tier, rung, candidates with their
 *    default mark, and the verification key. A food with no current match means the item is NOT ready to be snapshotted
 *    (`undefined`), never a snapshot with a hole in it.
 *  - **Lines that parsed to nothing** (unparseable, withdrawn, no foods) have no snapshot line: nothing was matched.
 */
import { describe, expect, it } from 'vitest';

import type { IngredientQuantity } from '@kitchensink/recipe-core';
import { lineDigest, parseStoredLineDigest } from '@kitchensink/recipe-core/parsing/parse-key';

import { sha256Hex } from '../../../common/sha256.js';
import {
    makeParseJobLine,
    makeParseJobRecord,
    makeStoredProposal,
} from '../../../recipes/__fixtures__/parseJobMatches.fixture.js';
import { quantityFromColumns } from '../../../recipes/dal/quantityColumns.js';
import { verdictKeyOfLine } from '../../../recipes/domain/lineVerdictKey.js';
import { matchJudgementDigestOf, matchJudgementOf } from '../../../recipes/domain/matchProposal.js';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import type { ParseJobMatch } from '../../../recipes/domain/parseJobMatch.js';
import { snapshotLinesOf } from '../snapshotLines.js';

const digestOf = (sourceLine: string) => parseStoredLineDigest(lineDigest(sourceLine, sha256Hex));

/** A current stored match for one food of the default line (`2 cups whole milk`). */
function matchFor(
    lineIndex: number,
    foodIndex: number,
    sourceLine: string,
    phrase: string,
    overrides: Partial<ParseJobMatch> = {},
    parse: { quantity: IngredientQuantity; unit: string | null; statedMeasure: string | null } = {
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
    },
): ParseJobMatch {
    const digest = digestOf(sourceLine);
    const line = { sourceLine, ...parse };

    return {
        lineIndex,
        foodIndex,
        lineDigest: digest,
        lineDigestNow: digest,
        judgementDigest: matchJudgementDigestOf({ lineDigest: digest, line, foodIndex, phrase }, sha256Hex),
        proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.2 },
        candidates: [
            { kind: 'root', id: 'F-whole', rung: 'head' },
            { kind: 'root', id: 'F-table', rung: 'default' },
        ],
        verificationKey: `v1:key-${String(lineIndex)}-${String(foodIndex)}`,
        review: 'owed',
        enqueuedAt: null,
        ...overrides,
    } as ParseJobMatch;
}

describe('snapshotLinesOf', () => {
    it('copies one line per (line, food) with the measure the editor saves, the cook’s words winning', () => {
        const job = makeParseJobRecord();
        const [line] = snapshotLinesOf(job, [matchFor(0, 0, '2 cups whole milk', 'whole milk')], sha256Hex) ?? [];

        expect(line).toMatchObject({
            lineIndex: 0,
            foodIndex: 0,
            sourceLine: '2 cups whole milk',
            phrase: 'whole milk',
            quantity: '2',
            quantityHigh: null,
            // The cook's own word for the unit ("cups", from the stated measure), not the parse's canonical "cup".
            unit: 'cups',
            statedQuantity: null,
            statedUnit: null,
            preparation: null,
            matchedBy: 'lexical',
            foodId: 'F-whole',
            foodVariantId: null,
            rung: 'head',
            margin: 0.2,
            verificationKey: 'v1:key-0-0',
            review: 'owed',
        });
        expect(line?.lineDigest).toBe(lineDigest('2 cups whole milk', sha256Hex));
        expect(line?.candidates).toEqual([
            { kind: 'root', id: 'F-whole', rung: 'head', isDefault: false },
            { kind: 'root', id: 'F-table', rung: 'default', isDefault: true },
        ]);
    });

    it('stores the judgement digest the paste matcher computed, so a pick is made against the same fact', () => {
        const [line] =
            snapshotLinesOf(makeParseJobRecord(), [matchFor(0, 0, '2 cups whole milk', 'whole milk')], sha256Hex) ?? [];

        expect(line?.judgementDigest).toBe(matchFor(0, 0, '2 cups whole milk', 'whole milk').judgementDigest);
    });

    it('⛔ only the FIRST food of a line carries the line’s measure', () => {
        const job = makeParseJobRecord({
            lines: [
                makeParseJobLine({
                    sourceLine: '1 tsp salt and pepper',
                    proposal: makeStoredProposal({
                        raw: '1 tsp salt and pepper',
                        quantity: { kind: 'exact', value: 1 },
                        unit: 'teaspoon',
                        statedMeasure: '1 tsp',
                        foods: [
                            { name: 'salt', prep: null },
                            { name: 'pepper', prep: 'ground' },
                        ],
                    }),
                }),
            ],
        });
        const parse = { quantity: { kind: 'exact' as const, value: 1 }, unit: 'teaspoon', statedMeasure: '1 tsp' };
        const lines = snapshotLinesOf(
            job,
            [
                matchFor(0, 0, '1 tsp salt and pepper', 'salt', {}, parse),
                matchFor(0, 1, '1 tsp salt and pepper', 'pepper', {}, parse),
            ],
            sha256Hex,
        );

        expect(lines?.map((line) => [line.foodIndex, line.phrase, line.quantity, line.unit, line.preparation])).toEqual(
            [
                [0, 'salt', '1', 'tsp', null],
                [1, 'pepper', null, '', 'ground'],
            ],
        );
    });

    it('reads a range as two columns and a line with no amount as none', () => {
        const range = makeParseJobRecord({
            lines: [
                makeParseJobLine({
                    proposal: makeStoredProposal({
                        quantity: { kind: 'range', low: 2, high: 3 },
                        statedMeasure: null,
                        unit: 'cup',
                    }),
                }),
            ],
        });
        const none = makeParseJobRecord({
            lines: [
                makeParseJobLine({
                    proposal: makeStoredProposal({ quantity: { kind: 'absent' }, statedMeasure: null, unit: null }),
                }),
            ],
        });
        const rangedMatch = matchFor(
            0,
            0,
            '2 cups whole milk',
            'whole milk',
            {},
            { quantity: { kind: 'range', low: 2, high: 3 }, unit: 'cup', statedMeasure: null },
        );
        const bareMatch = matchFor(
            0,
            0,
            '2 cups whole milk',
            'whole milk',
            {},
            { quantity: { kind: 'absent' }, unit: null, statedMeasure: null },
        );
        const [ranged] = snapshotLinesOf(range, [rangedMatch], sha256Hex) ?? [];
        const [bare] = snapshotLinesOf(none, [bareMatch], sha256Hex) ?? [];

        expect([ranged?.quantity, ranged?.quantityHigh, ranged?.unit]).toEqual(['2', '3', 'cup']);
        expect([bare?.quantity, bare?.quantityHigh, bare?.unit]).toEqual([null, null, '']);
    });

    it('⛔ is `undefined` when a parsed food has no CURRENT match: the item is not ready to snapshot', () => {
        const job = makeParseJobRecord();

        expect(snapshotLinesOf(job, [], sha256Hex)).toBeUndefined();
        expect(
            snapshotLinesOf(
                job,
                [{ ...matchFor(0, 0, '2 cups whole milk', 'whole milk'), judgementDigest: 'stale' }],
                sha256Hex,
            ),
        ).toBeUndefined();
    });

    it('keeps a line that found nothing: no proposal, no review, no key', () => {
        const [line] =
            snapshotLinesOf(
                makeParseJobRecord(),
                [
                    matchFor(0, 0, '2 cups whole milk', 'whole milk', {
                        proposal: null,
                        verificationKey: null,
                        review: null,
                        candidates: [],
                    }),
                ],
                sha256Hex,
            ) ?? [];

        expect(line).toMatchObject({
            matchedBy: null,
            foodId: null,
            foodVariantId: null,
            rung: null,
            margin: null,
            verificationKey: null,
            review: null,
            candidates: [],
        });
    });

    it('keeps a proposed variant as a variant, and a refused review without a key', () => {
        const [line] =
            snapshotLinesOf(
                makeParseJobRecord(),
                [
                    matchFor(0, 0, '2 cups whole milk', 'whole milk', {
                        proposal: {
                            matchedBy: 'curated',
                            food: { kind: 'variant', id: 'V-flat' },
                            rung: null,
                            margin: null,
                        },
                        verificationKey: null,
                        review: 'refused',
                    }),
                ],
                sha256Hex,
            ) ?? [];

        expect(line).toMatchObject({
            matchedBy: 'curated',
            foodId: null,
            foodVariantId: 'V-flat',
            verificationKey: null,
            review: 'refused',
        });
    });

    it('gives a blank preparation as none (the column refuses a blank)', () => {
        const job = makeParseJobRecord({
            lines: [
                makeParseJobLine({ proposal: makeStoredProposal({ foods: [{ name: 'whole milk', prep: '  ' }] }) }),
            ],
        });
        const [line] = snapshotLinesOf(job, [matchFor(0, 0, '2 cups whole milk', 'whole milk')], sha256Hex) ?? [];

        expect(line?.preparation).toBeNull();
    });

    it('snapshots nothing for lines that parsed to nothing: unparseable, withdrawn, or a line with no foods', () => {
        const job = makeParseJobRecord({
            lines: [
                makeParseJobLine({ lineIndex: 0, sourceLine: 'Heading', status: 'unparseable', proposal: null }),
                makeParseJobLine({ lineIndex: 1, sourceLine: 'kept as written', status: 'withdrawn', proposal: null }),
                makeParseJobLine({
                    lineIndex: 2,
                    sourceLine: 'FOR THE SAUCE',
                    proposal: makeStoredProposal({ raw: 'FOR THE SAUCE', foods: [] }),
                }),
            ],
        });

        expect(snapshotLinesOf(job, [], sha256Hex)).toEqual([]);
    });

    describe('⛔ stores the row the editor saves, so the saved line reads as the cook wrote it and keys as the proposal did', () => {
        const FOOD = 'F-whole';
        const exact = (value: number): IngredientQuantity => ({ kind: 'exact', value });

        /** One parsed line, its current match keyed by the matcher, and the snapshot of its first food. */
        function snapshotOf(
            sourceLine: string,
            phrase: string,
            parse: { quantity: IngredientQuantity; unit: string | null; statedMeasure: string | null },
            display: 'written' | 'food' | null = null,
        ) {
            const job = makeParseJobRecord({
                lines: [
                    makeParseJobLine({
                        sourceLine,
                        proposal: makeStoredProposal({
                            raw: sourceLine,
                            ...parse,
                            foods: [{ name: phrase, prep: null, display }],
                        }),
                    }),
                ],
            });
            const judgement = matchJudgementOf({ sourceLine, ...parse }, 0, phrase, FOOD);
            const key = judgement === undefined ? null : verificationKey(judgement, sha256Hex);
            const match = matchFor(0, 0, sourceLine, phrase, { verificationKey: key }, parse);
            const [line] = snapshotLinesOf(job, [match], sha256Hex) ?? [];

            if (line === undefined) {
                throw new Error('no snapshot line');
            }

            return { line, key };
        }

        it.each([
            ['3 large eggs', 'large eggs', { quantity: exact(3), unit: null, statedMeasure: '3' }],
            [
                '1 (9 inch) double-crust pie pastry',
                '9 inch double-crust pie pastry',
                { quantity: exact(1), unit: null, statedMeasure: '1 (9 inch)' },
            ],
            [
                '1 (28 ounce) can crushed tomatoes',
                'can crushed tomatoes',
                { quantity: exact(1), unit: 'ounce', statedMeasure: '1 (28 ounce) can' },
            ],
            ['2 tbsp olive oil', 'olive oil', { quantity: exact(2), unit: 'tablespoon', statedMeasure: '2 tbsp' }],
        ] as const)('the saved line keys exactly as the proposal for %j', (sourceLine, phrase, parse) => {
            const { line, key } = snapshotOf(sourceLine, phrase, parse);
            const saved = verdictKeyOfLine(
                { sourceLine, quantity: quantityFromColumns(line), unit: line.unit, statedMeasure: undefined },
                FOOD,
                sha256Hex,
            );

            expect(saved).toBe(key);
        });

        it('a leading size word is the unit, and the name does not repeat it', () => {
            const { line } = snapshotOf('3 large eggs', 'large eggs', {
                quantity: exact(3),
                unit: null,
                statedMeasure: '3',
            });

            expect([line.quantity, line.unit, line.name, line.note]).toEqual(['3', 'large', 'eggs', null]);
            // The phrase stays whole: it is what the chain was asked.
            expect(line.phrase).toBe('large eggs');
        });

        it('⛔ a dimension in parentheses is a NOTE, never the unit', () => {
            const { line } = snapshotOf('1 (9 inch) double-crust pie pastry', '9 inch double-crust pie pastry', {
                quantity: exact(1),
                unit: null,
                statedMeasure: '1 (9 inch)',
            });

            expect([line.unit, line.note, line.name]).toEqual(['', '9 inch', 'double-crust pie pastry']);
        });

        it('the cook’s words are the shown name only when the parse chose them', () => {
            const parse = { quantity: exact(1), unit: 'pound', statedMeasure: '1 lb' };
            const written = snapshotOf('1 lb lean ground beef', 'lean ground beef', parse, 'written').line;
            const food = snapshotOf('1 lb lean ground beef', 'lean ground beef', parse, 'food').line;

            expect(written.displayText).toBe('lean ground beef');
            expect(food.displayText).toBeNull();
        });
    });
});
