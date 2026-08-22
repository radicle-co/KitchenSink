/**
 * The spend arithmetic ADR-0024 §2 depends on, exercised as a TRUTH TABLE rather than against AWS.
 *
 * Every judgement the reserve-then-settle counter makes lives in `../spendArithmetic.js`, so this file is the
 * whole proof that the ceiling holds. Three properties are asserted adversarially, because each one is a way
 * the counter could report green while money leaves:
 *
 *  1. **The reservation is never smaller than the settlement.** ADR-0024's bias is deliberately one-way —
 *     "crashes over-count" is an accepted consequence, and it is only accepted because `worst >= actual` is
 *     true for EVERY usage within the caps, including the cache-token shapes that cost MORE per token than
 *     fresh input.
 *  2. **The period is captured, never recomputed.** A call spanning midnight UTC on the 1st must settle
 *     against the month it reserved against; ADR-0024 names the alternative as "a real bug".
 *  3. **An unpriced model cannot be reserved for.** The rate table is the authority for what may be called at
 *     all — an id it does not know produces no reservation, and the caller fails closed.
 */
import { describe, expect, it } from 'vitest';

import {
    BEDROCK_RATE_TABLE,
    DEFAULT_MONTHLY_CEILING_MICROS,
    MICROS_PER_DOLLAR,
    NOVA_MICRO_MODEL_ID,
    actualCostMicros,
    headroomMicros,
    periodKey,
    planReservation,
    rateFor,
    settleDeltaMicros,
    worstCaseMicros,
} from '../spendArithmetic.js';

const NOVA = rateFor(NOVA_MICRO_MODEL_ID);

if (NOVA === undefined) {
    throw new Error('the rate table must price the model the gate ships with');
}

describe('periodKey', () => {
    it.each([
        ['2026-08-21T12:00:00.000Z', '2026-08'],
        ['2026-08-31T23:59:59.999Z', '2026-08'],
        ['2026-09-01T00:00:00.000Z', '2026-09'],
        ['2026-01-01T00:00:00.000Z', '2026-01'],
        ['2026-12-31T23:59:59.999Z', '2026-12'],
    ])('maps %s to %s', (instant, expected) => {
        expect(periodKey(new Date(instant))).toBe(expected);
    });

    it('is computed in UTC, not in the host timezone', () => {
        // 2026-09-01T00:30Z is still 2026-08-31 in every western timezone. A local-time derivation would
        // return '2026-08' here on a runner in America/New_York and '2026-09' on one in UTC — i.e. which
        // period a reservation lands in would depend on where the Lambda's clock thinks it is. AWS bills in
        // UTC, so the counter and the audit budget must agree on where the boundary is.
        expect(periodKey(new Date('2026-09-01T00:30:00.000Z'))).toBe('2026-09');
        // ...and the mirror: 2026-08-31T23:30Z is already 2026-09-01 east of UTC.
        expect(periodKey(new Date('2026-08-31T23:30:00.000Z'))).toBe('2026-08');
    });

    it('zero-pads a single-digit month so keys sort lexicographically', () => {
        expect(periodKey(new Date('2026-03-15T00:00:00.000Z'))).toBe('2026-03');
    });
});

describe('rateFor', () => {
    it('prices Nova Micro at the rates ADR-0024 records as READ from the Pricing API', () => {
        // $0.035 / 1M input and $0.14 / 1M output, us-east-1, read 2026-08-20 — the only rate in this table
        // the ADR calls settled.
        expect(NOVA.inputMicrosPerMillionTokens).toBe(35_000);
        expect(NOVA.outputMicrosPerMillionTokens).toBe(140_000);
    });

    it('returns undefined for a model the table does not price', () => {
        expect(rateFor('anthropic.claude-opus-4-1-20250805-v1:0')).toBeUndefined();
        expect(rateFor('')).toBeUndefined();
    });

    it('carries an effective date and a price-provenance flag on every entry', () => {
        for (const [modelId, rate] of Object.entries(BEDROCK_RATE_TABLE)) {
            expect(rate.effectiveDate, `${modelId} must record when its price was read`).toMatch(
                /^\d{4}-\d{2}-\d{2}$/u,
            );
            expect(typeof rate.priceVerified, `${modelId} must state whether its price was READ or assumed`).toBe(
                'boolean',
            );
        }
    });

    it('does not price Gemini, which is not available on Bedrock at all (ADR-0024 §4)', () => {
        expect(Object.keys(BEDROCK_RATE_TABLE).some((id) => id.includes('gemini'))).toBe(false);
    });
});

describe('actualCostMicros', () => {
    it('reproduces the ADR-0024 steady-state figure for the measured workload', () => {
        // ~660 input / ~80 output, ~8,000 calls a month ⇒ ~$0.27.
        const perCall = actualCostMicros(NOVA, { inputTokens: 660, outputTokens: 80 });
        const monthlyDollars = (perCall * 8_000) / MICROS_PER_DOLLAR;

        expect(monthlyDollars).toBeGreaterThan(0.25);
        expect(monthlyDollars).toBeLessThan(0.35);
    });

    it('rounds UP, so an estimate is never below the real cost', () => {
        // One token at $0.035/1M is 0.035 micros — a fractional cost that must not floor to zero, or a
        // runaway made of small calls accumulates real spend against a counter that stays at 0.
        expect(actualCostMicros(NOVA, { inputTokens: 1, outputTokens: 0 })).toBe(1);
        expect(actualCostMicros(NOVA, { inputTokens: 0, outputTokens: 1 })).toBe(1);
    });

    it('is zero for a call that produced no tokens', () => {
        expect(actualCostMicros(NOVA, { inputTokens: 0, outputTokens: 0 })).toBe(0);
    });

    it('defaults both cache fields to zero — they are Required: No on the wire', () => {
        const withoutCacheFields = actualCostMicros(NOVA, { inputTokens: 660, outputTokens: 80 });
        const withExplicitZeroes = actualCostMicros(NOVA, {
            inputTokens: 660,
            outputTokens: 80,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
        });

        expect(withoutCacheFields).toBe(withExplicitZeroes);
    });

    it('costs cache-read and cache-write tokens at their OWN rates, not as fresh input', () => {
        const fresh = actualCostMicros(NOVA, { inputTokens: 100_000, outputTokens: 0 });
        const read = actualCostMicros(NOVA, { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 100_000 });
        const write = actualCostMicros(NOVA, { inputTokens: 0, outputTokens: 0, cacheWriteInputTokens: 100_000 });

        // A cached read is cheaper than fresh input; writing the cache is DEARER. Both differ from fresh,
        // which is the whole content of "at their own rates". ⚠️ This exercises the ARITHMETIC only — the
        // branch is unreachable in production (ADR-0024 §5), so nothing here claims to have seen a cache hit.
        expect(read).toBeLessThan(fresh);
        expect(write).toBeGreaterThan(fresh);
    });
});

describe('worstCaseMicros', () => {
    it('bounds every settleable cost within the caps, including the cache shapes', () => {
        const maxInput = 1_000;
        const maxOutput = 200;
        const worst = worstCaseMicros(NOVA, maxInput, maxOutput);

        const usages = [
            { inputTokens: maxInput, outputTokens: maxOutput },
            { inputTokens: 0, outputTokens: maxOutput },
            { inputTokens: maxInput, outputTokens: 0 },
            { inputTokens: 660, outputTokens: 80 },
            // ⛔ The shape that breaks a naive worst case: cache WRITES cost MORE per token than fresh input,
            // so a bound computed from the input rate alone would be exceeded by a call whose whole input
            // budget was a cache write — a reservation that is a lie in exactly the direction ADR-0024 says
            // it must never be.
            { inputTokens: 0, outputTokens: maxOutput, cacheWriteInputTokens: maxInput },
            { inputTokens: 0, outputTokens: maxOutput, cacheReadInputTokens: maxInput },
            { inputTokens: maxInput / 2, outputTokens: maxOutput, cacheWriteInputTokens: maxInput / 2 },
        ];

        for (const usage of usages) {
            expect(actualCostMicros(NOVA, usage), JSON.stringify(usage)).toBeLessThanOrEqual(worst);
        }
    });

    it('grows with both caps', () => {
        expect(worstCaseMicros(NOVA, 2_000, 200)).toBeGreaterThan(worstCaseMicros(NOVA, 1_000, 200));
        expect(worstCaseMicros(NOVA, 1_000, 400)).toBeGreaterThan(worstCaseMicros(NOVA, 1_000, 200));
    });

    it('is positive for any non-zero cap, so a reservation is never free', () => {
        expect(worstCaseMicros(NOVA, 1, 0)).toBeGreaterThan(0);
        expect(worstCaseMicros(NOVA, 0, 1)).toBeGreaterThan(0);
    });
});

describe('headroomMicros', () => {
    it('subtracts the worst case BEFORE the comparison, which is what bounds overshoot', () => {
        // ⛔ ADR-0024, Consequences: do NOT "simplify" this to the ceiling itself. The reserve statement
        // compares the value ALREADY in the row against this headroom, so a row sitting exactly at the
        // headroom may take one more worst-case charge and land exactly ON the ceiling — never above it.
        expect(headroomMicros(DEFAULT_MONTHLY_CEILING_MICROS, 500)).toBe(DEFAULT_MONTHLY_CEILING_MICROS - 500);
    });

    it('is negative when one call cannot fit under the ceiling at all', () => {
        // A ceiling smaller than a single call's worst case must deny EVERY call rather than admit one:
        // `reserved_micros <= headroom` is false even for a fresh row at 0 when the headroom is below 0.
        expect(headroomMicros(100, 500)).toBeLessThan(0);
    });

    it('admits exactly the ceiling at the boundary', () => {
        const worst = 250;

        // The last admissible reservation starts at the headroom and lands ON the ceiling.
        expect(headroomMicros(1_000, worst) + worst).toBe(1_000);
    });
});

describe('settleDeltaMicros', () => {
    it('refunds the unused reservation', () => {
        expect(settleDeltaMicros(36, 500)).toBe(-464);
    });

    it('refunds in FULL when nothing was billed', () => {
        // ThrottlingException, ServiceUnavailableException, a client timeout: no billed response, so the
        // whole reservation comes back. Without this a throttling episode consumes the ceiling at ZERO actual
        // spend and then closes the gate for the rest of the month.
        expect(settleDeltaMicros(0, 500)).toBe(-500);
    });

    it('is zero when the call cost exactly what was reserved', () => {
        expect(settleDeltaMicros(500, 500)).toBe(0);
    });

    it('CHARGES MORE when a response somehow exceeded the reservation', () => {
        // Deliberately unclamped. An over-run means the caps did not hold, and the counter must record the
        // money that actually left rather than quietly absorb it.
        expect(settleDeltaMicros(600, 500)).toBe(100);
    });
});

describe('planReservation', () => {
    const NOW = new Date('2026-08-31T23:59:59.000Z');

    const plan = (modelId: string): ReturnType<typeof planReservation> =>
        planReservation({
            modelId,
            ceilingMicros: DEFAULT_MONTHLY_CEILING_MICROS,
            maxInputTokens: 1_000,
            maxOutputTokens: 200,
            nowUtc: NOW,
        });

    it('captures the period, the rate and the worst case in ONE value', () => {
        const planned = plan(NOVA_MICRO_MODEL_ID);

        expect(planned.kind).toBe('priced');

        if (planned.kind !== 'priced') {
            return;
        }

        expect(planned.period).toBe('2026-08');
        expect(planned.worstMicros).toBe(worstCaseMicros(NOVA, 1_000, 200));
        expect(planned.headroomMicros).toBe(headroomMicros(DEFAULT_MONTHLY_CEILING_MICROS, planned.worstMicros));
        expect(planned.modelId).toBe(NOVA_MICRO_MODEL_ID);
    });

    it('is the ONLY source of the period a settlement uses', () => {
        // ⛔ The bug ADR-0024 names: a call beginning at 23:59:59 on the 31st and ending after midnight must
        // settle against the month it RESERVED against. Because the period is a field of the plan and settle
        // takes the plan, recomputing it at settle time is not expressible.
        const planned = plan(NOVA_MICRO_MODEL_ID);

        expect(planned.kind === 'priced' && planned.period).toBe('2026-08');
        expect(periodKey(new Date('2026-09-01T00:00:01.000Z'))).not.toBe('2026-08');
    });

    it('refuses to plan for a model the rate table does not price', () => {
        // Fail-closed by construction: with no rate there is no worst case, so there is nothing to reserve
        // and the call cannot be made. An unknown model id can only ever cost a DENIAL, never uncounted spend
        // — which is why an unverified price (Haiku's, per ADR-0024) is safe to carry and an ABSENT one is
        // safe to omit.
        expect(plan('meta.llama3-70b-instruct-v1:0')).toEqual({
            kind: 'unpriced',
            modelId: 'meta.llama3-70b-instruct-v1:0',
        });
    });

    it('seeds the ceiling at the $100 the owner set', () => {
        expect(DEFAULT_MONTHLY_CEILING_MICROS).toBe(100 * MICROS_PER_DOLLAR);
    });
});
