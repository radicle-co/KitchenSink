/**
 * U14 (ADR-0024 update) — the MEASUREMENT validator bills its OWN call site.
 *
 * ⛔ It was billing under `foodness-validator`: `createGatedMeasurementValidator` really does reserve,
 * call Bedrock and settle (the "reuses the gate's machinery as a library and spends nothing" docstring
 * was FALSE as implemented), and attributing its spend to the foodness dimension made the one metric
 * that decomposes the ADR-0024 pool lie about which validator was burning it. Attribution, never
 * partitioning: the pool stays ONE ceiling.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ParsedLine } from '@kitchensink/recipe-import-core';

import { createGatedMeasurementValidator, type GatedLlmDeps } from '../gatedLlm.js';

function makeDeps(): { deps: GatedLlmDeps; reserve: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn> } {
    const reserve = vi.fn().mockResolvedValue({ kind: 'reserved', reservedMicros: 100 });
    const emit = vi.fn();

    return {
        emit,
        deps: {
            stage: 'prod',
            settings: {
                resolve: vi.fn().mockResolvedValue({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }),
            },
            ledger: { reserve, settle: vi.fn() },
            bedrock: {
                converse: vi.fn().mockResolvedValue({
                    kind: 'answered',
                    text: '{"verdict":"agree","certainty":"high"}',
                    stopReason: 'end_turn',
                    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
                }),
            },
            emit,
            now: () => new Date('2026-08-31T12:00:01.000Z'),
        } as never,
        reserve,
    };
}

const PARSE: ParsedLine = {
    foods: [{ name: 'flour' }],
    quantity: { kind: 'exact', value: 2 },
    unit: 'cup',
    preparation: null,
    needsReview: false,
} as never;

describe('createGatedMeasurementValidator — spend attribution (U14)', () => {
    it("attributes its spend to 'measurement-validator' — never the foodness dimension", async () => {
        const { deps, reserve, emit } = makeDeps();

        await createGatedMeasurementValidator(deps, 'amazon.nova-micro-v1:0').judge('2 cups flour', PARSE);

        // It really SPENDS (the old docstring's "spends nothing" was false) …
        expect(reserve).toHaveBeenCalledTimes(1);

        // … and the EMF CallSite dimension — the ONE decomposition of ADR-0024's pool — names it truthfully.
        const dimensions = emit.mock.calls.map((call) => call[0]?.dimensions?.CallSite).filter(Boolean);

        expect(dimensions.length).toBeGreaterThan(0);
        expect(new Set(dimensions)).toEqual(new Set(['measurement-validator']));
    });
});
