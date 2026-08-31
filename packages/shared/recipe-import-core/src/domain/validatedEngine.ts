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
 *  - Max {@link MAX_PARSE_ATTEMPTS} total attempts (1 + 3 retries). Exhaustion is the recorded terminal
 *    `un-parseable` state (R6): the line is SAVED — `raw` intact, `foods` EMPTY so nothing is bound and
 *    no food entity is created — under the `not_a_food` review reason.
 *  - `could-not-judge` does NOT retry and does NOT count an attempt (R25): a validator that could not
 *    answer is ABSENCE, and retrying on absence would burn the bounded attempts on the validator's
 *    hiccups rather than the parser's mistakes.
 *  - Attempt provenance (`llmAttempts`) rides every answer (R8), so the comparator's agreement stats can
 *    be sliced by how hard the answer was to obtain.
 *
 * ## ⚠️ An UNAVAILABLE retry is absence, not exhaustion
 *
 * A retry the spend ceiling denied (or a transport that threw) is TRANSIENT. Returning the last FAILED
 * parse would publish an answer a validator already rejected; declaring `not_a_food` would turn an outage
 * into a permanent fact about the line (the `single-engine` ≠ `differ` rule one layer up). So the line's
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
import type { EngineAnswer } from './parseComparator.js';
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

        for (const food of attempt.foods) {
            const reading = await deps.foodness.judge(food.name);

            if (reading.kind === 'judged' && !reading.isFood) {
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

    /** The terminal `un-parseable` record (R6): the line saved, nothing bound. */
    function unParseable(raw: string): ParsedLine {
        return {
            raw,
            statedMeasure: null,
            quantity: ABSENT_QUANTITY,
            unit: null,
            foods: [],
            reviewReasons: ['not_a_food'],
            provenance: { statedMeasure: 'llm', quantity: 'llm', unit: 'llm', foods: 'llm' },
            llmAttempts: MAX_PARSE_ATTEMPTS,
        };
    }

    async function runLoop(raw: string, first: EngineAnswer): Promise<EngineAnswer> {
        if (isUnavailable(first)) {
            return first;
        }

        let attempt = first;

        for (let count = 1; count <= MAX_PARSE_ATTEMPTS; count += 1) {
            const failures = await validate(raw, attempt);

            if (failures === null) {
                return { ...attempt, llmAttempts: count };
            }

            if (count === MAX_PARSE_ATTEMPTS) {
                return unParseable(raw);
            }

            const next = await deps.retry.parse(raw, failures);

            if (isUnavailable(next)) {
                return next;
            }

            attempt = next;
        }

        // Unreachable: the loop returns from every branch by MAX_PARSE_ATTEMPTS.
        return unParseable(raw);
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
