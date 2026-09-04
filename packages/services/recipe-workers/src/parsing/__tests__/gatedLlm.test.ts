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
import type { ConverseRequest } from '@kitchensink/bedrock-client';

import { INPUT_BOUND_EXCEEDED_METRIC_NAME } from '../../common/spendMetrics.js';
import { ResidencyRefusedError, isResidencyRefusedError } from '../../common/residencyRefused.js';
import {
    createGatedFoodnessValidator,
    createGatedLlmEngine,
    createGatedMeasurementValidator,
    createGatedRetryPort,
    type GatedLlmDeps,
} from '../gatedLlm.js';

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

    it('still calls a residency-CLEARED model — the gate is the marker, not the shape of the id', async () => {
        // Non-vacuity: every assertion above would also pass if the spine had simply stopped working.
        const { deps, converse } = makeDeps({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });

        await createGatedMeasurementValidator(deps, NOVA_LITE_MODEL_ID).judge('2 cups flour', PARSE);

        expect(converse).toHaveBeenCalledTimes(1);
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
