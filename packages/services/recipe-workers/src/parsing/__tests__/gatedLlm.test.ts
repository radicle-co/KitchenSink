/**
 * The gated spine's SPEND SHAPE (ADR-0024 layer 1) — what it reserves with, and what it says when the bill
 * beats the reservation.
 *
 * ⛔ This spine had no unit suite of its own: `gatedMeasurementCallSite.test.ts` pins one dimension and the
 * wiring tests reach it through the handler. What went unasserted was the one number layer 1 exists for —
 * the input-token bound the plan is priced from — which was `[...system].length + [...user].length + 400`:
 * code points (not a token bound for a byte-fallback tokenizer), a bare `400` with no provenance, and NO
 * count of the few-shot turns the foodness validator sends beside them. These tests derive the expected
 * bound from what the transport was actually handed, so the assertion cannot drift from the request.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ParsedLine } from '@kitchensink/recipe-import-core';
import {
    BEDROCK_MODEL_REGISTRY,
    NOVA_2_LITE_MODEL_ID,
    NOVA_LITE_MODEL_ID,
    NOVA_MICRO_MODEL_ID,
    inputTokenBound,
    worstCaseMicros,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { FOODNESS_MAX_OUTPUT_TOKENS, FOODNESS_MODEL_ID } from '@kitchensink/recipe-core/parsing/foodness-prompt';
import { VERIFICATION_MAX_OUTPUT_TOKENS } from '@kitchensink/recipe-core/resolution/verification-prompt';
import type { RetryFailure } from '@kitchensink/recipe-core/parsing/parse-retry-prompt';
import type { ConverseRequest } from '@kitchensink/bedrock-client';

import { INPUT_BOUND_EXCEEDED_METRIC_NAME, RESIDENCY_REFUSED_METRIC_NAME } from '../../common/spendMetrics.js';
import { ResidencyRefusedError, isResidencyRefusedError } from '../../common/residencyRefused.js';
import {
    createGatedFoodnessValidator,
    createGatedLlmEngine,
    createGatedMeasurementValidator,
    createGatedRetryPort,
    type GatedLlmDeps,
} from '../gatedLlm.js';

/**
 * Tuple- and union-exact type equality, in the invariant-position form `recipe-core`'s `parsePrompt.test.ts`
 * and `recipe-import-core`'s `parsedLine.test.ts` already use. Invariant, so a merely-ASSIGNABLE type fails:
 * `[string]` and `[string, unknown?]` are not interchangeable, and neither are `'a' | 'b'` and `'a' | 'b' | 'c'`.
 */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

interface Usage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly cacheReadInputTokens?: number;
}

function makeDeps(usage: Usage): {
    deps: GatedLlmDeps;
    reserve: ReturnType<typeof vi.fn>;
    converse: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
} {
    const reserve = vi.fn().mockResolvedValue({ kind: 'reserved', reservedMicros: 100 });
    const emit = vi.fn();
    const converse = vi.fn().mockResolvedValue({
        kind: 'answered',
        text: '{"verdict":"agree","certainty":"high"}',
        stopReason: 'end_turn',
        usage,
    });

    return {
        emit,
        reserve,
        converse,
        deps: {
            stage: 'prod',
            deployRegion: 'us-east-1',
            settings: {
                resolve: vi.fn().mockResolvedValue({ ceilingMicros: 100_000_000, modelId: NOVA_MICRO_MODEL_ID }),
            },
            ledger: { reserve, settle: vi.fn().mockResolvedValue(undefined) },
            bedrock: { converse },
            emit,
            now: () => new Date('2026-09-03T12:00:01.000Z'),
        } as never,
    };
}

const PARSE: ParsedLine = {
    foods: [{ name: 'flour' }],
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    preparation: null,
    needsReview: false,
} as never;

/** Every text segment the request carries, in the order the transport sends them. */
function turnsOf(request: ConverseRequest): readonly string[] {
    return [
        request.systemPrompt,
        ...(request.fewShotTurns ?? []).flatMap((turn) => [turn.user, turn.assistant]),
        request.userMessage,
    ];
}

const NOVA_RATE = BEDROCK_MODEL_REGISTRY[NOVA_MICRO_MODEL_ID]!.rate;

/**
 * ⛔ THE NO-POISONING RULE, ENFORCED BY THE TYPE SYSTEM — the pin that did not follow the code it guarded.
 *
 * ADR-0026 §1, in the owner's words: _"we have to be careful not to send the failed result from the CRF
 * Lambda or any context of it so we don't poison it — it'll be effectively like a try again."_ The whole
 * premise of KTD-10's comparator is that the two engines are INDEPENDENT; a model shown our parse anchors on
 * it and agrees more often, so the failure is INVISIBLE — the metric that looks like the pipeline improving
 * is the metric that moves, and no assertion about the ANSWERS can tell the two apart. That is why this is
 * enforced by `tsc` and not by review: a reviewer can miss a second argument, `tsc` cannot.
 *
 * ⛔ WHY IT IS RESTATED HERE. The rule was pinned in TWO places, and only one of them still stands on its
 * own: `buildParsePrompt`'s one-argument signature, in `recipe-core`'s `parsePrompt.test.ts`. The other sat
 * on the OUTWARD CARRIER — `LlmParseDeps`' key set, in `llmParse.test.ts` — and when that leg was deleted
 * (2026-08-29) the property moved here with {@link createGatedLlmEngine} while the pin did not follow it. A
 * guard left in a place no reader of the live code opens is a recorded failure mode of this work; so is a
 * guard that quietly stops existing.
 *
 * ⚠️ WHAT THESE FOUR ASSERTIONS DO NOT COVER, stated so nobody reads more into them than they say:
 *
 *  - The two VALIDATOR legs are deliberately out of scope. `MeasurementValidatorPort.judge(line, parse)`
 *    takes a `ParsedLine` BY DESIGN — it is the gate's quantity machinery judging the LLM's OWN attempt
 *    (R7), never the CRF's — and the retry's `RetryFailure` context is D5's conscious, clamped carve-out
 *    from the same rule. Pinning them as "no parse may reach an LLM call" would be a FALSE claim.
 *  - A member's TYPE could still be widened to smuggle a reading (`settings.resolve()` answering one). The
 *    key-set pin sees a new KEY, not a new field inside an existing port's payload. What closes that path is
 *    one layer down: whatever a carrier held still has to reach the model through `buildParsePrompt(line)`.
 *  - Nothing here stops a body that CONCATENATES a reading onto `prompt.userMessage`. Types pin signatures,
 *    not statements; that residue is the comparator's own corpus-diff check, not this file's.
 */
describe('⛔ the no-poisoning rule, pinned on the carrier a CRF reading would arrive through', () => {
    it('exposes no slot on the deps through which an engine reading could arrive', () => {
        // ⛔ Adding `crf`, `crfReading`, `hint`, `priorParse` or ANY other member to `GatedLlmDeps` — required
        // or optional — breaks this assignment. Every member named here is infrastructure: a stage label, the
        // deploy region, a settings resolver, the spend ledger, the Bedrock adapter, a metric sink and a
        // clock. None of them can hold a parse.
        const depsAreOnlyInfrastructure: Exact<
            keyof GatedLlmDeps,
            'stage' | 'deployRegion' | 'settings' | 'ledger' | 'bedrock' | 'emit' | 'now'
        > = true;

        expect(depsAreOnlyInfrastructure).toBe(true);
    });

    it('builds the first-attempt engine from the deps and a MODEL ID, and nothing else', () => {
        // The deleted pin's other half: a third parameter is the obvious place a "context" argument lands.
        const takesOnlyDepsAndModelId: Exact<Parameters<typeof createGatedLlmEngine>, [GatedLlmDeps, string]> = true;

        expect(takesOnlyDepsAndModelId).toBe(true);
    });

    it('hands that engine SOURCE LINES and nothing else', () => {
        // ⛔ Read through the RETURNED port, not off the interface, so a widening of `ParseEnginePort.parse`
        // in `recipe-import-core` — the seam where a batch of CRF answers would naturally be passed
        // alongside the lines — fails HERE, in the leg that must never receive them.
        const parseTakesOnlyLines: Exact<
            Parameters<ReturnType<typeof createGatedLlmEngine>['parse']>,
            [readonly string[]]
        > = true;

        expect(parseTakesOnlyLines).toBe(true);
    });

    it('keeps the retry`s carve-out to the line and the VALIDATOR`s own rejections', () => {
        // ⚠️ The retry DOES carry context, and that is D5's deliberate carve-out — a foodness verdict is new
        // information, clamped by `parse-retry-prompt`. What this pins is that the carve-out stays exactly
        // that shape: a third parameter, or a failure list of some other type, is a build failure.
        const retryTakesLineAndFailures: Exact<
            Parameters<ReturnType<typeof createGatedRetryPort>['parse']>,
            [string, readonly RetryFailure[]]
        > = true;

        expect(retryTakesLineAndFailures).toBe(true);
    });
});

describe('gatedConverse — the input-token bound the plan is priced from', () => {
    it('prices the FOODNESS call over every turn it sends, few-shot turns included', async () => {
        // ⛔ The foodness validator sends six few-shot messages beside the system and user turns. A bound
        // over `system + user` alone under-prices the call by every byte of those examples — and the
        // reservation is then a lie in exactly the direction ADR-0024 §2 forbids.
        const { deps, reserve, converse } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedFoodnessValidator(deps).judge('flour');

        const request = converse.mock.calls[0]?.[0] as ConverseRequest;
        const plan = reserve.mock.calls[0]?.[0] as { worstMicros: number; modelId: string };

        expect(request.fewShotTurns?.length ?? 0).toBeGreaterThan(0);
        expect(plan.modelId).toBe(FOODNESS_MODEL_ID);
        expect(plan.worstMicros).toBe(
            worstCaseMicros(NOVA_RATE, inputTokenBound(turnsOf(request)), FOODNESS_MAX_OUTPUT_TOKENS),
        );
    });

    it('prices the MEASUREMENT call from the prompt in hand — bytes plus the template allowance', async () => {
        const { deps, reserve, converse } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedMeasurementValidator(deps, NOVA_MICRO_MODEL_ID).judge('2 cups flour', PARSE);

        const request = converse.mock.calls[0]?.[0] as ConverseRequest;
        const plan = reserve.mock.calls[0]?.[0] as { worstMicros: number };

        expect(plan.worstMicros).toBe(
            worstCaseMicros(NOVA_RATE, inputTokenBound(turnsOf(request)), VERIFICATION_MAX_OUTPUT_TOKENS),
        );
    });

    it('emits the over-bound DETECTOR, attributed, when the billed input beats the bound it reserved with', async () => {
        // A tokenizer that emits more than one token per byte — NFKC expansion, a template the allowance
        // under-counts, a new model — is invisible to the counter (the unclamped delta charges it silently).
        // This metric is what makes it visible. 9,000 billed tokens is beyond any bound a ~1 KB prompt yields.
        const { deps, converse, emit } = makeDeps({ inputTokens: 9_000, outputTokens: 5, totalTokens: 9_005 });

        await createGatedMeasurementValidator(deps, NOVA_MICRO_MODEL_ID).judge('2 cups flour', PARSE);

        const request = converse.mock.calls[0]?.[0] as ConverseRequest;
        const bound = inputTokenBound(turnsOf(request));
        const emitted = emit.mock.calls
            .map((call) => call[0])
            .find((m) => m?.name === INPUT_BOUND_EXCEEDED_METRIC_NAME);

        expect(emitted).toBeDefined();
        expect(emitted?.value).toBe(9_000 - bound);
        expect(emitted?.dimensions).toEqual({ CallSite: 'measurement-validator' });
    });

    it('counts CACHED input toward the detector — a warm parse call arrives almost entirely as cache reads', async () => {
        const { deps, emit } = makeDeps({
            inputTokens: 40,
            outputTokens: 5,
            totalTokens: 9_045,
            cacheReadInputTokens: 9_000,
        });

        await createGatedMeasurementValidator(deps, NOVA_MICRO_MODEL_ID).judge('2 cups flour', PARSE);

        const emitted = emit.mock.calls
            .map((call) => call[0])
            .find((m) => m?.name === INPUT_BOUND_EXCEEDED_METRIC_NAME);

        expect(emitted).toBeDefined();
    });

    it('stays silent when the billed input fits the bound', async () => {
        const { deps, emit } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedMeasurementValidator(deps, NOVA_MICRO_MODEL_ID).judge('2 cups flour', PARSE);

        expect(emit.mock.calls.map((call) => call[0]?.name)).not.toContain(INPUT_BOUND_EXCEEDED_METRIC_NAME);
    });
});

/**
 * RESIDENCY (ADR-0024 §4b) — the refusal, and the ONE mistake that would make it silently corrupt data.
 *
 * ⛔ THE MUTATION THIS BLOCK EXISTS TO CATCH is the design that reads correct: return absence, the same
 * `{ unavailable: true }` / `could-not-judge` every other non-answer produces. It is wrong, and its wrongness
 * is invisible from inside this file — it only shows up two layers up. `processParseLine` reads engine
 * ABSENCE as a deterministic per-line fact and lands the resulting single-engine merge as the line's
 * PERMANENT answer. Its own comment records the identical defect being repaired: "a line parsed during a CRF
 * outage landed the LLM's single-engine reading as its PERMANENT answer", which ADR-0026's 2026-08-31 rule
 * forbids. A residency refusal is a deployment fault, so it must leave through the same channel an outage
 * does — a throw — and be classified there.
 *
 * ⚠️ Throwing does NOT make it transient, which is the other half. `processParseLine` catches
 * `ResidencyRefusedError` BY NAME ahead of its transient re-throw, lands nothing, and redelivers nothing.
 * That fourth class is asserted in `parseLine.test.ts`; what is asserted here is that the channel exists and
 * that no port quietly converts it back into absence.
 *
 * ⛔ AND IT IS NOT A DISSENT (ADR-0026 §3). Nothing here records a verdict, a `differ`, or a `ParsedLine`
 * with empty fields — the refusal never reaches the comparator at all.
 */
describe('gatedConverse — a residency-unapproved model', () => {
    it('refuses BEFORE reserving or calling anything', async () => {
        const { deps, reserve, converse } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await expect(
            createGatedMeasurementValidator(deps, NOVA_2_LITE_MODEL_ID).judge('2 cups flour', PARSE),
        ).rejects.toThrow(ResidencyRefusedError);

        expect(converse).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
    });

    it('carries the whole judgement on the error, so the handler needs no second registry read', async () => {
        const { deps } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
        const caught = await createGatedLlmEngine(deps, NOVA_2_LITE_MODEL_ID)
            .parse(['2 cups flour'])
            .catch((error: unknown) => error);

        expect(isResidencyRefusedError(caught)).toBe(true);
        expect(isResidencyRefusedError(caught) ? caught.refusal : undefined).toEqual({
            kind: 'residency-unapproved',
            modelId: NOVA_2_LITE_MODEL_ID,
            deployRegion: 'us-east-1',
            reachedRegions: ['us-east-1', 'us-east-2', 'us-west-2'],
        });
    });

    /**
     * ⛔ THE MUTATION GUARD, stated as its own test because it is the assertion the wrong design passes.
     *
     * Every one of these ports has a natural absence value, and every one of them would return it happily.
     * If any port swallows the refusal into absence, `processParseLine` lands a single-engine answer for a
     * config fault — green tests, corrupted ingredients. Asserted across all four so a future port cannot be
     * the one that forgets.
     */
    it('lets the refusal OUT of every port — none of them converts it into absence', async () => {
        const { deps } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
        // Thunks, not promises: three rejections created eagerly would be unhandled until their turn.
        const ports: readonly (() => Promise<unknown>)[] = [
            () => createGatedLlmEngine(deps, NOVA_2_LITE_MODEL_ID).parse(['2 cups flour']),
            () =>
                createGatedRetryPort(deps, NOVA_2_LITE_MODEL_ID).parse('2 cups flour', [
                    { kind: 'measurement', statedByModel: '2 cups' },
                ]),
            () => createGatedMeasurementValidator(deps, NOVA_2_LITE_MODEL_ID).judge('2 cups flour', PARSE),
        ];

        for (const port of ports) {
            await expect(port()).rejects.toThrow(ResidencyRefusedError);
        }
    });

    /**
     * ⛔ THE REFUSAL MUST BE VISIBLE. `recipe-workers` has no log `SubscriptionFilter` and no metric filter —
     * the repository's only log drain is `WebhooksStack`'s, whose three targets are the webhook, the API and
     * the identity ECS service — so `logger.error` reaches nothing that alarms. A silenced parse leg is
     * otherwise invisible: lines simply stop landing.
     */
    it('EMITS the refusal, attributed to the leg that was silenced', async () => {
        const { deps, emit } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedMeasurementValidator(deps, NOVA_2_LITE_MODEL_ID)
            .judge('2 cups flour', PARSE)
            .catch(() => undefined);

        const emitted = emit.mock.calls
            .map((call) => call[0])
            .find((metric) => metric?.name === RESIDENCY_REFUSED_METRIC_NAME);

        expect(emitted).toBeDefined();
        expect(emitted?.value).toBe(1);
        expect(emitted?.dimensions).toEqual({ CallSite: 'measurement-validator' });
    });

    it('still calls a residency-CLEARED model — the gate is the marker, not the shape of the id', async () => {
        // Non-vacuity: every assertion above would also pass if the spine had simply stopped working.
        const { deps, converse, emit } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedMeasurementValidator(deps, NOVA_LITE_MODEL_ID).judge('2 cups flour', PARSE);

        expect(converse).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls.map((call) => call[0]?.name)).not.toContain(RESIDENCY_REFUSED_METRIC_NAME);
    });

    it('leaves the FOODNESS validator alone — it pins Nova Micro, which residency clears', async () => {
        // ⚠️ Its model is NOT the parse model: `buildFoodnessPrompt` owns that pin, so a parse-model
        // residency refusal must not silence a validator that was never going to leave the region.
        const { deps, converse } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedFoodnessValidator(deps).judge('flour');

        expect(converse).toHaveBeenCalledTimes(1);
        expect(converse.mock.calls[0]?.[0]?.invocationId).toBe(FOODNESS_MODEL_ID);
    });
});

/**
 * THE SERVICE TIER — why the shipped gated leg sends NONE, and what would have to be true before it could.
 *
 * ⛔ THIS IS THE ASSERTION THAT STOPS A PLAUSIBLE, EXPENSIVE MISTAKE. The reasoning that leads to it is
 * entirely sound right up to the last step: `flex` is half price on every token class and — unlike batch —
 * KEEPS PROMPT CACHING (ADR-0024 §5a, `BedrockConverseClient.ts:88-91`), the parse leg's 19,777-character
 * system prompt is almost the whole bill, `ConverseRequest.serviceTier` already exists, and
 * `cookbook-import`'s ungated leg already asks for it. Every one of those is true. The step that does not
 * follow is that the SHIPPED model can be asked.
 *
 * ⛔ `amazon.nova-lite-v1:0` — `PARSE_LEG_MODEL_ID`, what this leg actually calls — DOES NOT SUPPORT `flex`,
 * measured against the live account on 2026-09-04:
 *
 *   aws bedrock-runtime converse --model-id amazon.nova-lite-v1:0 --service-tier '{"type":"flex"}' …
 *   → ValidationException: The provided service tier is not supported for this model.
 *
 * The AWS Price List API says the same thing structurally: in us-east-1, `Nova Pro` publishes
 * `USE1-NovaPro-*-flex` and `-priority` usage types and `Nova 2 Lite` publishes `USE1-Nova2.0Lite-*-flex`
 * (input $0.000165/1K, exactly half), while **`Nova Lite` v1 and `Nova Micro` publish neither** — only
 * on-demand, batch, custom-model and provisioned. `flex` is a PER-MODEL capability, not a request flag.
 *
 * ⛔ AND THE FAILURE WOULD NOT BE A LOST DISCOUNT — IT WOULD BE A TOTAL, SILENT-UNTIL-DLQ OUTAGE OF THE PARSE
 * PIPELINE. `ValidationException` is in `UNBILLED_FAILURES`, so it becomes a `BedrockInvalidRequestError`,
 * which `gatedConverse` refunds and RE-THROWS; `processParseLine` collects any engine throw as TRANSIENT and
 * re-throws it before landing, so the message redelivers, deterministically fails again on every line, and
 * burns `maxReceiveCount` into the DLQ. Every ingredient line, every time, behind a green unit suite.
 *
 * ⚠️ THE ACCOUNTING IS ALREADY CONSISTENT, which is the other half of why there is nothing to repair here.
 * `BEDROCK_MODEL_REGISTRY` holds STANDARD on-demand rates — the Nova Pro entry says so in as many words
 * ("pricing a flex or priority run off this entry would be wrong in both directions") — and a `Converse` call
 * with no `serviceTier` is billed at exactly those rates. So today's reservation and today's settle price the
 * call the tier it is actually made on. Sending `flex` WITHOUT tier-aware rates would make every reservation
 * 2× the real cost: safe in ADR-0024's one-way direction, but it would halve the usable ceiling.
 *
 * ⚠️ WHAT WOULD HAVE TO CHANGE FIRST, so this is a route and not a wall: (1) a residency-clear, flex-capable
 * model for this leg — which today means 016 recording a `residencyApproval` on the Nova 2 Lite entry; (2) the
 * registry declaring which tiers a model publishes, so the tier cannot be asked for where it does not exist;
 * and (3) tier-aware rates, which narrows a SHIPPED reservation and is therefore an ADR-0024 decision rather
 * than a side effect. Until all three, the tier stays absent — and absent is not an oversight.
 */
describe('gatedConverse — the service tier the shipped leg must NOT ask for', () => {
    it('sends NO serviceTier on any of the four gated legs', async () => {
        const { deps, converse } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedLlmEngine(deps, NOVA_LITE_MODEL_ID).parse(['2 cups flour']);
        await createGatedRetryPort(deps, NOVA_LITE_MODEL_ID).parse('2 cups flour', [
            { kind: 'measurement', statedByModel: '2 cups' },
        ]);
        await createGatedFoodnessValidator(deps).judge('flour');
        await createGatedMeasurementValidator(deps, NOVA_LITE_MODEL_ID).judge('2 cups flour', PARSE);

        // Non-vacuity: all four legs really were called, so this is not passing on an empty call list.
        expect(converse).toHaveBeenCalledTimes(4);

        for (const [request] of converse.mock.calls as [ConverseRequest][]) {
            expect(request.serviceTier).toBeUndefined();
        }
    });

    it('still asks for the lever the shipped model DOES support — the prompt cache', async () => {
        // ⛔ The pair matters. A leg that stopped setting `cachePrompt` would pass the assertion above while
        // re-billing 5,025 tokens of system prompt as FRESH input on every line — the exact cost this tier
        // reasoning was chasing, lost in the other direction.
        const { deps, converse } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedLlmEngine(deps, NOVA_LITE_MODEL_ID).parse(['2 cups flour']);

        // Asserted separately from the cast so a leg that made NO call fails as "undefined", rather than
        // throwing a TypeError out of an optional chain that short-circuits (oxlint no-unsafe-optional-chaining).
        const firstCall = converse.mock.calls[0];

        expect(firstCall, 'the leg made no Bedrock call at all').toBeDefined();
        expect((firstCall?.[0] as ConverseRequest | undefined)?.cachePrompt).toBe(true);
    });
});
