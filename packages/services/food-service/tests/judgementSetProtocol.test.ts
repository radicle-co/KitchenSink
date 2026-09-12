// @vitest-environment node
/**
 * The Golden Relevance Judgement Set must satisfy its own annotation protocol before anything gates on it.
 *
 * ## Why the protocol is the thing under test, not the entries
 *
 * U5's acceptance floors are `precision@1 >= 0.9` single-token and `>= 0.85` multi-word. Those numbers are
 * meaningless against a set one person labelled: the ranker would be measured against one annotator's taste,
 * which is the over-fitting R58 and R59 exist to prevent. The plan is explicit that precision is stated
 * against inter-annotator agreement rather than 100% — three annotators agreed unanimously on the correct
 * USDA row only **61%** of the time in published work, and dietitians **51%**.
 *
 * So the set carries **two independent labels per entry**, disagreements go to a third adjudicating pass whose
 * resolution is recorded in the entry's `why`, and the OBSERVED agreement rate is committed alongside the set
 * so 0.9 and 0.85 are read against our own ceiling rather than a published one.
 *
 * ⛔ **The set is deliberately NOT gate-ready yet, and this suite proves that rather than hiding it.** A
 * machine can propose a label; it cannot be two independent annotators. Every entry below therefore carries
 * one `proposed` label and awaits a human `second` pass. {@link isGateReady} returns false while any entry
 * does, and {@link observedAgreementRate} returns `undefined` rather than a flattering number — a set that
 * reported 1.0 because it had only ever been labelled once would be worse than no set at all.
 *
 * The corpus-sampled multi-word entries R58 requires are absent for a different reason: they must be drawn
 * from the 448-recipe import corpus, which is an operator-downloaded file (`cookbook-import/README.md` step
 * 1) that is not in this repository and that nothing here may fetch (ADR-0023).
 */
import { describe, expect, it } from 'vitest';

import { JUDGEMENT_SET, isGateReady, observedAgreementRate, type JudgementEntry } from './__fixtures__/judgementSet.js';

/** A synthetic entry, so the protocol predicates are provable without depending on the real set's contents. */
function makeEntry(overrides: Partial<JudgementEntry> = {}): JudgementEntry {
    return {
        query: 'probe',
        labels: [
            { annotator: 'proposed', expectedTopFoodName: 'Probe' },
            { annotator: 'second', expectedTopFoodName: 'Probe' },
        ],
        why: 'synthetic',
        knownMiss: false,
        ...overrides,
    };
}

describe('judgement set annotation protocol', () => {
    it('gives every entry a unique query', () => {
        const queries = JUDGEMENT_SET.map((entry) => entry.query);

        expect(queries).toEqual([...new Set(queries)]);
    });

    it('records a non-empty rationale on every entry', () => {
        expect(JUDGEMENT_SET.filter((entry) => entry.why.trim().length === 0)).toEqual([]);
    });

    it('reports the set as NOT gate-ready while any entry lacks a second independent label', () => {
        // This is the honest state today and the assertion that will flip when a human labels the set.
        expect(isGateReady(JUDGEMENT_SET)).toBe(false);
    });

    it('withholds an agreement rate rather than reporting one from a single annotator', () => {
        expect(observedAgreementRate(JUDGEMENT_SET)).toBeUndefined();
    });

    it('derives the agreement rate from the labels once two annotators exist', () => {
        const agree = makeEntry({ query: 'a' });
        const disagree = makeEntry({
            query: 'b',
            labels: [
                { annotator: 'proposed', expectedTopFoodName: 'One' },
                { annotator: 'second', expectedTopFoodName: 'Two' },
            ],
            adjudication: { expectedTopFoodName: 'One', why: 'third pass chose One' },
        });

        expect(observedAgreementRate([agree, disagree])).toBe(0.5);
        expect(isGateReady([agree, disagree])).toBe(true);
    });

    it('refuses a disagreement that was never adjudicated', () => {
        const unresolved = makeEntry({
            labels: [
                { annotator: 'proposed', expectedTopFoodName: 'One' },
                { annotator: 'second', expectedTopFoodName: 'Two' },
            ],
        });

        expect(isGateReady([unresolved])).toBe(false);
    });
});
