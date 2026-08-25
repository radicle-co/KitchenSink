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
    BEDROCK_MODEL_REGISTRY,
    CLAUDE_HAIKU_4_5_MODEL_ID,
    DEFAULT_MONTHLY_CEILING_MICROS,
    MICROS_PER_DOLLAR,
    NOVA_LITE_MODEL_ID,
    NOVA_MICRO_MODEL_ID,
    NOVA_PRO_MODEL_ID,
    actualCostMicros,
    headroomMicros,
    periodKey,
    planReservation,
    rateFor,
    registryEntryFor,
    residencyClearance,
    settleDeltaMicros,
    worstCaseMicros,
} from '../spendArithmetic.js';

const NOVA = rateFor(NOVA_MICRO_MODEL_ID);

if (NOVA === undefined) {
    throw new Error('the rate table must price the model the gate ships with');
}

/** Tokens per "per-1K tokens" quote — the denominator the AWS Price List API's Bedrock dimensions use. */
const TOKENS_PER_PRICE_LIST_UNIT = 1_000;

/**
 * The dollars-per-1,000-tokens figure a stored rate asserts, i.e. the number the price list itself prints.
 *
 * ⛔ The assertions below compare against the PUBLISHED quote rather than against a recomputation of the
 * stored integer, so a transcription slip (a dropped zero, a per-1M figure pasted into a per-1K field) fails
 * here instead of silently under-counting real money for a month.
 *
 * @param microsPerMillionTokens - The stored rate.
 * @returns USD per 1,000 tokens. Pure.
 */
function usdPerThousandTokens(microsPerMillionTokens: number): number {
    return (microsPerMillionTokens / MICROS_PER_DOLLAR) * (TOKENS_PER_PRICE_LIST_UNIT / 1_000_000);
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

    it.each([
        // ⛔ READ 2026-08-23 from the AWS Price List API — `aws pricing get-products --service-code
        // AmazonBedrock --filters Field=model,Value="Nova Lite" Field=regionCode,Value=us-east-1`, the
        // `On-demand Inference` feature, publicationDate 2026-08-20 / effectiveDate 2026-08-01. The same
        // query reproduces Nova Micro's committed $0.035 / $0.14 exactly, which is what makes it the primary
        // source ADR-0024 asks for rather than a second unverified entry.
        [NOVA_LITE_MODEL_ID, 'input', 'inputMicrosPerMillionTokens', 60_000, 0.00006],
        [NOVA_LITE_MODEL_ID, 'output', 'outputMicrosPerMillionTokens', 240_000, 0.00024],
        [NOVA_LITE_MODEL_ID, 'cache read', 'cacheReadMicrosPerMillionTokens', 15_000, 0.000015],
        [NOVA_LITE_MODEL_ID, 'cache write', 'cacheWriteMicrosPerMillionTokens', 0, 0],
        [NOVA_PRO_MODEL_ID, 'input', 'inputMicrosPerMillionTokens', 800_000, 0.0008],
        [NOVA_PRO_MODEL_ID, 'output', 'outputMicrosPerMillionTokens', 3_200_000, 0.0032],
        [NOVA_PRO_MODEL_ID, 'cache read', 'cacheReadMicrosPerMillionTokens', 200_000, 0.0002],
        [NOVA_PRO_MODEL_ID, 'cache write', 'cacheWriteMicrosPerMillionTokens', 0, 0],
    ] as const)('prices %s %s at the published $%s… rate', (modelId, _label, field, micros, usdPerThousand) => {
        const rate = rateFor(modelId);

        expect(rate).toBeDefined();
        expect(rate?.[field]).toBe(micros);
        expect(usdPerThousandTokens(rate?.[field] ?? Number.NaN)).toBeCloseTo(usdPerThousand, 10);
    });

    it('records both Nova family additions as READ, not assumed', () => {
        // ⛔ ADR-0024 already carries ONE entry whose price could not be read from a primary source. A second
        // would turn the flag into decoration. These two were read; if that ever stops being true the flag
        // must move, not the comment.
        for (const modelId of [NOVA_LITE_MODEL_ID, NOVA_PRO_MODEL_ID]) {
            expect(rateFor(modelId)?.priceVerified, modelId).toBe(true);
            expect(rateFor(modelId)?.effectiveDate, modelId).toBe('2026-08-23');
        }
    });

    it('keys the Nova family on the BARE model id, which is what on-demand inference accepts', () => {
        // Both report `inferenceTypesSupported: ["ON_DEMAND", "INFERENCE_PROFILE"]`, so unlike Claude Haiku
        // 4.5 they need no `us.` profile — and the rate table keys on the bare id either way, which is the
        // distinction the bake-off runner's INVOCATION_IDS map exists to keep.
        expect(NOVA_LITE_MODEL_ID).toBe('amazon.nova-lite-v1:0');
        expect(NOVA_PRO_MODEL_ID).toBe('amazon.nova-pro-v1:0');
    });

    it('returns undefined for a model the table does not price', () => {
        expect(rateFor('anthropic.claude-opus-4-1-20250805-v1:0')).toBeUndefined();
        expect(rateFor('')).toBeUndefined();
    });

    it('carries an effective date and a price-provenance flag on every entry', () => {
        for (const [modelId, { rate }] of Object.entries(BEDROCK_MODEL_REGISTRY)) {
            expect(rate.effectiveDate, `${modelId} must record when its price was read`).toMatch(
                /^\d{4}-\d{2}-\d{2}$/u,
            );
            expect(typeof rate.priceVerified, `${modelId} must state whether its price was READ or assumed`).toBe(
                'boolean',
            );
        }
    });

    it('does not price Gemini, which is not available on Bedrock at all (ADR-0024 §4)', () => {
        expect(Object.keys(BEDROCK_MODEL_REGISTRY).some((id) => id.includes('gemini'))).toBe(false);
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

    it('bounds every input-token SPLIT, for EVERY model in the table', () => {
        // ⛔ THE INVARIANT THE WHOLE CEILING RESTS ON, asserted over the table rather than over one model —
        // because the way this breaks is somebody ADDING an entry, not somebody editing `worstCaseMicros`.
        //
        // Bedrock's prompt-caching reference states the shape the split may take:
        //   "total input tokens = inputTokens + cacheReadInputTokens + cacheWriteInputTokens"
        // so layer 1's input cap bounds the SUM of the three, and an admissible usage is any partition of it.
        // A cache-write rate of ZERO (which the Nova family genuinely publishes) makes the dearest input rate
        // collapse onto the fresh rate — this is what proves that collapse is still a true bound and not a
        // reservation that can be exceeded.
        const maxInput = 1_000;
        const maxOutput = 200;

        for (const [modelId, { rate }] of Object.entries(BEDROCK_MODEL_REGISTRY)) {
            const worst = worstCaseMicros(rate, maxInput, maxOutput);

            for (let fresh = 0; fresh <= maxInput; fresh += 100) {
                for (let read = 0; read <= maxInput - fresh; read += 100) {
                    const usage = {
                        inputTokens: fresh,
                        outputTokens: maxOutput,
                        cacheReadInputTokens: read,
                        cacheWriteInputTokens: maxInput - fresh - read,
                    };

                    expect(actualCostMicros(rate, usage), `${modelId} ${JSON.stringify(usage)}`).toBeLessThanOrEqual(
                        worst,
                    );
                }
            }
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

    /**
     * ⛔ THE TWO IDS, CARRIED SEPARATELY OUT OF THE PLAN — the defect U35 exists to close.
     *
     * `modelId` is what the model IS: the rate-table key, the `verified_by` on a memo and the `model_id` on a
     * verdict. `invocationId` is what `Converse` is ADDRESSED with. They coincide for every on-demand model,
     * which is exactly why one string served both jobs undetected until a profile-only model was rostered.
     * Carrying the address on the PLAN — beside the captured period and the captured rate — is what makes a
     * mid-call SSM change unable to split the id that was priced from the id that was called.
     */
    it('addresses an on-demand model by the same id it records', () => {
        const planned = plan(NOVA_MICRO_MODEL_ID);

        expect(planned.kind === 'priced' && planned.invocationId).toBe(NOVA_MICRO_MODEL_ID);
        expect(planned.kind === 'priced' && planned.modelId).toBe(NOVA_MICRO_MODEL_ID);
    });

    it('addresses a profile-only model by its PROFILE id while still recording the bare id', () => {
        const planned = plan(CLAUDE_HAIKU_4_5_MODEL_ID);

        expect(planned.kind).toBe('priced');

        if (planned.kind !== 'priced') {
            return;
        }

        // ⛔ The bare id is refused by Bedrock for this model ("Invocation of model ID … with on-demand
        // throughput isn't supported"), and the profile id is not a rate-table key. Both facts at once.
        expect(planned.invocationId).toBe(`us.${CLAUDE_HAIKU_4_5_MODEL_ID}`);
        expect(planned.modelId).toBe(CLAUDE_HAIKU_4_5_MODEL_ID);
        expect(planned.rate).toBe(registryEntryFor(CLAUDE_HAIKU_4_5_MODEL_ID)?.rate);
    });

    it('prices EVERY registered model off its own registry key, never off its address', () => {
        // The mutation guard for the pair above: keying the table on the invocation id would make the
        // profile-addressed entry unpriced, and keying the address on the model id would re-introduce the
        // ValidationException. Asserted over the whole table so a new entry inherits it.
        for (const [modelId, entry] of Object.entries(BEDROCK_MODEL_REGISTRY)) {
            const planned = plan(modelId);

            expect(planned.kind, modelId).toBe('priced');
            expect(planned.kind === 'priced' && planned.modelId, modelId).toBe(modelId);
            expect(planned.kind === 'priced' && planned.invocationId, modelId).toBe(entry.invocation.invocationId);
        }
    });

    it('still refuses an id the registry does not know, before any address is derived', () => {
        expect(plan('meta.llama3-70b-instruct-v1:0')).toEqual({
            kind: 'unpriced',
            modelId: 'meta.llama3-70b-instruct-v1:0',
        });
    });
});

/**
 * THE TABLE IS THE MODEL REGISTRY — the invocation id, the reach, and the residency warrant.
 *
 * ⛔ The defect this closes: one string served as the rate-table key, the recorded model identity, AND the id
 * Bedrock is invoked with. For an on-demand model those coincide, so nothing ever caught it. Claude Haiku 4.5
 * is `INFERENCE_PROFILE`-only — the bare id fails with `ValidationException` and the `us.` profile id is not a
 * rate-table key — so pointing SSM at it failed every call in either direction.
 *
 * ⚠️ These assertions carry what the TYPE cannot. `ModelReach` is a discriminated union precisely so that an
 * on-demand entry cannot carry a region list and a cross-region entry cannot omit its read date; asserting
 * those would be asserting the compiler. What remains genuinely assertable is the PAIRING between the two
 * halves — an entry whose invocation id differs from its model id is exactly an entry that reaches beyond the
 * calling region — and that no shipped entry is residency-approved.
 */
describe('the model registry — invocation id and reach', () => {
    it('addresses an on-demand model by its own id, reaching only where it is called', () => {
        const entry = registryEntryFor(NOVA_MICRO_MODEL_ID);

        expect(entry?.invocation.invocationId).toBe(NOVA_MICRO_MODEL_ID);
        expect(entry?.invocation.reach.kind).toBe('deploy-region');
    });

    it('addresses Claude Haiku 4.5 through its inference profile, not its bare id', () => {
        const entry = registryEntryFor(CLAUDE_HAIKU_4_5_MODEL_ID);

        // ⛔ The bare id is REFUSED by Bedrock for this model: "Invocation of model ID … with on-demand
        // throughput isn't supported". Verified against the live account 2026-08-23.
        expect(entry?.invocation.invocationId).toBe(`us.${CLAUDE_HAIKU_4_5_MODEL_ID}`);
        expect(entry?.invocation.reach.kind).toBe('regions');

        const reach = entry?.invocation.reach;

        if (reach?.kind !== 'regions') {
            throw new Error('a profile-addressed entry must record the regions it reaches');
        }

        // Read from `aws bedrock get-inference-profile` in us-east-1. ⚠️ The destination set is a property of
        // the profile AND the source region, which is why the read date travels with it.
        expect([...reach.regions].sort()).toEqual(['us-east-1', 'us-east-2', 'us-west-2']);
        expect(reach.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    });

    /**
     * ⛔ THE PAIRING INVARIANT, and the one property the union cannot express. A profile id addresses a
     * ROUTING FAMILY rather than a model, so an entry addressed by something other than its own id is exactly
     * an entry whose calls can leave the calling region. If those two facts ever disagree, either a profile
     * reaches somewhere unrecorded, or an on-demand entry claims a reach it does not have.
     */
    it('addresses by a different id if and only if it reaches beyond the calling region', () => {
        for (const [modelId, entry] of Object.entries(BEDROCK_MODEL_REGISTRY)) {
            const addressedByItself = entry.invocation.invocationId === modelId;
            const staysHere = entry.invocation.reach.kind === 'deploy-region';

            expect(addressedByItself, `${modelId}: addressing and reach disagree`).toBe(staysHere);
        }
    });

    it('still prices every registered model, and still refuses an unregistered one', () => {
        for (const modelId of Object.keys(BEDROCK_MODEL_REGISTRY)) {
            expect(rateFor(modelId), modelId).toBeDefined();
        }

        expect(rateFor('amazon.nova-does-not-exist-v1:0')).toBeUndefined();
        expect(registryEntryFor('amazon.nova-does-not-exist-v1:0')).toBeUndefined();
    });
});

/**
 * RESIDENCY — the single predicate the runtime gate and the IAM derivation both call.
 *
 * ⛔ Two interpreters of one fact is the failure this exists to prevent. If `planReservation` decided residency
 * at runtime and the CDK stack decided it again at synth time, they would drift — and drift in the dangerous
 * direction, where IAM grants what the runtime refuses or the reverse. One exported predicate, two callers.
 *
 * ⚠️ AWS documents that with cross-region inference "your input prompts and output results may be stored in
 * the opt-in Regions for abuse detection purposes" — so this is about where user recipe text comes to REST,
 * not only where it is processed.
 */
describe('residencyClearance', () => {
    const novaEntry = registryEntryFor(NOVA_MICRO_MODEL_ID);
    const haikuEntry = registryEntryFor(CLAUDE_HAIKU_4_5_MODEL_ID);

    if (novaEntry === undefined || haikuEntry === undefined) {
        throw new Error('the registry must carry both roster models');
    }

    it('clears an on-demand entry wherever it is deployed', () => {
        // The sentinel arm means "wherever this invokes", so it is in-region BY CONSTRUCTION — including in a
        // region this repo has never deployed to. That is what keeps a region literal out of recipe-core.
        expect(residencyClearance(novaEntry, 'us-east-1')).toBe('in-deploy-region');
        expect(residencyClearance(novaEntry, 'eu-west-1')).toBe('in-deploy-region');
    });

    it('refuses a profile that reaches beyond the deploy region without a warrant', () => {
        expect(residencyClearance(haikuEntry, 'us-east-1')).toBe('unapproved');
    });

    it('clears a profile whose recorded reach does not actually leave the deploy region', () => {
        const homebound = {
            ...haikuEntry,
            invocation: {
                ...haikuEntry.invocation,
                reach: { kind: 'regions', regions: ['us-east-1'], readOn: '2026-08-23' },
            },
        } as const;

        expect(residencyClearance(homebound, 'us-east-1')).toBe('in-deploy-region');
    });

    it('clears a cross-region profile once it carries an approval', () => {
        const approved = {
            ...haikuEntry,
            invocation: {
                ...haikuEntry.invocation,
                reach: {
                    kind: 'regions',
                    regions: ['us-east-1', 'us-east-2', 'us-west-2'],
                    readOn: '2026-08-23',
                    residencyApproval: { approvedOn: '2026-09-01', reference: 'ADR-0024 §9' },
                },
            },
        } as const;

        expect(residencyClearance(approved, 'us-east-1')).toBe('approved');
    });

    /**
     * ⛔ R9 — NO SHIPPED ENTRY IS APPROVED, and this is the assertion that makes approving one a deliberate
     * act. Flipping a marker fails this test until someone edits it in the same commit, so the diff shows both
     * the approval and its warrant together. The residency question is open (016); nothing here closes it.
     */
    it('ships no residency-approved entry', () => {
        for (const [modelId, entry] of Object.entries(BEDROCK_MODEL_REGISTRY)) {
            const { reach } = entry.invocation;
            const approval = reach.kind === 'regions' ? reach.residencyApproval : undefined;

            expect(approval, `${modelId} ships residency-approved — was that deliberate?`).toBeUndefined();
        }
    });
});
