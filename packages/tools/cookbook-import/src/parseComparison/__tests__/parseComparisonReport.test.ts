import { describe, expect, it } from 'vitest';

import type { ParseAgreement } from '../parseAgreement.js';
import { pairDeterminism, summarizeDeterminism, summarizeParseComparison } from '../parseComparisonReport.js';
import type { DeterminismPair, ParseTrial } from '../parseComparisonReport.js';

function trial(overrides: Partial<ParseTrial> = {}): ParseTrial {
    return {
        modelId: 'amazon.nova-micro-v1:0',
        lineId: 'L0001',
        outcome: 'valid',
        stopReason: 'end_turn',
        costMicros: 10,
        recovered: false,
        origin: 'ingredient',
        shapeDetail: undefined,
        agreement: undefined,
        ...overrides,
    };
}

function agreement(overrides: Partial<ParseAgreement> = {}): ParseAgreement {
    return { measure: 'agree', names: 'agree', prep: 'agree', kind: 'agree', agrees: true, ...overrides };
}

describe('summarizeParseComparison', () => {
    it('reports one row per model, in the order the models were asked for', () => {
        const reports = summarizeParseComparison([trial({ modelId: 'b' }), trial({ modelId: 'a' })], ['a', 'b']);

        expect(reports.map((report) => report.modelId)).toEqual(['a', 'b']);
    });

    it('reports a model that was asked for but produced no trial, rather than dropping it silently', () => {
        const reports = summarizeParseComparison([], ['a']);

        expect(reports).toHaveLength(1);
        expect(reports[0]?.trials).toBe(0);
        expect(reports[0]?.contractComplianceRate).toBe(0);
    });

    it('counts each contract outcome in its own bucket', () => {
        const reports = summarizeParseComparison(
            [
                trial({ outcome: 'valid' }),
                trial({ outcome: 'valid' }),
                trial({ outcome: 'proseWrapper' }),
                trial({ outcome: 'malformedJson' }),
                trial({ outcome: 'wrongShape' }),
                trial({ outcome: 'truncated' }),
            ],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.contract).toEqual({
            valid: 2,
            proseWrapper: 1,
            malformedJson: 1,
            wrongShape: 1,
            truncated: 1,
        });
    });

    it('denominates compliance on every trial, so a wrapper counts against the model', () => {
        const reports = summarizeParseComparison(
            [trial({ outcome: 'valid' }), trial({ outcome: 'proseWrapper' })],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.contractComplianceRate).toBe(0.5);
    });

    describe('a call that never arrived', () => {
        it("is kept out of the contract buckets — it is our transport, not the model's answer", () => {
            const reports = summarizeParseComparison(
                [trial({ outcome: 'valid' }), trial({ outcome: 'callFailed', stopReason: 'ThrottlingException' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.contract.valid).toBe(1);
            expect(reports[0]?.callsFailed).toBe(1);
            expect(reports[0]?.responses).toBe(1);
        });

        it('is kept out of the compliance denominator, so throttling cannot look like non-compliance', () => {
            const reports = summarizeParseComparison(
                [trial({ outcome: 'valid' }), trial({ outcome: 'callFailed', stopReason: 'ThrottlingException' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.contractComplianceRate).toBe(1);
        });

        it('is still counted as an attempt, so a degraded run cannot read as a clean one', () => {
            const reports = summarizeParseComparison(
                [trial({ outcome: 'callFailed', stopReason: 'ThrottlingException' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.trials).toBe(1);
            expect(reports[0]?.responses).toBe(0);
            expect(reports[0]?.contractComplianceRate).toBe(0);
        });

        it('names itself in the stop-reason census, which is the first thing a reader checks', () => {
            const reports = summarizeParseComparison(
                [trial({ outcome: 'callFailed', stopReason: 'ThrottlingException' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.stopReasons).toEqual({ ThrottlingException: 1 });
        });
    });

    describe('recovery from a wrapper', () => {
        it('reports what a three-line reader change would buy, without calling it compliance', () => {
            const reports = summarizeParseComparison(
                [
                    trial({ outcome: 'valid' }),
                    trial({ outcome: 'proseWrapper', recovered: true }),
                    trial({ outcome: 'malformedJson', recovered: false }),
                    trial({ outcome: 'proseWrapper', recovered: false }),
                ],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.contractComplianceRate).toBe(0.25);
            expect(reports[0]?.recoveredFromWrapper).toBe(1);
            expect(reports[0]?.complianceAfterUnwrapRate).toBe(0.5);
        });

        it('never counts a valid answer as recovered — the two must not double up', () => {
            const reports = summarizeParseComparison(
                [trial({ outcome: 'valid' }), trial({ outcome: 'valid' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.recoveredFromWrapper).toBe(0);
            expect(reports[0]?.complianceAfterUnwrapRate).toBe(1);
        });
    });

    describe('the wrong-shape census', () => {
        it('tallies WHICH part of the shape failed, so 20% non-compliance can be read as one cause or many', () => {
            const reports = summarizeParseComparison(
                [
                    trial({ outcome: 'wrongShape', shapeDetail: 'measure: expected string, received null' }),
                    trial({ outcome: 'wrongShape', shapeDetail: 'measure: expected string, received null' }),
                    trial({ outcome: 'wrongShape', shapeDetail: 'foods: expected array, received undefined' }),
                ],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.wrongShapeReasons).toEqual({
                'measure: expected string, received null': 2,
                'foods: expected array, received undefined': 1,
            });
        });

        it('is empty when nothing failed on shape', () => {
            expect(summarizeParseComparison([trial()], ['amazon.nova-micro-v1:0'])[0]?.wrongShapeReasons).toEqual({});
        });

        it('ignores a detail carried by an outcome that is not a shape failure', () => {
            const reports = summarizeParseComparison(
                [trial({ outcome: 'malformedJson', shapeDetail: 'stray bracket' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.wrongShapeReasons).toEqual({});
        });
    });

    describe('the per-origin split', () => {
        it('reports each half of the corpus separately — they are different populations', () => {
            const reports = summarizeParseComparison(
                [
                    trial({ origin: 'ingredient', agreement: agreement() }),
                    trial({
                        origin: 'ingredient',
                        agreement: agreement({ names: 'differ', kind: 'differ', agrees: false }),
                    }),
                    trial({
                        origin: 'dropped',
                        agreement: agreement({ names: 'differ', kind: 'differ', agrees: false }),
                    }),
                    trial({
                        origin: 'dropped',
                        agreement: agreement({ names: 'differ', kind: 'differ', agrees: false }),
                    }),
                ],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.byOrigin.ingredient.crfCompared).toBe(2);
            expect(reports[0]?.byOrigin.ingredient.crfAgreementRate).toBe(0.5);
            expect(reports[0]?.byOrigin.dropped.crfCompared).toBe(2);
            expect(reports[0]?.byOrigin.dropped.crfAgreementRate).toBe(0);
        });

        it('reports compliance per half too, since a model may refuse more on text that is not a recipe line', () => {
            const reports = summarizeParseComparison(
                [
                    trial({ origin: 'ingredient', outcome: 'valid' }),
                    trial({ origin: 'ingredient', outcome: 'valid' }),
                    trial({ origin: 'dropped', outcome: 'valid' }),
                    trial({ origin: 'dropped', outcome: 'wrongShape' }),
                ],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.byOrigin.ingredient.contractComplianceRate).toBe(1);
            expect(reports[0]?.byOrigin.dropped.contractComplianceRate).toBe(0.5);
        });

        it('reports a half with no trials as measured on nothing, not as perfect', () => {
            const reports = summarizeParseComparison([trial({ origin: 'ingredient' })], ['amazon.nova-micro-v1:0']);

            expect(reports[0]?.byOrigin.dropped.responses).toBe(0);
            expect(reports[0]?.byOrigin.dropped.contractComplianceRate).toBe(0);
        });
    });

    describe('the measure split', () => {
        it('reports quantity and unit agreement apart, because only one is reachable through the other', () => {
            const reports = summarizeParseComparison(
                [
                    trial({ agreement: agreement() }),
                    trial({
                        agreement: agreement({ measure: 'quantityDiffers', kind: 'quantityDiffers', agrees: false }),
                    }),
                    trial({ agreement: agreement({ measure: 'unitDiffers', kind: 'unitDiffers', agrees: false }) }),
                    trial({ agreement: agreement({ measure: 'crfUnitInName', kind: 'crfUnitInName', agrees: false }) }),
                ],
                ['amazon.nova-micro-v1:0'],
            );

            // Unit agreement is only observable on the two verdicts that reached the quantity comparison.
            expect(reports[0]?.measureSplit).toEqual({ unitAgreed: 2, quantityAgreed: 1, quantityObservable: 2 });
        });
    });

    it('censuses the stop reasons, which is how a run degraded by throttling is told from model behaviour', () => {
        const reports = summarizeParseComparison(
            [trial({ stopReason: 'end_turn' }), trial({ stopReason: 'max_tokens', outcome: 'truncated' })],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.stopReasons).toEqual({ end_turn: 1, max_tokens: 1 });
    });

    it('sums and means the cost over every attempt, including the ones that produced nothing usable', () => {
        const reports = summarizeParseComparison(
            [trial({ costMicros: 10 }), trial({ costMicros: 20, outcome: 'malformedJson' })],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.totalCostMicros).toBe(30);
        expect(reports[0]?.meanCostMicros).toBe(15);
    });

    it('denominates the CRF agreement on the trials that were COMPARED, not on every trial', () => {
        const reports = summarizeParseComparison(
            [
                trial({ agreement: agreement() }),
                trial({ agreement: agreement({ measure: 'unitDiffers', kind: 'unitDiffers', agrees: false }) }),
                trial({ outcome: 'malformedJson', agreement: undefined }),
            ],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.crfCompared).toBe(2);
        expect(reports[0]?.crfAgreementRate).toBe(0.5);
    });

    it('reports a zero CRF agreement rate rather than a division by zero when nothing was compared', () => {
        const reports = summarizeParseComparison([trial({ outcome: 'malformedJson' })], ['amazon.nova-micro-v1:0']);

        expect(reports[0]?.crfCompared).toBe(0);
        expect(reports[0]?.crfAgreementRate).toBe(0);
    });

    it('tallies the disagreement kinds so the candidate list for adjudication is sized', () => {
        const reports = summarizeParseComparison(
            [
                trial({ agreement: agreement({ measure: 'crfUnitInName', kind: 'crfUnitInName', agrees: false }) }),
                trial({ agreement: agreement({ measure: 'crfUnitInName', kind: 'crfUnitInName', agrees: false }) }),
                trial({
                    agreement: agreement({ prep: 'crfPrepInModelName', kind: 'crfPrepInModelName', agrees: false }),
                }),
                trial({ agreement: agreement() }),
            ],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.disagreementKinds['crfUnitInName']).toBe(2);
        expect(reports[0]?.disagreementKinds['crfPrepInModelName']).toBe(1);
        expect(reports[0]?.disagreementKinds['agree']).toBeUndefined();
    });

    it("reports each field's own agreement rate, because the three fields fail for different reasons", () => {
        const reports = summarizeParseComparison(
            [
                trial({ agreement: agreement({ measure: 'unitDiffers', kind: 'unitDiffers', agrees: false }) }),
                trial({ agreement: agreement({ names: 'differ', kind: 'differ', agrees: false }) }),
            ],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.fieldAgreementRates).toEqual({ measure: 0.5, names: 0.5, prep: 1 });
    });
});

describe('summarizeDeterminism', () => {
    function pair(overrides: Partial<DeterminismPair> = {}): DeterminismPair {
        return {
            modelId: 'amazon.nova-micro-v1:0',
            lineId: 'L0001',
            firstText: '{"a":1}',
            secondText: '{"a":1}',
            responded: true,
            comparable: true,
            divergentFields: [],
            ...overrides,
        };
    }

    it('reports a model with no pairs as measured on nothing rather than as perfectly stable', () => {
        const reports = summarizeDeterminism([], ['a']);

        expect(reports[0]?.pairs).toBe(0);
        expect(reports[0]?.comparablePairs).toBe(0);
        expect(reports[0]?.divergentRate).toBe(0);
        expect(reports[0]?.byteIdenticalRate).toBe(0);
    });

    describe('a pair that could not be read', () => {
        it('is kept out of the divergence denominator — stability was not measured on it', () => {
            const reports = summarizeDeterminism(
                [
                    pair({ divergentFields: ['prep'] }),
                    pair({ comparable: false, secondText: 'sorry', divergentFields: [] }),
                ],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.pairs).toBe(2);
            expect(reports[0]?.comparablePairs).toBe(1);
            expect(reports[0]?.divergentRate).toBe(1);
        });

        it('still counts toward byte identity, which needs no reading at all', () => {
            const reports = summarizeDeterminism(
                [pair({ comparable: false, firstText: 'sorry', secondText: 'sorry' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.byteIdenticalRate).toBe(1);
            expect(reports[0]?.comparablePairs).toBe(0);
            expect(reports[0]?.divergentRate).toBe(0);
        });
    });

    describe('a pair where a call never arrived', () => {
        it('does NOT count two non-answers as byte-identical — that is not determinism', () => {
            const reports = summarizeDeterminism(
                [pair({ responded: false, comparable: false, firstText: '', secondText: '' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.byteIdenticalRate).toBe(0);
            expect(reports[0]?.respondedPairs).toBe(0);
        });

        it('keeps a pair where both passes really answered in the byte-identity denominator', () => {
            const reports = summarizeDeterminism(
                [pair(), pair({ responded: false, comparable: false, firstText: '', secondText: '' })],
                ['amazon.nova-micro-v1:0'],
            );

            expect(reports[0]?.pairs).toBe(2);
            expect(reports[0]?.respondedPairs).toBe(1);
            expect(reports[0]?.byteIdenticalRate).toBe(1);
        });
    });

    it('counts two byte-identical answers as identical and as not divergent', () => {
        const reports = summarizeDeterminism([pair()], ['amazon.nova-micro-v1:0']);

        expect(reports[0]?.byteIdenticalRate).toBe(1);
        expect(reports[0]?.divergentRate).toBe(0);
    });

    it('separates a formatting-only difference from a content difference', () => {
        const reports = summarizeDeterminism(
            [pair({ secondText: '{ "a": 1 }', divergentFields: [] })],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.byteIdenticalRate).toBe(0);
        expect(reports[0]?.divergentRate).toBe(0);
    });

    it('counts a content difference as divergent', () => {
        const reports = summarizeDeterminism(
            [pair({ secondText: '{"a":2}', divergentFields: ['prep'] })],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.divergentRate).toBe(1);
    });

    it('tallies which field moved, so the flip can be described rather than only counted', () => {
        const reports = summarizeDeterminism(
            [
                pair({ divergentFields: ['prep'] }),
                pair({ divergentFields: ['prep', 'measure'] }),
                pair({ divergentFields: [] }),
            ],
            ['amazon.nova-micro-v1:0'],
        );

        expect(reports[0]?.divergentFieldCounts).toEqual({ prep: 2, measure: 1 });
        expect(reports[0]?.divergentRate).toBeCloseTo(2 / 3, 10);
    });
});

describe('pairDeterminism', () => {
    const BARE = '{"measure":"one cup","foods":[{"name":"milk","prep":null}]}';
    const OTHER = '{"measure":"two cups","foods":[{"name":"milk","prep":null}]}';
    const pass = (responseText: string, responded = true) => ({ lineId: 'L0001', responded, responseText });

    it('pairs two answers that say the same thing', () => {
        expect(pairDeterminism('m', pass(BARE), pass(BARE))).toEqual({
            modelId: 'm',
            lineId: 'L0001',
            firstText: BARE,
            secondText: BARE,
            responded: true,
            comparable: true,
            divergentFields: [],
        });
    });

    it('reports the field that moved', () => {
        expect(pairDeterminism('m', pass(BARE), pass(OTHER)).divergentFields).toEqual(['measure']);
    });

    it('marks a pair with an unreadable pass as not comparable, and claims no divergence for it', () => {
        const paired = pairDeterminism('m', pass(BARE), pass('sorry, I cannot'));

        expect(paired.responded).toBe(true);
        expect(paired.comparable).toBe(false);
        expect(paired.divergentFields).toEqual([]);
    });

    it('marks a pair where a call never arrived as neither responded nor comparable', () => {
        const paired = pairDeterminism('m', pass(BARE), pass('', false));

        expect(paired.responded).toBe(false);
        expect(paired.comparable).toBe(false);
    });

    it('carries the raw texts through, because byte identity is measured on them', () => {
        const paired = pairDeterminism('m', pass(`  ${BARE}`), pass(BARE));

        expect(paired.firstText).toBe(`  ${BARE}`);
        expect(paired.comparable).toBe(true);
        expect(paired.divergentFields).toEqual([]);
    });
});
