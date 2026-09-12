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

import { MAX_VERIFICATION_SOURCE_LINE_LENGTH, verifyIngredientLineMessageSchema } from '../verificationMessage.js';

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

    /**
     * ⛔ `ownerId` WAS REMOVED FROM THIS CONTRACT — owner ruling 2026-08-25, ADR-0027.
     *
     * Five cases stood here. Every one of them was about a field whose ONLY documented purpose was to carry
     * the recipe owner from the producer to the worker so that a phrase the worker REMEMBERS in
     * `ingredient_resolution_memos` could later be erased (migration 0026). The owner ruled that an
     * ingredient phrase is not private data; migration 0033 dropped the memo's person column and the erasure
     * sweep, which left `verifyLine.ts` — the field's only reader — with nothing to do with it.
     *
     * ⛔ Their coverage does not vanish, it INVERTS. The two cases below assert what removing the field
     * actually has to be safe against, which no assertion covered before:
     *
     *   1. A message from the PREVIOUS producer still carrying `ownerId` must parse, with the key stripped.
     *      That is what makes the removal safe in the older-producer direction, and it depends on this being
     *      a `z.object` rather than a strict one. If it ever became strict, every in-flight message would
     *      become DLQ poison at the moment the new worker deploys — the same whole-recipe silent drop the
     *      `z.ulid()` defect caused, arriving by a different route.
     *   2. Nothing that names a person survives on the parsed message. This message sits in a DLQ carrying a
     *      cook's recipe text, and the schema's docstring asks that every field be weighed against that; a
     *      re-added identifier must fail here rather than pass unnoticed.
     *
     * The BOUND and EMPTY-STRING cases are not re-homed because there is no longer a field to bound. The
     * remaining string fields carry their own bounds, asserted elsewhere in this suite.
     */
    it('⛔ strips a REMOVED ownerId from an older producer’s message rather than refusing it', () => {
        const parsed = verifyIngredientLineMessageSchema.parse(verifyLine({ ownerId: '01JQ8N2X4RBV6WK3ZT5Y7A9C0P' }));

        expect(parsed.sourceLine).toBe('2 cups all-purpose flour');
        expect(Object.keys(parsed)).not.toContain('ownerId');
    });

    it('⛔ carries NOTHING that names a person — the DLQ holds one less identifier for it', () => {
        const parsed = verifyIngredientLineMessageSchema.parse(verifyLine());
        const keys = Object.keys(parsed);

        // ⚠️ Asserted against a POPULATED parse, never an empty one: `expect(keys).not.toContain(...)` over an
        // empty array passes vacuously and would report a broken schema as green.
        expect(keys).toContain('recipeId');
        expect(keys).not.toContain('ownerId');
        expect(keys).not.toContain('userId');
        expect(keys).not.toContain('authorId');
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

    it('⛔ counts the source line in CODE POINTS, so it agrees with the policy that admitted it', () => {
        // ⛔ THE DEFECT THIS PINS, measured in this tree: 120 pizza emoji + 250 ASCII is 370 CODE POINTS —
        // which `decideVerification` admits, because its cap counts code points — and 490 UTF-16 units,
        // which `z.string().max(400)` refuses. Producer says verify, consumer says poison: the message is
        // redelivered 20 times under `maxReceiveCount` and lands in a three-day DLQ carrying a cook's recipe
        // text, while the API reports success and the line is never checked.
        //
        // Every other bound in this file is tested with `'x'.repeat(n)`, which cannot see this class at all.
        const astral = '\u{1F355}'.repeat(120) + 'x'.repeat(250);

        expect([...astral].length).toBeLessThanOrEqual(MAX_VERIFICATION_SOURCE_LINE_LENGTH);
        expect(astral.length).toBeGreaterThan(MAX_VERIFICATION_SOURCE_LINE_LENGTH);
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ sourceLine: astral }))).not.toThrow();
    });

    it('still refuses a line that is over cap in CODE POINTS', () => {
        const over = '\u{1F355}'.repeat(MAX_VERIFICATION_SOURCE_LINE_LENGTH + 1);

        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ sourceLine: over }))).toThrow();
    });

    it('rejects a blank source line rather than spending a call to verify nothing', () => {
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ sourceLine: '   ' }))).toThrow();
    });

    /**
     * `ingredientPhrase` — the memo-grain repair (owner ruling 2026-08-31, U15 report).
     *
     * The memo tier's read side queries `normalizedIngredientKey(name)` — the PHRASE a picker types — while
     * the write side keyed on the whole source line, so a memo written from `one quart of cold water` could
     * never serve a query for `cold water`. The phrase the parse lifted out of the line now rides the
     * message so the worker can key the memo at the grain the cascade actually asks.
     */
    it('carries the parsed ingredient phrase, the grain the memo tier is keyed on', () => {
        const parsed = verifyIngredientLineMessageSchema.parse(
            verifyLine({ sourceLine: '2 cups all-purpose flour', ingredientPhrase: 'all-purpose flour' }),
        );

        expect(parsed.ingredientPhrase).toBe('all-purpose flour');
    });

    it('parses a message from a producer that predates ingredientPhrase — the field is optional', () => {
        const parsed = verifyIngredientLineMessageSchema.parse(verifyLine());

        expect(parsed.ingredientPhrase).toBeUndefined();
    });

    it('rejects a blank ingredient phrase — absence has exactly one spelling', () => {
        expect(() => verifyIngredientLineMessageSchema.parse(verifyLine({ ingredientPhrase: '   ' }))).toThrow();
    });

    it('bounds the ingredient phrase like the line it was lifted from', () => {
        expect(() =>
            verifyIngredientLineMessageSchema.parse(verifyLine({ ingredientPhrase: 'x'.repeat(5_000) })),
        ).toThrow();
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

    /**
     * U7/U11 — the pair the SOURCE printed, carried so the model is asked about the numbers the source
     * actually contained.
     *
     * ⛔ A NESTED OBJECT, not three coordinated flat fields, and the refusals below are what that buys: a
     * half-existing stated measure is unrepresentable rather than merely invalid. Contrast the flat
     * `quantityLow`/`quantityHigh`/`unit` above, which are REQUIRED and so have no half-existence to prevent.
     */
    describe('statedMeasure', () => {
        const GILL = { quantityLow: 1, quantityHigh: null, unit: 'gill' };

        it('accepts a message carrying what the source printed', () => {
            const parsed = verifyIngredientLineMessageSchema.parse(verifyLine({ statedMeasure: GILL }));

            expect(parsed.statedMeasure).toEqual(GILL);
        });

        it('accepts a stated range', () => {
            const parsed = verifyIngredientLineMessageSchema.parse(
                verifyLine({ statedMeasure: { ...GILL, quantityHigh: 2 } }),
            );

            expect(parsed.statedMeasure?.quantityHigh).toBe(2);
        });

        // ⚠️ OPTIONAL, and it must stay optional through at least one release — the same reason `ownerId`
        // carries. The queue holds messages enqueued by the producer that predates this field, and making it
        // required turns every one of them into DLQ poison the moment the new worker deploys. A line arriving
        // without it is judged against the pair we persisted, which is exactly today's behaviour.
        it('is OPTIONAL, so an in-flight message from the previous producer still parses', () => {
            const parsed = verifyIngredientLineMessageSchema.parse(verifyLine());

            expect(parsed.statedMeasure).toBeUndefined();
        });

        // ⛔ `quantityLow` is NOT nullable here, unlike its flat sibling. `convertHistoricalUnit` refuses an
        // absent quantity outright, so "restated from no amount" is a state no producer can reach.
        it('REFUSES a stated measure with no amount', () => {
            expect(() =>
                verifyIngredientLineMessageSchema.parse(verifyLine({ statedMeasure: { ...GILL, quantityLow: null } })),
            ).toThrow();
        });

        // ⛔ Nor is `unit` nullable: a restatement is never FROM nothing.
        it('REFUSES a stated measure with no unit', () => {
            expect(() =>
                verifyIngredientLineMessageSchema.parse(verifyLine({ statedMeasure: { ...GILL, unit: null } })),
            ).toThrow();
            expect(() =>
                verifyIngredientLineMessageSchema.parse(verifyLine({ statedMeasure: { ...GILL, unit: '' } })),
            ).toThrow();
        });

        // The stated unit reaches the PROMPT, so it carries the same 64-code-point bound its flat sibling
        // does — ADR-0024 §2 makes a hard input cap a precondition of the spend reservation, and a second
        // unbounded unit would reopen it.
        it('REFUSES a stated unit over the transport bound', () => {
            expect(() =>
                verifyIngredientLineMessageSchema.parse(
                    verifyLine({ statedMeasure: { ...GILL, unit: 'g'.repeat(65) } }),
                ),
            ).toThrow();
        });

        it('REFUSES a non-finite stated bound', () => {
            expect(() =>
                verifyIngredientLineMessageSchema.parse(
                    verifyLine({ statedMeasure: { ...GILL, quantityLow: Number.NaN } }),
                ),
            ).toThrow();
        });
    });
});
