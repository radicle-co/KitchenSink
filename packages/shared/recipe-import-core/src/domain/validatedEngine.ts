/**
 * THE VALIDATOR LOOP — an engine-port DECORATOR over the LLM leg (plan U7, KTD-D / origin D5, D6).
 *
 * DESIGN PATTERN: **Decorator over a Port.** `ParseEnginePort`'s "lines and nothing else" contract keeps
 * the loop invisible to the CRF and to the pipeline: the pipeline calls `parse(lines)` exactly as before,
 * the CRF's answers are byte-identical with or without this module, and independence (ADR-0026 §1) is
 * untouched — nothing here ever sees a CRF answer.
 *
 * ## The loop, precisely (origin D5)
 *
 *  - The retry loop lives on the PARSE side only, and only where the critic adds information: a foodness
 *    verdict ("not a food — it is equipment") is NEW information a retry can use. Feeding it back is the
 *    conscious carve-out from the poisoning rule (`parse-retry-prompt`
 *    owns the containment: clamps + its own pin).
 *  - A parse that named NO FOOD AT ALL is a failure of its own (`no-food`). The two judges cannot see it
 *    between them — the foodness judge iterates the food list and an empty list judges nothing, while the
 *    measurement judge is asked only about the measure and can pass it — so a measure bound to nothing
 *    used to pass on the first attempt and land as a clean parse. ⚠️ It fires on every foodless parse,
 *    including the lines that genuinely name no food (a heading, `spoonfuls`, `a baking-board`) — which is
 *    what R2 below bounds: those lines cost ONE retry rather than the whole budget, so the trigger stays
 *    wide and the cost is capped where it is paid.
 *  - Max {@link MAX_PARSE_ATTEMPTS} total attempts (1 + 3 retries). Exhaustion is the recorded terminal
 *    `un-parseable` state (R6): the line is SAVED — `raw` intact, `foods` EMPTY so nothing is bound and
 *    no food entity is created — under a review reason naming WHICH terminal fact it was. ⛔ Two, and they
 *    are disjoint: `not_a_food` when a validator DISPUTED the names, `no_food_returned` when the parse
 *    returned none to dispute. See `exhaust` for the invariant and for why one token for both let
 *    the merge drop a verdict.
 *  - ⛔ TWO EARLY STOPS CUT THAT BUDGET SHORT, and both are owner rulings of 2026-09-19. **R2 — empty
 *    twice, stop:** a foodless parse is retried ONCE, and a retry that is also foodless ends the loop with
 *    the remaining attempts unspent (see {@link foodlessTwice}). **R4 — same answer twice, stop:** a retry
 *    that repeats the previous attempt ends the loop too, because "a model repeating itself will not be
 *    talked round, and each retry is a billed call" (see {@link sameAnswer}). ⚠️ Both stop the LOOP and
 *    change nothing else: the terminal record is whatever `exhaust` would have written at the budget,
 *    flags included, because accepting an answer is not the same as believing it.
 *  - ⚠️ R4 reaches the bad-name class too, and that is a deliberate reading rather than a narrowing of R3.
 *    R3 keeps the full budget for a parser that keeps producing new readings; a parser that produced the
 *    same rejected name twice has stopped producing readings, and R4's own rationale — a billed call that
 *    cannot change the answer — is strongest exactly there.
 *  - `could-not-judge` does NOT retry and does NOT count an attempt (R25): a validator that could not
 *    answer is ABSENCE, and retrying on absence would burn the bounded attempts on the validator's
 *    hiccups rather than the parser's mistakes.
 *  - Attempt provenance (`llmAttempts`) rides every answer (R8), so the comparator's agreement stats can
 *    be sliced by how hard the answer was to obtain.
 *
 * ## ⚠️ An UNAVAILABLE retry is absence, not exhaustion
 *
 * A retry the spend ceiling denied (or a transport that threw) is TRANSIENT. Returning the last FAILED
 * parse would publish an answer a validator already rejected; declaring EITHER terminal record
 * (`not_a_food`, `no_food_returned`) would turn an outage into a permanent fact about the line (the
 * `single-engine` ≠ `differ` rule one layer up). So the line's
 * answer is `EngineUnavailable`, and the caller's own redelivery/cache machinery re-pays only what
 * the cache has not kept (KTD-F).
 *
 * ## Validators are Ports (D6)
 *
 * The foodness judge and the measurement judge are injected. The MEASUREMENT port's production adapter
 * reuses the verifyLine gate's machinery as a library (R7 — no second measurement LLM):
 * `buildVerificationPrompt(aspects: ['quantity'])` + `readVerdict`, wired by each leg (the operator CLI
 * with its own transport; the recipe-workers Lambda under the single Bedrock grantee).
 */
import { ABSENT_QUANTITY } from '@kitchensink/recipe-core';
import type { FoodnessReading } from '@kitchensink/recipe-core/parsing/foodness-answer';
import type { RetryFailure } from '@kitchensink/recipe-core/parsing/parse-retry-prompt';

import type { ParsedLine } from '../parsedLine.js';
import { canonicaliseFood, type EngineAnswer } from './parseComparator.js';
import type { ParseEnginePort } from './parsePipeline.js';

/** 1 first attempt + 3 retries (origin D5's bound). */
export const MAX_PARSE_ATTEMPTS = 4;

/** The foodness judge — U6's reading, per name. */
export interface FoodnessValidatorPort {
    /**
     * @param name - One parsed food name, verbatim.
     * @returns The three-valued reading. @sideEffect One gated LLM call.
     */
    judge(name: string): Promise<FoodnessReading>;
}

/** The measurement judge — the verifyLine gate's quantity machinery, behind a port (R7). */
export interface MeasurementValidatorPort {
    /**
     * @param line - The raw source line.
     * @param parse - The attempt to judge.
     * @returns `pass`, `fail`, or `could-not-judge` (absence — never retried on). @sideEffect One gated
     *   LLM call through the gate's machinery.
     */
    judge(line: string, parse: ParsedLine): Promise<'pass' | 'fail' | 'could-not-judge'>;
}

/**
 * The retry call — a DIFFERENT contract from `ParseEnginePort.parse`, deliberately: the first-attempt
 * port's one-argument signature is the independence pin, and the retry's failure context must not be able
 * to reach it. The adapter behind this builds `buildParseRetryPrompt(line, failures)`.
 */
export interface RetryParsePort {
    parse(line: string, failures: readonly RetryFailure[]): Promise<EngineAnswer>;
}

/** Everything the decorator wraps. */
export interface ValidatedEngineDeps {
    readonly inner: ParseEnginePort<'llm'>;
    readonly retry: RetryParsePort;
    readonly foodness: FoodnessValidatorPort;
    readonly measurement: MeasurementValidatorPort;
}

/** Whether an answer is the unavailable marker. */
function isUnavailable(answer: EngineAnswer): answer is Extract<EngineAnswer, { unavailable: true }> {
    return 'unavailable' in answer && answer.unavailable;
}

/**
 * Reduce one crossing string to its comparable form.
 *
 * @param text - A food name or a stated measure, as the model wrote it.
 * @returns It lower-cased, trimmed, and with internal runs of whitespace collapsed. Pure.
 */
function fold(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/gu, ' ');
}

/**
 * R2 — whether the parser has now returned NO FOOD on two consecutive attempts (owner ruling 2026-09-19).
 *
 * "If the parse comes back with no foods, retry ONCE. If the retry is also empty, stop." The remaining
 * attempts are not spent: a second empty list is the model declining the question, not failing to hear it,
 * and each further retry costs a parse call plus its measurement judge for an answer that will not arrive.
 *
 * ⛔ CONSECUTIVE, not cumulative — the ruling's "the retry" is the one that immediately followed. A run
 * that went empty, then named a food the checker rejected, then went empty again is the bad-name class R3
 * explicitly keeps the full budget for, and counting foodless attempts across it would narrow R3 by the
 * back door.
 *
 * @param previous - The attempt before this one, or `null` on the first attempt.
 * @param attempt - The attempt just validated.
 * @returns `true` when both named no food at all. Pure.
 */
function foodlessTwice(previous: ParsedLine | null, attempt: ParsedLine): boolean {
    return previous !== null && previous.foods.length === 0 && attempt.foods.length === 0;
}

/**
 * R4 — whether a retry came back with the SAME answer as the attempt before it (owner ruling 2026-09-19).
 *
 * ## ⛔ WHAT "THE SAME ANSWER" MEANS, and why it is these two facts
 *
 * The food NAMES, in order, and the STATED MEASURE — folded for case and whitespace. That is not a
 * convenient subset: it is exactly the set of facts a validator can object to. `not-a-food` names a food
 * name, `measurement` and `no-food` name the stated measure, and NO JUDGE IS ASKED ABOUT ANYTHING ELSE. So
 * an answer that moved only some other field draws the SAME objections from the same judges, and the retry
 * it would buy is as futile as the one that produced it — which is the ruling's own reasoning ("a model
 * repeating itself will not be talked round, and each retry is a billed call").
 *
 * ⚠️ Three decisions inside that, stated because each could reasonably have gone the other way:
 *
 *  - **Folded.** ` A  Bowl ` and `a bowl` are the same reading spelled twice, and both judges would answer
 *    identically. Folding widens "the same" and so stops more runs and saves more calls.
 *  - **ORDERED.** A food list's order is the order the line named them in (`ParsedFacts.foods`), so two
 *    orderings are two readings. Comparing as a set would narrow "the same" — it would call a re-ordered
 *    list a repeat and stop a loop that was still moving.
 *  - **Not `quantity`/`unit`, and not `prep`.** ⚠️ Stated precisely, because the loose version of it is
 *    false: a `prep` change IS a real difference, and `exhaust` keeps the attempt whole, so the
 *    answer stored is whichever of the two arrived second. What makes that acceptable is not that the
 *    difference is nothing — it is that NO JUDGE IS ASKED about `prep`, or about `quantity`/`unit` (one
 *    reader's reading OF the phrase), so the loop has no mechanism to talk the model into a better one.
 *    Spending a billed call on the chance of an improvement nothing in this loop can steer is exactly what
 *    R4 forbids. Comparing the phrase is the honest line: it is what the model produced and what the judge
 *    was shown.
 *
 * @param previous - The attempt before this one, or `null` on the first attempt.
 * @param attempt - The attempt just validated.
 * @returns `true` when the two state the same food names, in the same order, under the same measure. Pure.
 */
function sameAnswer(previous: ParsedLine | null, attempt: ParsedLine): boolean {
    if (previous === null) {
        return false;
    }

    if (fold(previous.statedMeasure ?? '') !== fold(attempt.statedMeasure ?? '')) {
        return false;
    }

    if (previous.foods.length !== attempt.foods.length) {
        return false;
    }

    return previous.foods.every((food, index) => fold(food.name) === fold(attempt.foods[index]?.name ?? ''));
}

/**
 * Wrap the LLM engine port in the validator loop.
 *
 * @param deps - The inner port, the retry port, and the two validators.
 * @returns A port with the same identity and the loop inside.
 */
export function createValidatedLlmEngine(deps: ValidatedEngineDeps): ParseEnginePort<'llm'> {
    /**
     * Judge one attempt. `null` means pass (or nothing judgeable); otherwise the failures for the retry.
     */
    async function validate(raw: string, attempt: ParsedLine): Promise<readonly RetryFailure[] | null> {
        const failures: RetryFailure[] = [];

        // ⛔ THE EMPTY LIST FIRST, because the loop below is structurally blind to it. Every per-food
        // failure comes from iterating `attempt.foods`, so a parse that named NO food judged nothing, drew
        // no failure, and passed — while the measurement judge happily confirmed the measure. Measured over
        // 1,265 lines, the model returned a measure and no food on 28 ('three quarts of cold water' →
        // measure "three", no foods), and every one landed as a clean parse with an empty name and
        // `needsReview: false`. A measure bound to nothing is not an answer, so it is a failure here.
        //
        // ⚠️ The measurement judge still runs underneath: its verdict is independent information, and a
        // foodless parse whose measure is ALSO disputed should say both. That makes a foodless attempt cost
        // two calls rather than one, and the lever if that ever matters is to SKIP the measurement judge
        // when the food list is empty — one saved call per foodless attempt, paid for by losing the second
        // half of the failure context the retry is given. It is not taken: R2 already bounds the cost at
        // ONE retry for this class, so the saving is small and the information is not.
        if (attempt.foods.length === 0) {
            failures.push({ kind: 'no-food', statedMeasure: attempt.statedMeasure });
        }

        for (const food of attempt.foods) {
            // ⛔ THE PLACED NAME IS THE SUBJECT, because it is the name this system would STORE.
            // `canonicaliseFood` is the one normalisation that also applies to the merged line (KTD-11b:
            // a temperature is `prep`), and this decorator sits UPSTREAM of that merge — so without it the
            // judge is asked about `cold water`, a string the pipeline never stores, and answers NOT-FOOD
            // while answering FOOD for `water`. Measured over the 1919 corpus (LLM leg alone — see
            // `docs/reports/2026-09-19/validatorLoopCorpusDiff.md` §9 and §11): 10 of 73 terminal
            // `not_a_food` lines were exactly that.
            //
            // ⚠️ It is not sanitising: placement DELETES nothing, it only decides which field holds a word
            // the line already wrote, so the prompt still receives a name the cook's line contains.
            const reading = await deps.foodness.judge(canonicaliseFood(food).name);

            if (reading.kind === 'judged' && !reading.isFood) {
                // ⛔ REPORTED UNDER THE NAME THE MODEL WROTE, and `exhaust` is what makes that mechanical
                // rather than a preference: it keys `disputedNames` off this `name` and filters
                // `attempt.foods` by `food.name`, so reporting the PLACED name would stop matching and
                // publish a name a validator rejected. The retry is also then shown its own words.
                failures.push({ kind: 'not-a-food', name: food.name, taxonomy: reading.taxonomy });
            }
            // could-not-judge: absence — neither a failure nor a pass vote (R25).
        }

        const measure = await deps.measurement.judge(raw, attempt);

        if (measure === 'fail') {
            failures.push({ kind: 'measurement', statedByModel: attempt.statedMeasure ?? '(none)' });
        }

        return failures.length === 0 ? null : failures;
    }

    /**
     * The terminal `un-parseable` record (R6): the line saved, nothing bound, every stated value blanked.
     *
     * ⚠️ NOT the only route to `foods: []`, and the OTHER one does not come here. This is for a parse whose
     * every food NAME a validator disputed, where the measure is attached to something no validator
     * accepted and is blanked with it. A parse that returned NO name to dispute keeps what it stated, under
     * `no_food_returned` rather than this reason — see {@link exhaust}.
     */
    function unParseable(raw: string, attempts: number): ParsedLine {
        return {
            raw,
            statedMeasure: null,
            quantity: ABSENT_QUANTITY,
            unit: null,
            foods: [],
            reviewReasons: ['not_a_food'],
            provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
            llmAttempts: attempts,
        };
    }

    /**
     * The terminal state when the retries ran out — decided by WHICH validator was still objecting
     * (amended 2026-08-31, from the U7 corpus diff).
     *
     * ⛔ The original exhaustion collapsed every failure kind into {@link unParseable}, which DELETED
     * foods no validator had disputed: 'one-fourth teaspoon of salt' and 'two teaspoons of sugar' landed
     * `foods: []` under `not_a_food` because the MEASURE judge kept disagreeing — a false DISAGREE
     * converted into a food loss, the direction U11 ranks unacceptable. So exhaustion now keeps every
     * food the foodness judge passed and every measure value the parse read:
     *
     *  - measurement-only objection → the attempt survives WHOLE, flagged `measurement_unverified`;
     *  - some foods disputed → the PASSED foods survive, the disputed ones are dropped, `not_a_food`
     *    records the drop (plus `measurement_unverified` when that judge also objected);
     *  - every food disputed and nothing else to keep → {@link unParseable}, exactly as before (the
     *    equipment/heading case R6 describes);
     *  - NO food returned at all → the attempt survives with its measure, flagged `no_food_returned`.
     *
     * ## ⛔ THE INVARIANT THE LAST TWO BULLETS REST ON (2026-09-19)
     *
     * `not_a_food` means **a validator disputed a name**; `no_food_returned` means **the model returned
     * nothing**. They are DISJOINT by construction — `validate` raises `no-food` only on an EMPTY food list
     * and `not-a-food` only per member of that same list, so no attempt can draw both — and the difference
     * is load-bearing one layer up: `parseComparator.ts`'s `mergedReasons` (not exported, so no link)
     * drops the SILENCE
     * when the other engine's food is taken, and must keep the VERDICT. One token for both facts let a
     * CRF-rescued line whose every LLM name a judge had rejected land `parsed` with no reason at all.
     *
     * ⛔ `attempts` IS A PARAMETER, not `MAX_PARSE_ATTEMPTS`. R2 and R4 reach this function before the
     * budget is spent, and a hardcoded maximum would make `llmAttempts` — R8's provenance, which exists so
     * agreement stats can be sliced by how hard an answer was to obtain — report calls that were never
     * billed. It is also the number every cost claim about those two rules is read from.
     *
     * Pure.
     */
    function exhaust(
        raw: string,
        attempt: ParsedLine,
        failures: readonly RetryFailure[],
        attempts: number,
    ): ParsedLine {
        const disputedNames = new Set(
            failures.filter((failure) => failure.kind === 'not-a-food').map((failure) => failure.name),
        );
        const keptFoods = attempt.foods.filter((food) => !disputedNames.has(food.name));
        const measureDisputed = failures.some((failure) => failure.kind === 'measurement');
        const noFoodReturned = failures.some((failure) => failure.kind === 'no-food');

        if (keptFoods.length === 0 && disputedNames.size > 0) {
            return unParseable(raw, attempts);
        }

        const reasons = [...attempt.reviewReasons];

        // ⛔ `noFoodReturned` records the same terminal OUTCOME — nothing is bound — under a reason of its
        // OWN, and it keeps what `unParseable` would blank. Two separate decisions sit here, and both
        // are this function's amended principle one field over:
        //
        //  - it does not route through `unParseable`, because that blanks the measure. Right when every
        //    NAME was disputed (the parse read the line wrongly enough that its measure is attached to
        //    something no validator accepted); wrong here, where no validator questioned the measure, the
        //    judge may have passed it outright, and a reviewer shown "three" can correct the line where a
        //    reviewer shown "No amount given" cannot.
        //  - it does not reuse `not_a_food`, because that reason is a VERDICT and this is SILENCE — see
        //    this function's docstring on the invariant, and `mergedReasons` for the merge that acts on it.
        //
        // The two branches are disjoint by construction — an empty food list has no names to dispute — so
        // the order they are written in decides nothing.
        if (disputedNames.size > 0 && !reasons.includes('not_a_food')) {
            reasons.push('not_a_food');
        }

        if (noFoodReturned && !reasons.includes('no_food_returned')) {
            reasons.push('no_food_returned');
        }

        if (measureDisputed && !reasons.includes('measurement_unverified')) {
            reasons.push('measurement_unverified');
        }

        return { ...attempt, foods: keptFoods, reviewReasons: reasons, llmAttempts: attempts };
    }

    async function runLoop(raw: string, first: EngineAnswer): Promise<EngineAnswer> {
        if (isUnavailable(first)) {
            return first;
        }

        let attempt = first;
        let previous: ParsedLine | null = null;

        for (let count = 1; count <= MAX_PARSE_ATTEMPTS; count += 1) {
            const failures = await validate(raw, attempt);

            if (failures === null) {
                return { ...attempt, llmAttempts: count };
            }

            // ⛔ THE THREE WAYS THIS LOOP ENDS, asked together because they end it identically: the budget
            // is spent (R6), the parser has now returned nothing twice running (R2), or it has returned the
            // same thing twice running (R4). ⚠️ The two rulings overlap — two foodless answers stating the
            // same measure satisfy both — and they are kept apart anyway, because neither implies the
            // other: R2 stops two empty answers that state DIFFERENT measures, and R4 stops two identical
            // answers that both name a food. Collapsing them would silently delete one ruling.
            if (count === MAX_PARSE_ATTEMPTS || foodlessTwice(previous, attempt) || sameAnswer(previous, attempt)) {
                return exhaust(raw, attempt, failures, count);
            }

            const next = await deps.retry.parse(raw, failures);

            if (isUnavailable(next)) {
                return next;
            }

            previous = attempt;
            attempt = next;
        }

        // Unreachable: the loop returns from every branch by MAX_PARSE_ATTEMPTS.
        return unParseable(raw, MAX_PARSE_ATTEMPTS);
    }

    return {
        engine: deps.inner.engine,
        engineVersion: deps.inner.engineVersion,
        async parse(lines: readonly string[]): Promise<readonly EngineAnswer[]> {
            const firsts = await deps.inner.parse(lines);
            const answers: EngineAnswer[] = [];

            for (const [index, raw] of lines.entries()) {
                const first = firsts[index] ?? { unavailable: true as const };
                answers.push(await runLoop(raw, first));
            }

            return answers;
        },
    };
}
