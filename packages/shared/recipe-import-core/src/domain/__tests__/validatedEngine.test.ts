/**
 * The validator loop as an ENGINE-PORT DECORATOR (plan U7, KTD-D / origin D5, D6) — invisible to the CRF
 * and to the pipeline, bounded at 3 retries, and honest about absence.
 */
import { describe, expect, it, vi } from 'vitest';

import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';

import type { EngineAnswer } from '../parseComparator.js';
import type { ParsedLine } from '../../parsedLine.js';
import { MAX_PARSE_ATTEMPTS, createValidatedLlmEngine } from '../validatedEngine.js';

const line = (foods: readonly string[], overrides: Partial<ParsedLine> = {}): ParsedLine => ({
    raw: '1 cup whatever',
    statedMeasure: '1 cup',
    quantity: { kind: 'exact', value: 1 },
    unit: 'cup',
    foods: foods.map((name) => ({ name, prep: null })),
    reviewReasons: [],
    provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
    ...overrides,
});

const judged = (isFood: boolean, taxonomy: string) => ({ kind: 'judged' as const, isFood, taxonomy });
const CANT = { kind: 'could-not-judge' as const, reason: 'no-json' as const };

function build(overrides: {
    firstAnswers?: readonly EngineAnswer[];
    retryAnswers?: readonly EngineAnswer[];
    foodness?: ReturnType<typeof vi.fn>;
    measurement?: ReturnType<typeof vi.fn>;
}) {
    const inner = {
        engine: 'llm' as const,
        engineVersion: 'model:test/v1',
        parse: vi.fn().mockResolvedValue(overrides.firstAnswers ?? [line(['flour'])]),
    };
    const retryQueue = [...(overrides.retryAnswers ?? [])];
    const retry = { parse: vi.fn().mockImplementation(() => Promise.resolve(retryQueue.shift() ?? line(['flour']))) };
    const foodness = overrides.foodness ?? vi.fn().mockResolvedValue(judged(true, 'staple'));
    const measurement = overrides.measurement ?? vi.fn().mockResolvedValue('pass');
    const engine = createValidatedLlmEngine({
        inner,
        retry,
        foodness: { judge: foodness as never },
        measurement: { judge: measurement as never },
    });

    return { engine, inner, retry, foodness, measurement };
}

describe('the pass-through path', () => {
    it('a validated first attempt rides through with llmAttempts = 1', async () => {
        const { engine, retry } = build({});

        const [answer] = await engine.parse(['1 cup flour']);

        expect(answer).toMatchObject({ foods: [{ name: 'flour' }], llmAttempts: 1 });
        expect(retry.parse).not.toHaveBeenCalled();
    });

    it("keeps the inner port identity — engine and version are the wrapped engine's", () => {
        const { engine, inner } = build({});

        expect(engine.engine).toBe('llm');
        expect(engine.engineVersion).toBe(inner.engineVersion);
    });

    it('an UNAVAILABLE first answer passes through untouched — absence is not validated', async () => {
        const { engine, foodness } = build({ firstAnswers: [{ unavailable: true }] });

        const [answer] = await engine.parse(['1 cup flour']);

        expect(answer).toEqual({ unavailable: true });
        expect(foodness).not.toHaveBeenCalled();
    });
});

describe('the retry loop (origin D5: max 3 retries, failure context feeds the parser)', () => {
    it('a not-a-food verdict retries WITH the category context and succeeds on attempt 2', async () => {
        const foodness = vi
            .fn()
            .mockResolvedValueOnce(judged(false, 'equipment'))
            .mockResolvedValue(judged(true, 'staple'));
        const { engine, retry } = build({
            firstAnswers: [line(['mixing bowl whip'])],
            retryAnswers: [line(['eggs'])],
            foodness,
        });

        const [answer] = await engine.parse(['In a large mixing bowl whip two eggs']);

        expect(answer).toMatchObject({ foods: [{ name: 'eggs' }], llmAttempts: 2 });
        expect(retry.parse).toHaveBeenCalledWith('In a large mixing bowl whip two eggs', [
            { kind: 'not-a-food', name: 'mixing bowl whip', taxonomy: 'equipment' },
        ]);
    });

    it('a measurement failure retries with the measurement context', async () => {
        const measurement = vi.fn().mockResolvedValueOnce('fail').mockResolvedValue('pass');
        const { engine, retry } = build({ measurement, retryAnswers: [line(['flour'])] });

        const [answer] = await engine.parse(['1 cup flour']);

        expect(answer).toMatchObject({ llmAttempts: 2 });
        expect(retry.parse).toHaveBeenCalledWith('1 cup flour', [{ kind: 'measurement', statedByModel: '1 cup' }]);
    });

    /**
     * ⚠️ REWRITTEN 2026-09-19, and the rewrite is the point rather than a tidy-up. Every attempt here used
     * to answer `a bowl`, which R4 (the same answer twice ends the loop) now stops at attempt 2 — so the
     * test would have proved R4's early exit while claiming to prove exhaustion at the BUDGET. The names
     * now vary, which is what a model actually does when it is being talked round, so the loop reaches
     * `MAX_PARSE_ATTEMPTS` and R3's "bad names still get three retries" is what is under test. R4's own
     * behaviour on a repeated bad name is asserted separately, below.
     */
    it('⛔ exhaustion is the recorded terminal state: foods EMPTY, not_a_food reason, nothing bound (R6)', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine, retry } = build({
            // ⛔ THE LAST ANSWER DIVERGES UNDER PLACEMENT (`hot bowl` → `bowl`), and it must be the LAST
            // one: `exhaust` only ever sees the FINAL attempt's failures, so a diverging name on attempt 1
            // reaches the retry prompt and is then discarded. `exhaust` keys `disputedNames` off
            // `failure.name` and filters `attempt.foods` by `food.name`, so a failure reported under the
            // PLACED name would stop matching and publish a name a validator rejected — which a
            // self-canonicalising final answer (`a bowl of it`) cannot detect.
            firstAnswers: [line(['hot plate'])],
            retryAnswers: [line(['a large bowl']), line(['a mixing bowl']), line(['hot bowl'])],
            foodness,
        });

        const [answer] = await engine.parse(['a hot plate']);

        expect(retry.parse).toHaveBeenCalledTimes(MAX_PARSE_ATTEMPTS - 1);
        expect(answer).toMatchObject({
            raw: 'a hot plate',
            foods: [],
            quantity: ABSENT_QUANTITY,
            reviewReasons: ['not_a_food'],
            llmAttempts: MAX_PARSE_ATTEMPTS,
        });
    });

    it('⛔ MEASUREMENT-ONLY exhaustion keeps the undisputed foods and measure — a disputed number is a review flag, never a deletion', async () => {
        // Measured 2026-08-31 (U7 corpus diff): 'one-fourth teaspoon of salt' and 'two teaspoons of sugar'
        // were landed foods:[] + not_a_food after the measure judge disputed every round — deleting foods
        // NO validator ever disputed. U11's own ranking (a wrong DISAGREE is the unacceptable direction)
        // decides the terminal state: keep what the model read, flag it for a human.
        const measurement = vi.fn().mockResolvedValue('fail');
        const { engine, retry } = build({
            measurement,
            // ⚠️ The measure varies between attempts (rewritten 2026-09-19): the judge disputing it is what
            // drives the retry, so a model re-reading it differently each time is the shape that reaches the
            // budget at all. Four identical answers would now stop at attempt 2 under R4.
            retryAnswers: [
                line(['salt'], { statedMeasure: '2 cups' }),
                line(['salt'], { statedMeasure: '3 cups' }),
                line(['salt'], { statedMeasure: '4 cups' }),
            ],
            firstAnswers: [line(['salt'])],
        });

        const [answer] = await engine.parse(['one-fourth teaspoon of salt']);

        expect(answer).toMatchObject({
            foods: [{ name: 'salt' }],
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
            llmAttempts: MAX_PARSE_ATTEMPTS,
        });
        expect(retry.parse).toHaveBeenCalledTimes(MAX_PARSE_ATTEMPTS - 1);
        expect((answer as ParsedLine).reviewReasons).toContain('measurement_unverified');
        expect((answer as ParsedLine).reviewReasons).not.toContain('not_a_food');
    });

    it('MIXED exhaustion keeps the PASSED foods, drops only the disputed ones, and flags both reasons', async () => {
        const foodness = vi
            .fn()
            .mockImplementation((name: string) =>
                Promise.resolve(name === 'cloth' ? judged(false, 'equipment') : judged(true, 'staple')),
            );
        const measurement = vi.fn().mockResolvedValue('fail');
        const { engine } = build({
            foodness,
            measurement,
            firstAnswers: [line(['onion', 'cloth'])],
            // ⚠️ Varied for the same reason as the measurement-only case above (2026-09-19): four identical
            // answers now stop at attempt 2 under R4, and this test is about the BUDGET being spent.
            retryAnswers: [
                line(['onion', 'cloth'], { statedMeasure: '2 cups' }),
                line(['onion', 'cloth'], { statedMeasure: '3 cups' }),
                line(['onion', 'cloth'], { statedMeasure: '4 cups' }),
            ],
        });

        const [answer] = await engine.parse(['an onion in a cloth']);

        expect(answer).toMatchObject({ foods: [{ name: 'onion' }], llmAttempts: MAX_PARSE_ATTEMPTS });
        expect((answer as ParsedLine).reviewReasons).toEqual(
            expect.arrayContaining(['not_a_food', 'measurement_unverified']),
        );
    });

    it('⛔ could-not-judge does NOT retry and does not count an attempt — absence, never a verdict (R25)', async () => {
        const foodness = vi.fn().mockResolvedValue(CANT);
        const { engine, retry } = build({ firstAnswers: [line(['blorvik'])], foodness });

        const [answer] = await engine.parse(['1 cup blorvik']);

        expect(retry.parse).not.toHaveBeenCalled();
        expect(answer).toMatchObject({ foods: [{ name: 'blorvik' }], llmAttempts: 1 });
    });

    it('an UNAVAILABLE retry yields absence — a known-bad parse must never publish, a transient must retry upstream', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine } = build({
            firstAnswers: [line(['a bowl'])],
            retryAnswers: [{ unavailable: true }],
            foodness,
        });

        const [answer] = await engine.parse(['a bowl']);

        expect(answer).toEqual({ unavailable: true });
    });
});

describe('batch discipline', () => {
    it('answers one per line in order, validating each independently', async () => {
        const foodness = vi
            .fn()
            .mockImplementation((name: string) =>
                Promise.resolve(name === 'a bowl' ? judged(false, 'equipment') : judged(true, 'staple')),
            );
        const { engine } = build({
            firstAnswers: [line(['flour']), line(['a bowl'])],
            retryAnswers: [line(['eggs'])],
            foodness,
        });

        const answers = await engine.parse(['1 cup flour', 'a bowl of eggs']);

        expect(answers).toHaveLength(2);
        expect(answers[0]).toMatchObject({ foods: [{ name: 'flour' }], llmAttempts: 1 });
        expect(answers[1]).toMatchObject({ foods: [{ name: 'eggs' }], llmAttempts: 2 });
    });
});

/**
 * ⛔ A PARSE WITH NO FOOD AT ALL — the gap the loop was structurally blind to.
 *
 * Measured over 1,265 lines: the parse model returned a measurement and an EMPTY food list on 28 of them
 * ('three quarts of cold water' → measure "three", no foods). `validate`'s only per-food failure comes from
 * `for (const food of attempt.foods)`, which does not run on an empty list — so no failure could exist, the
 * loop returned PASS on the first attempt, and the line landed as a clean parse with an empty name.
 */
describe('the no-food verdict', () => {
    it('⛔ raises no-food and retries with the measure the model DID state', async () => {
        const { engine, retry, foodness } = build({
            firstAnswers: [line([], { raw: 'three quarts of cold water', statedMeasure: 'three' })],
            retryAnswers: [line(['cold water'])],
        });

        const [answer] = await engine.parse(['three quarts of cold water']);

        // ⛔ The blindness, asserted precisely: the judge is consulted ONCE, for the food the RETRY
        // produced. The first attempt judged nothing at all — `for (const food of attempt.foods)` does not
        // run on an empty list — which is why no `not-a-food` failure could ever exist for this line.
        //
        // ⚠️ `water`, not `cold water`, and that is the SUBJECT rule rather than a detail of this fixture:
        // the judged name is the placed one — see "the judged subject is the placed name". The count is
        // what this case is about; the spelling belongs to that one.
        expect(foodness.mock.calls).toEqual([['water']]);
        expect(retry.parse).toHaveBeenCalledWith('three quarts of cold water', [
            { kind: 'no-food', statedMeasure: 'three' },
        ]);
        expect(answer).toMatchObject({ foods: [{ name: 'cold water' }], llmAttempts: 2 });
    });

    it('⛔ a PASSING measurement judge is not a pass — the measure being right is the defect, not the cure', async () => {
        const measurement = vi.fn().mockResolvedValue('pass');
        const { engine, retry } = build({
            firstAnswers: [line([])],
            retryAnswers: [line(['flour'])],
            measurement,
        });

        const [answer] = await engine.parse(['1 cup whatever']);

        expect(retry.parse).toHaveBeenCalledTimes(1);
        expect(answer).toMatchObject({ foods: [{ name: 'flour' }], llmAttempts: 2 });
    });

    it('carries a NULL measure when the parse stated none — absence is not dressed up as a value', async () => {
        const { engine, retry } = build({
            firstAnswers: [line([], { statedMeasure: null })],
            retryAnswers: [line(['flour'])],
        });

        await engine.parse(['For the sauce:']);

        expect(retry.parse).toHaveBeenCalledWith('For the sauce:', [{ kind: 'no-food', statedMeasure: null }]);
    });

    /**
     * ⚠️ REWRITTEN TWICE, and the second rewrite CHANGES WHAT IS PROVED — so it is stated rather than
     * folded into the first.
     *
     * 2026-09-19 (R2): it asserted three retries and `llmAttempts: MAX_PARSE_ATTEMPTS`; the owner has ruled
     * that a foodless parse is retried ONCE, so the budget is no longer spent here and the old expectation
     * was not weakened but WRONG.
     *
     * 2026-09-19 (the token split): it asserted `not_a_food`, which was this route's reason until
     * `no_food_returned` was given to it. That is a DIFFERENT terminal fact — the model returned nothing,
     * where `not_a_food` says a validator DISPUTED a name — and the merge one layer up acts on the
     * difference: `mergedReasons` drops the silence and keeps the verdict. Asserting the old token here
     * would certify the collapse that let a CRF-rescued line land clean; the `.not.toContain` is therefore
     * part of the proof, not decoration.
     */
    it('⛔ the R2 stop binds nothing, records no_food_returned, and KEEPS the measure no validator disputed', async () => {
        // The 2026-08-31 amendment's own principle, one field over: the terminal state may not delete what
        // no validator questioned. The foods are empty because the model returned none — but the measure it
        // read passed its judge, and a reviewer shown 'three' can correct the line where a reviewer shown
        // 'No amount given' cannot.
        const { engine, retry } = build({
            firstAnswers: [line([])],
            retryAnswers: [line([]), line([]), line([])],
        });

        const [answer] = await engine.parse(['spoonfuls']);

        expect(retry.parse).toHaveBeenCalledTimes(1);
        expect(answer).toMatchObject({
            foods: [],
            statedMeasure: '1 cup',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
            llmAttempts: 2,
        });
        expect((answer as ParsedLine).reviewReasons).toContain('no_food_returned');
        // ⛔ NEVER the disputed-name token. Nothing was disputed — no name was ever offered to a judge.
        expect((answer as ParsedLine).reviewReasons).not.toContain('not_a_food');
    });

    /**
     * ⛔ THE TWO TERMINAL RECORDS ARE DISJOINT, asserted from the OTHER side so neither token can absorb
     * the other.
     *
     * `not_a_food` means "a validator disputed a name"; `no_food_returned` means "the model returned
     * nothing". `validate` can only raise `no-food` on an EMPTY list and `not-a-food` per member of that
     * same list, so no attempt can draw both — and a mutation that emitted `no_food_returned` on the
     * disputed-name route would make the merge drop a verdict it must keep.
     */
    it('⛔ a DISPUTED name is never recorded as silence — the two terminal records do not overlap', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine } = build({
            firstAnswers: [line(['a bowl'])],
            retryAnswers: [line(['a large bowl']), line(['a mixing bowl']), line(['a bowl of it'])],
            foodness,
        });

        const [answer] = await engine.parse(['a bowl']);

        expect((answer as ParsedLine).reviewReasons).toEqual(['not_a_food']);
    });
});

/**
 * ⛔ R2 — EMPTY TWICE, STOP (owner ruling 2026-09-19).
 *
 * A foodless parse is retried ONCE. A retry that is also foodless ends the loop, and the remaining attempts
 * are not spent: measured over 1,265 lines, 3.95% came back foodless, and the previous pass took each of
 * them from 2 billed calls to 8 (four parse calls, each with its own measurement judge) for an answer that
 * a second empty list has already shown will not arrive.
 *
 * ⛔ IT IS NOT R4 IN DISGUISE, which is why every attempt here states a DIFFERENT measure. Two foodless
 * answers stating the same measure satisfy R4 as well, so a test built on them would pass with R2 deleted.
 *
 * ⛔ IT IS NOT R3 EITHER. A parse that DID return food text keeps the full budget — asserted by the
 * exhaustion tests above, and by the interleaved case here, which proves the stop needs two CONSECUTIVE
 * foodless attempts rather than two anywhere in the run.
 *
 * | mutation | tests it fails |
 * | -------- | -------------- |
 * | delete the rule (spend the whole budget) | "⛔ stops after the second foodless attempt…", "⛔ the R2 stop binds nothing…" |
 * | stop on the FIRST foodless attempt | "⛔ a foodless FIRST attempt still gets its one retry" |
 * | count foodless attempts anywhere rather than consecutively | "⚠️ a foodless attempt with a NAMED one between keeps the full budget (R3)" |
 * | report `MAX_PARSE_ATTEMPTS` as the attempt count anyway | "⛔ stops after the second foodless attempt…", "⛔ the R2 stop binds nothing…" |
 */
describe('R2 — a foodless parse is retried once, and only once', () => {
    it('⛔ stops after the second foodless attempt, leaving the rest of the budget unspent', async () => {
        const { engine, retry } = build({
            // ⚠️ DIFFERENT measures on the two attempts, so R4 cannot be what stops this loop.
            firstAnswers: [line([], { raw: 'three quarts of cold water', statedMeasure: 'three' })],
            retryAnswers: [
                line([], { raw: 'three quarts of cold water', statedMeasure: 'two' }),
                line([], { raw: 'three quarts of cold water', statedMeasure: 'one' }),
                line([], { raw: 'three quarts of cold water', statedMeasure: 'none' }),
            ],
        });

        const [answer] = await engine.parse(['three quarts of cold water']);

        expect(retry.parse).toHaveBeenCalledTimes(1);
        expect(answer).toMatchObject({ foods: [], statedMeasure: 'two', llmAttempts: 2 });
    });

    it('⛔ a foodless FIRST attempt still gets its one retry', async () => {
        const { engine, retry } = build({
            firstAnswers: [line([], { statedMeasure: 'three' })],
            retryAnswers: [line(['cold water'])],
        });

        const [answer] = await engine.parse(['three quarts of cold water']);

        expect(retry.parse).toHaveBeenCalledTimes(1);
        expect(answer).toMatchObject({ foods: [{ name: 'cold water' }], llmAttempts: 2 });
    });

    it('⚠️ a foodless attempt with a NAMED one between keeps the full budget (R3)', async () => {
        const foodness = vi
            .fn()
            .mockImplementation((name: string) =>
                Promise.resolve(name === 'a bowl' ? judged(false, 'equipment') : judged(true, 'staple')),
            );
        const { engine, retry } = build({
            firstAnswers: [line([], { statedMeasure: 'three' })],
            retryAnswers: [
                line(['a bowl'], { statedMeasure: 'two' }),
                line([], { statedMeasure: 'one' }),
                line(['flour'], { statedMeasure: 'none' }),
            ],
            foodness,
        });

        const [answer] = await engine.parse(['three quarts of cold water']);

        expect(retry.parse).toHaveBeenCalledTimes(MAX_PARSE_ATTEMPTS - 1);
        expect(answer).toMatchObject({ foods: [{ name: 'flour' }], llmAttempts: MAX_PARSE_ATTEMPTS });
    });
});

/**
 * ⛔ R4 — THE SAME ANSWER TWICE ENDS THE LOOP (owner ruling 2026-09-19).
 *
 * "A model repeating itself will not be talked round, and each retry is a billed call." The loop stops and
 * ACCEPTS the answer — which means it stops LOOPING, not that it suppresses anything: the terminal record
 * is exactly what the budget's own exhaustion would have written, `not_a_food` and all. Suppressing the
 * flags would store a name the checker rejected, silently.
 *
 * ⛔ WHAT "THE SAME ANSWER" IS: the food NAMES, in order, and the STATED MEASURE — folded for case and
 * whitespace. That is not an arbitrary subset: it is exactly the set of facts a validator can object to
 * (`not-a-food` names a name, `measurement` and `no-food` name the measure), so an answer that moved
 * anything else provably draws the same objections and the next retry is as futile as the last.
 *
 * | mutation | tests it fails |
 * | -------- | -------------- |
 * | delete the rule | "⛔ stops when a retry repeats the previous names and measure", "⛔ a repeated answer still records…" |
 * | suppress the review flags on the early stop | "⛔ a repeated answer still records every flag exhaustion would have" |
 * | compare the measure only | "⛔ a retry that changes a NAME is a new answer, and keeps its budget" |
 * | compare the names only | "⛔ a retry that changes the MEASURE is a new answer too" |
 * | compare raw strings, without the fold | "⚠️ folds case and whitespace — a cosmetic re-spelling is the same answer" |
 * | compare food names as a SET rather than in order | "⚠️ a re-ORDERED name list is a different answer" |
 * | report `MAX_PARSE_ATTEMPTS` as the attempt count anyway | "⛔ stops when a retry repeats the previous names and measure" |
 */
describe('R4 — a repeated answer ends the loop and is accepted as it stands', () => {
    it('⛔ stops when a retry repeats the previous names and measure', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine, retry } = build({
            firstAnswers: [line(['a bowl'])],
            retryAnswers: [line(['a bowl']), line(['a bowl']), line(['a bowl'])],
            foodness,
        });

        const [answer] = await engine.parse(['a bowl']);

        expect(retry.parse).toHaveBeenCalledTimes(1);
        expect(answer).toMatchObject({ llmAttempts: 2 });
    });

    it('⛔ a repeated answer still records every flag exhaustion would have', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine } = build({
            firstAnswers: [line(['a bowl'])],
            retryAnswers: [line(['a bowl'])],
            foodness,
        });

        const [answer] = await engine.parse(['a bowl']);

        expect(answer).toMatchObject({ raw: 'a bowl', foods: [], quantity: ABSENT_QUANTITY });
        expect((answer as ParsedLine).reviewReasons).toEqual(['not_a_food']);
    });

    it('⛔ a retry that changes a NAME is a new answer, and keeps its budget', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine, retry } = build({
            firstAnswers: [line(['a bowl'])],
            retryAnswers: [line(['a pan']), line(['a dish']), line(['a tin'])],
            foodness,
        });

        await engine.parse(['a bowl']);

        expect(retry.parse).toHaveBeenCalledTimes(MAX_PARSE_ATTEMPTS - 1);
    });

    it('⛔ a retry that changes the MEASURE is a new answer too', async () => {
        const measurement = vi.fn().mockResolvedValue('fail');
        const { engine, retry } = build({
            measurement,
            firstAnswers: [line(['salt'], { statedMeasure: '1 cup' })],
            retryAnswers: [
                line(['salt'], { statedMeasure: '2 cups' }),
                line(['salt'], { statedMeasure: '3 cups' }),
                line(['salt'], { statedMeasure: '4 cups' }),
            ],
        });

        await engine.parse(['salt']);

        expect(retry.parse).toHaveBeenCalledTimes(MAX_PARSE_ATTEMPTS - 1);
    });

    it('⚠️ folds case and whitespace — a cosmetic re-spelling is the same answer', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine, retry } = build({
            firstAnswers: [line(['a bowl'], { statedMeasure: '1 cup' })],
            retryAnswers: [line([' A  Bowl '], { statedMeasure: '1  CUP' }), line(['a bowl']), line(['a bowl'])],
            foodness,
        });

        await engine.parse(['a bowl']);

        expect(retry.parse).toHaveBeenCalledTimes(1);
    });

    it('⚠️ a re-ORDERED name list is a different answer — order is meaning in a food list', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine, retry } = build({
            firstAnswers: [line(['a bowl', 'a cloth'])],
            retryAnswers: [line(['a cloth', 'a bowl']), line(['a bowl', 'a cloth']), line(['a cloth', 'a bowl'])],
            foodness,
        });

        await engine.parse(['a bowl in a cloth']);

        expect(retry.parse).toHaveBeenCalledTimes(MAX_PARSE_ATTEMPTS - 1);
    });

    it('⚠️ an answer the validators PASS is returned by the pass path, never by this one', async () => {
        const { engine, retry } = build({
            firstAnswers: [line(['flour'])],
            retryAnswers: [line(['flour'])],
        });

        const [answer] = await engine.parse(['1 cup flour']);

        expect(retry.parse).not.toHaveBeenCalled();
        expect(answer).toMatchObject({ foods: [{ name: 'flour' }], llmAttempts: 1 });
    });
});

/**
 * ⛔ THE JUDGE IS ASKED ABOUT THE NAME THE SYSTEM WOULD STORE, not the string the model happened to write.
 *
 * KTD-11b files a temperature as `prep`, and `canonicaliseFood` — "the ONE normalisation that also applies
 * to what is STORED" — already moves it there on the merged line. The judge, however, decorates the LLM
 * port UPSTREAM of that merge, so it used to be handed `cold water` — a string this pipeline never stores.
 * Measured over the 1919 corpus: the judge answers FOOD for `water` and `fat` and NOT-FOOD for `cold
 * water`, `hot water`, `boiling water`, `hot fat` and `boiling fat`, which put 10 of 73 terminal
 * `not_a_food` lines there on a word the system had already decided was not part of the name.
 *
 * ⚠️ This is NOT sanitising the input. `buildFoodnessPrompt`'s ONE-ARGUMENT pin is untouched and it still
 * does not alter what it is given; what moved is WHICH name is the subject — placement deletes nothing and
 * only relocates a word the line actually wrote.
 */
describe('the judged subject is the placed name', () => {
    /**
     * ⚠️ THE ANSWER IS RETURNED UNTOUCHED, which is what the final assertion here pins. Placement decides
     * the judged SUBJECT; it does not rewrite what the engine said — `foods: [{ name: 'cold water' }]`
     * comes back exactly as the model wrote it. The merge applies the same rule to the stored line, so
     * re-placing here would be a second place for the same knowledge to live, and a wrong one: the CRF's
     * answer never passes through this decorator at all.
     */
    it('⛔ asks about `water`, not `cold water`, so a stated temperature cannot fail the line', async () => {
        const foodness = vi
            .fn()
            .mockImplementation((name: string) =>
                Promise.resolve(name === 'water' ? judged(true, 'beverage') : judged(false, 'ingredient')),
            );
        const { engine, retry } = build({ firstAnswers: [line(['cold water'])], foodness });

        const [answer] = await engine.parse(['four quarts cold water']);

        expect(foodness).toHaveBeenCalledWith('water');
        expect(retry.parse).not.toHaveBeenCalled();
        expect(answer).toMatchObject({ foods: [{ name: 'cold water' }], reviewReasons: [], llmAttempts: 1 });
    });

    /**
     * ⛔ PLACEMENT MOVES WORDS BOTH WAYS, and a mutant that only strips a leading temperature passes every
     * other case in this block. An ADJECTIVE in `prep` is identity under KTD-11b, so it travels INTO the
     * name: the judge is asked about `granulated sugar`, not `sugar`. That direction is what the report's
     * append probe measured (0 regressions over 12 purchasable forms), and it is the half a
     * strip-the-prefix implementation would silently drop.
     */
    it('⛔ also carries an identity word from `prep` INTO the judged name', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(true, 'sweetener'));
        const withPrep: ParsedLine = {
            ...line([]),
            foods: [{ name: 'sugar', prep: 'granulated' }],
        };
        const { engine } = build({ firstAnswers: [withPrep], foodness });

        await engine.parse(['1 cup granulated sugar']);

        expect(foodness).toHaveBeenCalledWith('granulated sugar');
    });

    it('reports a genuine rejection under the name the MODEL wrote, so the retry sees its own words', async () => {
        const foodness = vi.fn().mockResolvedValue(judged(false, 'equipment'));
        const { engine, retry } = build({ firstAnswers: [line(['hot plate'])], foodness });

        await engine.parse(['a hot plate']);

        expect(retry.parse).toHaveBeenCalledWith('a hot plate', [
            { kind: 'not-a-food', name: 'hot plate', taxonomy: 'equipment' },
        ]);
    });
});
