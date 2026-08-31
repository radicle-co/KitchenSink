/**
 * KTD-3's guards as a TRUTH TABLE — the whole decision the verification gate makes before it spends a cent.
 *
 * ⛔ THE PROPERTY THIS FILE EXISTS TO PIN, and the defect it was written against:
 *
 * KTD-3 states that an exact tier-1 hit "skips the **food-identity check only**. A curated mapping is keyed
 * on a normalized phrase and can establish nothing about quantity. The parser defects this plan exists to fix
 * are quantity defects and they land on tier-1 lines too." That argument is word-for-word true of a wide
 * lexical margin and of nutrient equivalence: all three are facts about WHICH CANDIDATE RANKED BEST — i.e.
 * about identity — and none of them observes a quantity, a unit or a range. An earlier reading of the plan
 * let the margin door skip the WHOLE gate, which would have published an unchecked quantity on every
 * wide-margin line, and quantity defects are 100% of what U7 exists to fix.
 *
 * So the skip set is PER-ASPECT: identity evidence can only ever excuse the identity aspect, and
 * **quantity is never skippable by anything**. The tests below fire every combination at that rule.
 *
 * ⚠️ Nutrient equivalence is measured and REPORTED, never a door. KTD-3 guards it with "applies only when the
 * winning candidate also cleared the margin test", and a cleared margin is ALREADY an independent skip
 * condition — so as a door it is strictly subsumed and could never widen the skip set. Inventing a second,
 * lower margin threshold to give it work would breach R17 (the bands are MEASURED; the bake-off has not run).
 * It is therefore demoted to an observation, which is exactly the evidence a later calibration needs in order
 * to decide whether it deserves to be a door. Recorded here because it AMENDS KTD-3.
 */
import { describe, expect, it } from 'vitest';

import {
    PROVISIONAL_VERIFICATION_THRESHOLDS,
    curatedExactEvidence,
    decideVerification,
    rankedEvidence,
    rememberedEvidence,
    unattributedEvidence,
    type ScoredCandidate,
    type VerificationGateInput,
} from '../verificationGatePolicy.js';

const LINE = '2 cups all-purpose flour';

const candidate = (score: number, overrides: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
    foodId: `food-${score}`,
    score,
    energyKcalPer100g: 364,
    proteinGPer100g: 10,
    fatGPer100g: 1,
    carbohydrateGPer100g: 76,
    ...overrides,
});

const input = (overrides: Partial<VerificationGateInput> = {}): VerificationGateInput => ({
    sourceLine: LINE,
    evidence: rankedEvidence([candidate(0.9), candidate(0.2)]),
    thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
    ...overrides,
});

/** The aspects a decision asks about, or `[]` when it does not verify. */
function aspectsOf(decision: ReturnType<typeof decideVerification>): readonly string[] {
    return decision.kind === 'verify' ? [...decision.aspects].sort() : [];
}

describe('quantity is never skippable — by anything', () => {
    it.each([
        ['a curated exact hit', curatedExactEvidence()],
        ['a remembered resolution', rememberedEvidence()],
        ['a shortlist with an enormous margin', rankedEvidence([candidate(1), candidate(0)])],
        ['a shortlist whose candidates agree perfectly on nutrients', rankedEvidence([candidate(1), candidate(0)])],
        ['a singleton shortlist', rankedEvidence([candidate(1)])],
        ['an empty shortlist', rankedEvidence([])],
        ['no recorded provenance at all', unattributedEvidence()],
    ])('still verifies quantity given %s', (_label, evidence) => {
        // ⛔ THE CORE RULE. Every piece of evidence the cascade can produce is evidence about IDENTITY. None
        // of it has ever looked at a number, a unit or a range — and the parser defects this whole plan exists
        // to fix are quantity defects.
        expect(aspectsOf(decideVerification(input({ evidence })))).toContain('quantity');
    });
});

describe('identity is skipped only on identity evidence', () => {
    it('is skipped for an exact curated hit — a human asserted this phrase means this food', () => {
        const decision = decideVerification(input({ evidence: curatedExactEvidence() }));

        expect(aspectsOf(decision)).toEqual(['quantity']);
    });

    it('is skipped for a wide margin over TWO OR MORE scored candidates', () => {
        const decision = decideVerification(input({ evidence: rankedEvidence([candidate(0.95), candidate(0.1)]) }));

        expect(aspectsOf(decision)).toEqual(['quantity']);
    });

    it('is VERIFIED for a singleton shortlist, whatever it scored', () => {
        // ⛔ KTD-3's first guard, and the one that inverts its own intent if forgotten: a naive `top − next`
        // on a shortlist of one reads as MAXIMAL confidence and routes straight to publish. A lone
        // high-scoring candidate measured 50% accurate against 71% when several were offered — a candidate
        // with nothing behind it is a warning sign, not a confirmation.
        const decision = decideVerification(input({ evidence: rankedEvidence([candidate(1)]) }));

        expect(aspectsOf(decision)).toEqual(['identity', 'quantity']);
    });

    it('is VERIFIED for an empty shortlist', () => {
        // The state the tree is actually in until U5 ships a scored lexical tier. Zero is fewer than two, so
        // the margin door is correctly inert with no special case anywhere.
        expect(aspectsOf(decideVerification(input({ evidence: rankedEvidence([]) })))).toEqual([
            'identity',
            'quantity',
        ]);
    });

    it('is VERIFIED when the caller recorded NO provenance for the resolution', () => {
        // ⛔ THE PRODUCER'S REAL STATE. `RecipesService` enqueues from PERSISTED ingredient rows: the cascade
        // outcome that first resolved the catalog row was discarded at
        // `IngredientsService.resolveThroughCascade`, and nothing persists which tier answered.
        //
        // ⚠️ It decides IDENTICALLY to `rankedEvidence([])` — see the next case, which asserts that on
        // purpose so nobody "simplifies" this member away believing it changes an outcome. It earns its
        // place on the WIRE, where `ranked` would assert that a lexical tier ran, on a value a
        // separately-deployed consumer re-reads and a future skip door will key on.
        expect(aspectsOf(decideVerification(input({ evidence: unattributedEvidence() })))).toEqual([
            'identity',
            'quantity',
        ]);
    });

    it('observes exactly what an empty ranked shortlist observes — the member is a WIRE claim, not a verdict', () => {
        // ⛔ ASSERTED, not assumed. An earlier docstring claimed the difference was "very visible in
        // GateObservations"; it is not, and a justification that cites evidence which does not exist is worse
        // than none. Pinning the equality here is what keeps the real reason (the wire enum) the stated one.
        const unattributed = decideVerification(input({ evidence: unattributedEvidence() }));
        const emptyRanked = decideVerification(input({ evidence: rankedEvidence([]) }));

        expect(unattributed.observations).toEqual(emptyRanked.observations);

        const decision = unattributed;

        expect(decision.observations.shortlistSize).toBe(0);
        // ⛔ `undefined`, never `0`: a margin of zero is a real observation (two candidates tied). There were
        // no candidates at all here, and a calibration reading these rows must be able to tell those apart.
        expect(decision.observations.margin).toBeUndefined();
        expect(decision.observations.nutrientAgreement).toBe('unknown');
    });

    it('is VERIFIED for a NARROW margin, however high the top score', () => {
        // Abstain on MARGIN, not on SCORE. Two candidates at 0.98 and 0.97 are a coin flip dressed as
        // confidence.
        const decision = decideVerification(input({ evidence: rankedEvidence([candidate(0.98), candidate(0.97)]) }));

        expect(aspectsOf(decision)).toEqual(['identity', 'quantity']);
    });

    it('is VERIFIED for a remembered resolution — a memo is a machine’s earlier answer, not an assertion', () => {
        // Tier 3 is not among KTD-3's skip conditions. A memo records that some model once agreed; re-checking
        // it is what lets a better model supersede a worse one's memory.
        expect(aspectsOf(decideVerification(input({ evidence: rememberedEvidence() })))).toEqual([
            'identity',
            'quantity',
        ]);
    });

    it.each([
        // margin 0.8 — comfortably clear
        [0.9, 0.1, 'identity skipped'],
        // margin 0.3 — clear
        [0.5, 0.2, 'identity skipped'],
        // margin 0.25 — clear
        [0.5, 0.25, 'identity skipped'],
        // margin 0.19 — under
        [0.5, 0.31, 'identity verified'],
        // margin 0.01 — a coin flip dressed as confidence
        [0.5, 0.49, 'identity verified'],
        // margin 0 — a genuine tie, which is the least trustworthy shortlist of all
        [0.5, 0.5, 'identity verified'],
    ])('top %s against next %s ⇒ %s', (top, next, expected) => {
        const decision = decideVerification(input({ evidence: rankedEvidence([candidate(top), candidate(next)]) }));

        expect(aspectsOf(decision).includes('identity') ? 'identity verified' : 'identity skipped').toBe(expected);
    });

    it('compares the margin as an IEEE-754 double, with the boundary landing where the arithmetic puts it', () => {
        // ⚠️ RECORDED RATHER THAN ENGINEERED AWAY. `1.0 - 0.8` is 0.19999999999999996 and `0.4 - 0.2` is
        // 0.20000000000000004, so two pairs a human reads as "exactly 0.2" fall on OPPOSITE sides of a 0.2
        // threshold. That is acceptable here and nowhere else in this unit: a score is an ordinal on the
        // lexical tier's own scale (R16), the threshold is provisional until the bake-off measures it, and
        // being one ULP either way changes only whether ONE borderline line spends $0.00004 on a check it
        // might not have needed. Contrast the spend counter, which is integer micro-dollars precisely because
        // there the same slop would accumulate against a dollar threshold.
        const decide = (top: number, next: number): readonly string[] =>
            aspectsOf(decideVerification(input({ evidence: rankedEvidence([candidate(top), candidate(next)]) })));

        expect(decide(1.0, 0.8)).toContain('identity');
        expect(decide(0.4, 0.2)).not.toContain('identity');
    });

    it('reads the margin from the two BEST candidates, not from source order', () => {
        // ⛔ THE ORDERING MUST BE ADVERSARIAL, or the test proves nothing. A tier is free to hand back an
        // unsorted list, and the failure that matters is a source order that SKIPS where the sorted order
        // would verify — not the reverse, which merely wastes a call.
        //
        // Here source order reads 0.95 − 0.1 = 0.85 (a wide margin ⇒ skip identity), while the two BEST
        // candidates are 0.95 and 0.9, a margin of 0.05 (⇒ verify). A first version of this test used
        // [0.1, 0.95, 0.9], which passes under BOTH implementations and survived the mutation that trusts
        // source order.
        const unsorted = rankedEvidence([candidate(0.95), candidate(0.1), candidate(0.9)]);
        const decision = decideVerification(input({ evidence: unsorted }));

        expect(decision.observations.margin).toBeCloseTo(0.05, 10);
        expect(aspectsOf(decision)).toContain('identity');
    });
});

describe('nutrient equivalence is the SECOND CONJUNCT of the identity skip (plan U1, D4a)', () => {
    // ⛔ REWRITTEN 2026-08-30 (was: "OBSERVED, never a door"). The OR'd skip set let a wide-margin-WRONG
    // winner bypass the gate — measured: `Cinnamon buns, frosted` won the bare query `cinnamon` by a full
    // tier. Under D4a the ranked identity skip requires margin AND agreement; agreement ALONE still opens
    // nothing (the 334-attractor lesson stands), and an `unknown` agreement fails toward verify.
    it('wide margin with DIVERGENT nutrients verifies identity — the cinnamon case', () => {
        const decision = decideVerification(
            input({ evidence: rankedEvidence([candidate(1), candidate(0, { energyKcalPer100g: 40 })]) }),
        );

        expect(aspectsOf(decision)).toContain('identity');
    });

    it('wide margin with UNKNOWN agreement (a candidate without nutrients) verifies identity', () => {
        const decision = decideVerification(
            input({
                evidence: rankedEvidence([
                    candidate(1, {
                        energyKcalPer100g: undefined,
                        proteinGPer100g: undefined,
                        fatGPer100g: undefined,
                        carbohydrateGPer100g: undefined,
                    }),
                    candidate(0),
                ]),
            }),
        );

        expect(aspectsOf(decision)).toContain('identity');
    });

    it('wide margin WITH agreement still skips identity — the conjunction, positive arm', () => {
        const decision = decideVerification(input({ evidence: rankedEvidence([candidate(1), candidate(0)]) }));

        expect(aspectsOf(decision)).not.toContain('identity');
        expect(aspectsOf(decision)).toContain('quantity');
    });

    it('reports agreement when energy and the macros are within the tolerance', () => {
        const decision = decideVerification(
            input({
                evidence: rankedEvidence([
                    candidate(0.5),
                    candidate(0.45, { energyKcalPer100g: 380, proteinGPer100g: 10.5 }),
                ]),
            }),
        );

        expect(decision.observations.nutrientAgreement).toBe('agree');
    });

    it('reports disagreement when ANY of energy or the three macros diverges', () => {
        const decision = decideVerification(
            input({
                evidence: rankedEvidence([candidate(0.5), candidate(0.45, { fatGPer100g: 40 })]),
            }),
        );

        expect(decision.observations.nutrientAgreement).toBe('disagree');
    });

    it('cannot skip the identity check on its own, however perfectly the candidates agree', () => {
        // ⛔ THE AMENDMENT TO KTD-3. Inter-candidate agreement is not correctness: the 334 lines that
        // collapsed onto three attractors were sets that agreed with each other and were ALL WRONG. KTD-3
        // guards the door with "only when the winning candidate also cleared the margin test", which makes it
        // strictly subsumed by the margin door — so it is measured, reported, and given no authority.
        const identical = [candidate(0.5), candidate(0.49)];
        const decision = decideVerification(input({ evidence: rankedEvidence(identical) }));

        expect(decision.observations.nutrientAgreement).toBe('agree');
        expect(aspectsOf(decision)).toContain('identity');
    });

    it('is unknown when there are fewer than two candidates to compare', () => {
        expect(
            decideVerification(input({ evidence: rankedEvidence([candidate(1)]) })).observations.nutrientAgreement,
        ).toBe('unknown');
        expect(decideVerification(input({ evidence: curatedExactEvidence() })).observations.nutrientAgreement).toBe(
            'unknown',
        );
    });

    it('is unknown when a candidate carries no nutrient vector at all', () => {
        const missing = candidate(0.45, {
            energyKcalPer100g: undefined,
            proteinGPer100g: undefined,
            fatGPer100g: undefined,
            carbohydrateGPer100g: undefined,
        });

        // ⛔ NOT 'agree'. An absent vector must never read as agreement — that is the one coercion that would
        // turn "we know nothing about this candidate" into evidence FOR it.
        expect(
            decideVerification(input({ evidence: rankedEvidence([candidate(0.5), missing]) })).observations
                .nutrientAgreement,
        ).toBe('unknown');
    });
});

describe('the source line', () => {
    it('skips the whole gate when there is no source text to verify against', () => {
        // ⛔ NOT a failure, and NOT a disagreement. A user-authored line has no source: the cook typed the
        // quantity they meant, so there is nothing our parse could have got wrong RELATIVE TO ANYTHING. This
        // is also ADR-0024 layer 0 doing its job — the cheapest control in the stack is the message that is
        // never sent.
        const decision = decideVerification(input({ sourceLine: undefined }));

        expect(decision.kind).toBe('skip');
        expect(decision.kind === 'skip' && decision.reason).toBe('no-source-text');
    });

    it.each([['   '], ['​​'], ['']])('treats %o as no source text rather than as an empty line', (blank) => {
        expect(decideVerification(input({ sourceLine: blank })).kind).toBe('skip');
    });

    it('REJECTS an over-cap line — it is never truncated', () => {
        // ⛔ ADR-0024 §2, and the reason the reservation is not a lie: worst-case cost is
        // `MAX_INPUT_TOKENS x inRate + maxTokens x outRate`, so an unbounded prompt makes the ceiling
        // unenforceable. Truncating would ask the model to judge text the user did not write, and that
        // verdict gates whether nutrition publishes.
        const overCap = 'x'.repeat(PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars + 1);
        const decision = decideVerification(input({ sourceLine: overCap }));

        expect(decision.kind).toBe('reject');
        expect(decision.kind === 'reject' && decision.reason).toBe('source-line-over-cap');
    });

    it('admits a line exactly at the cap', () => {
        const atCap = 'x'.repeat(PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars);

        expect(decideVerification(input({ sourceLine: atCap })).kind).toBe('verify');
    });

    it('measures the cap in code points, not UTF-16 units', () => {
        // An emoji or an astral character is ONE thing a tokenizer sees and TWO `String.length` units. Using
        // `.length` would reject a legitimate line at half the stated cap — and, worse, would make the cap
        // mean different things for different alphabets.
        const astral = '🍰'.repeat(PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars);

        expect(decideVerification(input({ sourceLine: astral })).kind).toBe('verify');
    });

    it('is not rescued by a skip — an over-cap line with no identity evidence is still rejected', () => {
        const overCap = 'x'.repeat(PROVISIONAL_VERIFICATION_THRESHOLDS.maxSourceLineChars + 1);
        const decision = decideVerification(input({ sourceLine: overCap, evidence: curatedExactEvidence() }));

        expect(decision.kind).toBe('reject');
    });
});

describe('the decision as a value', () => {
    it('cannot represent "verify nothing"', () => {
        // The `aspects` tuple is non-empty BY TYPE, so a `verify` with an empty aspect list does not compile.
        // A degenerate verify would be the worst outcome available: a call spent, a verdict recorded, and
        // nothing actually checked.
        const decision = decideVerification(input());

        expect(decision.kind === 'verify' && decision.aspects.length).toBeGreaterThan(0);
    });

    it('always reports the shortlist size, whichever way it went', () => {
        expect(decideVerification(input({ sourceLine: undefined })).observations.shortlistSize).toBe(2);
        expect(decideVerification(input()).observations.shortlistSize).toBe(2);
    });

    it('reports the margin as undefined rather than zero when there is no runner-up', () => {
        // ⛔ `0` is a real margin — two candidates that tied. `undefined` is "there was nobody to compare
        // against". Collapsing them is how a singleton shortlist starts reading as a tie instead of as the
        // warning sign KTD-3 says it is.
        expect(
            decideVerification(input({ evidence: rankedEvidence([candidate(1)]) })).observations.margin,
        ).toBeUndefined();
        expect(
            decideVerification(input({ evidence: rankedEvidence([candidate(1), candidate(1)]) })).observations.margin,
        ).toBe(0);
    });

    it('honours an injected threshold rather than a constant of its own', () => {
        // R17: the bands are MEASURED, not chosen, and the bake-off has not run. Calibration must therefore be
        // a VALUE change, not a code change.
        const strict = { ...PROVISIONAL_VERIFICATION_THRESHOLDS, wideMarginScore: 0.99 };
        const decision = decideVerification(
            input({ evidence: rankedEvidence([candidate(0.95), candidate(0.1)]), thresholds: strict }),
        );

        expect(aspectsOf(decision)).toContain('identity');
    });

    it('publishes its provisional thresholds as UNCALIBRATED', () => {
        expect(PROVISIONAL_VERIFICATION_THRESHOLDS.calibrated).toBe(false);
    });
});
