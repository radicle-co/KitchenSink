/**
 * The verification verdict and the band it yields (plan U11 / R16, R17, R21).
 *
 * ⛔ THE ONE PROPERTY EVERY TEST HERE ORBITS: **nothing publishes by default.** The gate exists because ~900
 * `food_id`s were confidently wrong, and the plan ranks a wrong DISAGREE as the unacceptable error direction —
 * but only because a wrong AGREE "passes data that would have shipped anyway". That asymmetry is about
 * MEASURED verdicts. It says nothing about a verdict we could not read, a certainty outside the enum, or an
 * abstention. Every one of those must land on "do not treat this as verified", and the tests below fire each
 * of them at {@link publishesFrom} individually, because a single `default:` that fell the wrong way would
 * publish nutrition from a line nothing checked.
 */
import { describe, expect, it } from 'vitest';

import {
    CERTAINTY_ORDER,
    VERIFICATION_VERDICTS,
    bandFor,
    isMoreCertainThan,
    publishesFrom,
    verificationOutcomeSchema,
} from '../confidence.js';

describe('the certainty ordinal', () => {
    it('orders from least to most certain, and the order IS the value', () => {
        // R16: "an ordinal ranking score is not a confidence value until the document says how it becomes
        // one". So the model is asked for a NAMED rung, never a number it would have to invent a scale for —
        // and the rungs' order is declared here, once, rather than being implied by a comparison at each call
        // site.
        expect([...CERTAINTY_ORDER]).toEqual(['low', 'medium', 'high']);
    });

    it.each([
        ['high', 'medium', true],
        ['high', 'low', true],
        ['medium', 'low', true],
        ['medium', 'high', false],
        ['low', 'low', false],
    ] as const)('%s more certain than %s ⇒ %s', (left, right, expected) => {
        expect(isMoreCertainThan(left, right)).toBe(expected);
    });
});

describe('bandFor', () => {
    it.each([
        ['agree', 'high', 'verified'],
        ['agree', 'medium', 'verified'],
        ['agree', 'low', 'inconclusive'],
        ['disagree', 'high', 'contradicted'],
        ['disagree', 'medium', 'contradicted'],
        ['disagree', 'low', 'inconclusive'],
        ['abstain', 'high', 'inconclusive'],
        ['abstain', 'medium', 'inconclusive'],
        ['abstain', 'low', 'inconclusive'],
    ] as const)('%s at %s certainty ⇒ %s', (verdict, certainty, band) => {
        expect(bandFor({ verdict, certainty })).toBe(band);
    });

    it('treats a LOW-certainty disagreement as inconclusive, not as a contradiction', () => {
        // ⛔ THE ASYMMETRY, ENCODED. A wrong disagree withholds nutrition from a correct line, which is worse
        // than today; a wrong agree passes data that would have shipped anyway. So the low rung is where the
        // model's own hedging is honoured rather than promoted into a withholding.
        expect(bandFor({ verdict: 'disagree', certainty: 'low' })).toBe('inconclusive');
        expect(bandFor({ verdict: 'disagree', certainty: 'medium' })).toBe('contradicted');
    });

    it('gives the high band the same shape as the middle, so both emit the same telemetry', () => {
        // Plan U11: "the high band emits the same telemetry as the middle". Two bands that differ only in a
        // number are two code paths that drift; one band covering both is one path.
        expect(bandFor({ verdict: 'agree', certainty: 'high' })).toBe(
            bandFor({ verdict: 'agree', certainty: 'medium' }),
        );
    });
});

describe('publishesFrom', () => {
    it('publishes ONLY on a verified band', () => {
        expect(publishesFrom('verified')).toBe(true);
        expect(publishesFrom('contradicted')).toBe(false);
    });

    it('PUBLISHES on inconclusive, and that is a decision rather than an oversight', () => {
        // ⚠️ An abstention or a hedge is not a contradiction. The gate is a last-resort guard on an ASYNC
        // path: a line publishes between save and verification no matter what this returns, so the only
        // coherent read-side rule is "an explicit contradiction withholds; everything else behaves as it did
        // before the gate existed". Making `inconclusive` withhold would manufacture the wrong-DISAGREE
        // outcome this unit ranks as unacceptable, in bulk, for every line the model simply declined to judge.
        expect(publishesFrom('inconclusive')).toBe(true);
    });
});

describe('the verdict a model returns', () => {
    it('parses a well-formed verdict', () => {
        const parsed = verificationOutcomeSchema.safeParse({
            verdict: 'disagree',
            certainty: 'high',
            reason: 'the source says 2 cups, the parse says 2 teaspoons',
        });

        expect(parsed.success && parsed.data.verdict).toBe('disagree');
    });

    it('STRIPS keys the model invented rather than rejecting the whole answer', () => {
        // `z.object`, not `strictObject`: a model that helpfully adds `confidence_score` has still answered
        // the question, and refusing the answer would convert a cosmetic difference into a spent call that
        // proved nothing.
        const parsed = verificationOutcomeSchema.safeParse({
            verdict: 'agree',
            certainty: 'high',
            reason: 'ok',
            confidence_score: 0.97,
            explanation: 'a whole paragraph',
        });

        expect(parsed.success).toBe(true);
        expect(parsed.success && Object.hasOwn(parsed.data, 'confidence_score')).toBe(false);
    });

    it.each([
        ['a wrong enum member', { verdict: 'maybe', certainty: 'high', reason: 'x' }],
        ['a certainty outside the ordinal', { verdict: 'agree', certainty: 'very high', reason: 'x' }],
        ['a numeric certainty', { verdict: 'agree', certainty: 0.9, reason: 'x' }],
        ['a missing verdict', { certainty: 'high', reason: 'x' }],
        ['a missing certainty', { verdict: 'agree', reason: 'x' }],
        ['a null body', null],
        ['an array', [{ verdict: 'agree', certainty: 'high', reason: 'x' }]],
        ['a bare string', 'agree'],
        ['a nested verdict the model wrapped', { result: { verdict: 'agree', certainty: 'high', reason: 'x' } }],
    ])('REFUSES %s', (_label, body) => {
        // ⛔ Not one of these may parse into an `agree`. Publishing nutrition from a line nothing verified is
        // the exact failure this gate exists to prevent, and "the JSON was nearly right" is not verification.
        expect(verificationOutcomeSchema.safeParse(body).success).toBe(false);
    });

    it('bounds the reason, because it is model-authored text we store', () => {
        const parsed = verificationOutcomeSchema.safeParse({
            verdict: 'agree',
            certainty: 'high',
            reason: 'x'.repeat(10_000),
        });

        expect(parsed.success).toBe(false);
    });

    it('accepts an absent reason — it is diagnostic, not the verdict', () => {
        expect(verificationOutcomeSchema.safeParse({ verdict: 'agree', certainty: 'high' }).success).toBe(true);
    });

    it('enumerates exactly three verdicts, with abstention as a MEMBER rather than a low number', () => {
        // Plan U11: "ordinal enum for certainty, abstention as a schema branch rather than a low number". A
        // model that cannot judge a line must be able to say so without pretending to a verdict it does not
        // hold — and "agree, certainty 0.1" is exactly that pretence.
        expect([...VERIFICATION_VERDICTS]).toEqual(['agree', 'disagree', 'abstain']);
    });
});
