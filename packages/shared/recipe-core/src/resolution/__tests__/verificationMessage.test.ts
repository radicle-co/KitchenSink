/**
 * THE VERIFICATION GATE'S QUEUE CONTRACT — written BEFORE the schema (TDD red → green), and MOVED here with
 * it.
 *
 * ⚠️ These cases used to live in `recipe-workers/src/common/__tests__/messages.schema.test.ts`, beside the
 * schema, and moved when the schema did. Nothing was weakened in the move: every case below is the one that
 * shipped, plus two new ones for the `unattributed` evidence kind the shipped producer sends. The schema's
 * new home is `recipe-core` because the PRODUCER is `recipe-service`, which carries `@kitchensink/recipe-workers`
 * as a devDependency only and does not ship it in its image — see the module's own docstring.
 *
 * The property every case defends: an SQS handler has NO pipe in front of it, and this message reaches a paid
 * provider call. Every bound here is a spend control as much as a validation (ADR-0024 §2: "if prompt length
 * is unbounded, the reservation is a lie and the ceiling does not hold").
 */
import { describe, expect, it } from 'vitest';

import { verifyIngredientLineMessageSchema } from '../verificationMessage.js';

describe('verifyIngredientLineMessageSchema (plan U11)', () => {
    /**
     * A valid message.
     *
     * ⛔ IT CARRIES INPUTS, NEVER CONCLUSIONS. There is deliberately no `aspects` field and no `skip` field:
     * the producer runs `decideVerification` to decide whether to enqueue AT ALL (ADR-0024 layer 0 — the
     * cheapest control in the stack is the message that is never sent), and the worker RE-RUNS the same pure
     * policy on the parsed message to decide what it actually asks about. A producer bug, an older producer
     * release, or a replayed message must not be able to make the worker skip an identity check silently.
     */
    const verifyLine = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        recipeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        sourceLine: '2 cups all-purpose flour',
        foodId: '01JFOOD000000000000000000',
        candidateFoodName: 'Flour, wheat, all-purpose',
        quantityLow: 2,
        quantityHigh: null,
        unit: 'cup',
        evidenceKind: 'ranked',
        shortlist: [{ foodId: '01JFOOD000000000000000000', score: 0.9 }],
        requestedAt: '2026-08-21T10:00:00.000Z',
        ...overrides,
    });

    it('accepts a well-formed message', () => {
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine())).not.toThrow();
    });

    it('carries NO aspects and NO skip decision — inputs only', () => {
        const parsed = verifyIngredientLineMessageSchema.parse(
            verifyLine({ aspects: ['quantity'], skip: true, verdict: 'agree' }),
        );

        // `z.object` strips them, so a producer that starts sending conclusions cannot make the worker act on
        // them without this schema changing first.
        expect(Object.hasOwn(parsed, 'aspects')).toBe(false);
        expect(Object.hasOwn(parsed, 'skip')).toBe(false);
        expect(Object.hasOwn(parsed, 'verdict')).toBe(false);
    });

    it('BOUNDS the source line, because the spend reservation is computed from a cap', () => {
        // ⛔ ADR-0024 §2: without a bound on prompt length "the reservation is a lie and the ceiling does not
        // hold". The queue is the last place this value can be refused before it becomes a worst case.
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ sourceLine: 'x'.repeat(5_000) }))).toThrow();
    });

    it('rejects a blank source line rather than spending a call to verify nothing', () => {
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ sourceLine: '   ' }))).toThrow();
    });

    it('bounds the candidate food name — it too reaches the prompt', () => {
        expect(() =>
            verifyIngredientLineMessageSchema.parse(verifyLine({ candidateFoodName: 'x'.repeat(5_000) })),
        ).toThrow();
    });

    it('bounds the shortlist, so one message cannot become an unbounded prompt', () => {
        const huge = Array.from({ length: 200 }, () => ({ foodId: '01JFOOD000000000000000000', score: 0.5 }));

        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ shortlist: huge }))).toThrow();
    });

    it('accepts an EMPTY shortlist — the state the tree is in until U5 ships a scored lexical tier', () => {
        expect(() =>
            verifyIngredientLineMessageSchema.parse(verifyLine({ shortlist: [], evidenceKind: 'ranked' })),
        ).not.toThrow();
    });

    it('distinguishes an absent quantity from zero, and an absent unit from empty', () => {
        const parsed = verifyIngredientLineMessageSchema.parse(
            verifyLine({ quantityLow: null, quantityHigh: null, unit: null }),
        );

        // `null` is "the parser found none"; `0` and `''` are values it found. The verdict key depends on
        // telling them apart, and so does the question the model is asked.
        expect(parsed.quantityLow).toBeNull();
        expect(parsed.unit).toBeNull();
    });

    it.each([['curated-exact'], ['ranked'], ['remembered'], ['unattributed']])(
        'accepts evidence kind %s',
        (evidenceKind) => {
            expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ evidenceKind }))).not.toThrow();
        },
    );

    it('accepts an unattributed message with an empty shortlist — what the recipe write path sends', () => {
        // ⛔ THE SHIPPED PRODUCER'S EXACT MESSAGE. `RecipesService` enqueues from persisted
        // `recipe_ingredients` rows, and nothing persists which cascade tier resolved the catalog row those
        // rows point at — so it can neither name a tier nor offer a shortlist. If this case ever fails, the
        // producer's every message is poison and the whole gate silently drains to the DLQ.
        expect(() =>
            verifyIngredientLineMessageSchema.parse(verifyLine({ evidenceKind: 'unattributed', shortlist: [] })),
        ).not.toThrow();
    });

    it('rejects an evidence kind the policy cannot interpret', () => {
        // The kind selects which skip doors are open. An unrecognised one would have to fall back to a
        // default, and either default is wrong: "verify everything" spends on lines that need not be checked,
        // "skip identity" publishes an unchecked resolution.
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ evidenceKind: 'lexical' }))).toThrow();
    });

    it('rejects a recipeId that is not a UUID', () => {
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ recipeId: 'not-a-uuid' }))).toThrow();
    });

    it('rejects a requestedAt that is not a real instant', () => {
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ requestedAt: 'yesterday' }))).toThrow();
    });

    it('rejects a non-finite score, which would poison the margin comparison', () => {
        const nan = [{ foodId: '01JFOOD000000000000000000', score: Number.NaN }];

        // `NaN >= threshold` is false and `NaN` propagates through the subtraction, so an unvalidated score
        // silently turns the margin door into "always verify" — or, with a sign flip elsewhere, into always
        // skip.
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ shortlist: nan }))).toThrow();
    });
});
