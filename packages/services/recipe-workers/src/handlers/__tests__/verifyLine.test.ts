/**
 * The verification gate handler — reserve → call → settle → record, and every way it can go wrong.
 *
 * ⛔ THE TWO OUTCOMES THIS FILE EXISTS TO KEEP APART, because conflating them is the defect ADR-0024 spends a
 * section on:
 *
 *  - **TRANSIENT** (a ceiling denial, an unreadable counter, unreadable settings, a provider outage) — the
 *    message returns to the queue and retries under layer 0's `maxReceiveCount` + DLQ. It does NOT record a
 *    verdict. "An exhausted ceiling drains to the DLQ, where it is visible as queue depth instead of as
 *    silently degraded recipes."
 *  - **TERMINAL** (a verdict was read, or the model answered unusably) — a row is written, the message is
 *    acknowledged, and no money is spent again.
 *
 * Recording a billing denial as a withheld line would manufacture the wrong-DISAGREE outcome this unit ranks
 * as the unacceptable one, in bulk, for reasons that have nothing to do with the line's quality.
 *
 * ⛔ AND THE INVARIANT UNDERNEATH ALL OF IT: **no path reaches a `verified` band except a well-formed verdict
 * from a response the model finished normally.** Every error branch below is asserted to record either
 * nothing or `inconclusive` — never an agreement.
 */
import { describe, expect, it, vi } from 'vitest';

import { BedrockClientError, BedrockThrottledError } from '@kitchensink/bedrock-client';
import {
    BEDROCK_MODEL_REGISTRY,
    NOVA_2_LITE_MODEL_ID,
    inputTokenBound,
    residencyClearance,
    worstCaseMicros,
    type ModelRate,
} from '@kitchensink/recipe-core/spend/spend-arithmetic';
import { VERIFICATION_MAX_OUTPUT_TOKENS } from '@kitchensink/recipe-core/resolution/verification-prompt';

import {
    INPUT_BOUND_EXCEEDED_METRIC_NAME,
    RESIDENCY_REFUSED_METRIC_NAME,
    SPEND_METRIC_NAMESPACE,
} from '../../common/spendMetrics.js';
import type { EmfMetric } from '../../common/metrics.js';
import { processVerification, type VerificationDeps } from '../verifyLine.js';

const MESSAGE = {
    recipeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    sourceLine: '2 cups all-purpose flour',
    // The memo tier's key grain (migration 0041) — present on the fixture because the dominant path
    // carries it, and CONTAINED in the source line above, which the memo write requires.
    ingredientPhrase: 'all-purpose flour',
    foodId: '01JFOOD000000000000000000',
    candidateFoodName: 'Flour, wheat, all-purpose',
    quantityLow: 2,
    quantityHigh: null,
    unit: 'cup',
    evidenceKind: 'ranked' as const,
    shortlist: [{ foodId: '01JFOOD000000000000000000', score: 0.9 }],
    requestedAt: '2026-08-21T10:00:00.000Z',
};

const SETTINGS = { ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' };

const ANSWERED = {
    kind: 'answered' as const,
    text: '{"verdict":"agree","certainty":"high","reason":"matches"}',
    stopReason: 'end_turn',
    usage: { inputTokens: 660, outputTokens: 42, totalTokens: 702 },
};

/** The region the gate deploys in — the only input to the residency half of the reservation. */
const DEPLOY_REGION = 'us-east-1';

/** Deps with everything healthy, and spies on every side effect. */
function deps(overrides: Partial<VerificationDeps> = {}): VerificationDeps & {
    readonly spies: {
        reserve: ReturnType<typeof vi.fn>;
        settle: ReturnType<typeof vi.fn>;
        converse: ReturnType<typeof vi.fn>;
        recordVerdict: ReturnType<typeof vi.fn>;
        rememberAgreement: ReturnType<typeof vi.fn>;
        bandRecord: ReturnType<typeof vi.fn>;
        bandAuthority: ReturnType<typeof vi.fn>;
        emit: ReturnType<typeof vi.fn>;
    };
} {
    const spies = {
        reserve: vi.fn().mockResolvedValue({ kind: 'reserved', reservedMicros: 116 }),
        settle: vi.fn().mockResolvedValue(undefined),
        converse: vi.fn().mockResolvedValue(ANSWERED),
        recordVerdict: vi.fn().mockResolvedValue(undefined),
        rememberAgreement: vi.fn().mockResolvedValue(undefined),
        bandRecord: vi.fn().mockResolvedValue(undefined),
        bandAuthority: vi.fn().mockResolvedValue(undefined),
        emit: vi.fn(),
    };

    return {
        spies,
        stage: 'prod',
        deployRegion: DEPLOY_REGION,
        settings: { resolve: vi.fn().mockResolvedValue(SETTINGS) },
        ledger: { reserve: spies.reserve, settle: spies.settle },
        bedrock: { converse: spies.converse },
        store: { recordVerdict: spies.recordVerdict, rememberAgreement: spies.rememberAgreement },
        bands: { record: spies.bandRecord, authorityForFood: spies.bandAuthority },
        emit: spies.emit,
        now: () => new Date('2026-08-21T10:00:01.000Z'),
        ...overrides,
    } as VerificationDeps & { spies: typeof spies };
}

/** The band a run recorded, or `undefined` when it recorded nothing. */
const bandRecorded = (spies: { recordVerdict: ReturnType<typeof vi.fn> }): string | undefined =>
    spies.recordVerdict.mock.calls[0]?.[0]?.band;

describe('the input-token bound the reservation is priced from (ADR-0024 layer 1)', () => {
    it('prices the reservation from the prompt IN HAND — bytes plus the template allowance, never a static cap', async () => {
        // ⛔ The plan used to be priced from `VERIFICATION_MAX_INPUT_TOKENS = 2_000`, equal to the code-point
        // cap on the claim "no tokenizer emits more than one token per code point" — false for byte-fallback
        // BPE. The bound is now derived from the two turns the transport is actually handed, which is both
        // honest (bytes) and tighter for the ordinary ASCII prompt (~1.3 KB, not 2,000 tokens).
        const d = deps({ stage: 'prod' });
        await processVerification(d, MESSAGE);

        const request = d.spies.converse.mock.calls[0]?.[0] as { systemPrompt: string; userMessage: string };
        const plan = d.spies.reserve.mock.calls[0]?.[0] as { worstMicros: number; rate: ModelRate };

        expect(plan.worstMicros).toBe(
            worstCaseMicros(
                plan.rate,
                inputTokenBound([request.systemPrompt, request.userMessage]),
                VERIFICATION_MAX_OUTPUT_TOKENS,
            ),
        );
    });

    it('emits the over-bound DETECTOR, attributed, when the billed input beats the bound it reserved with', async () => {
        // The counter records an overshoot silently (the settle delta is unclamped); this metric is what makes
        // a tokenizer that beats bytes VISIBLE. 9,000 billed tokens is beyond any bound a ~1 KB prompt yields.
        const d = deps({ stage: 'prod' });
        d.spies.converse.mockResolvedValue({
            ...ANSWERED,
            usage: { inputTokens: 9_000, outputTokens: 42, totalTokens: 9_042 },
        });
        await processVerification(d, MESSAGE);

        const request = d.spies.converse.mock.calls[0]?.[0] as { systemPrompt: string; userMessage: string };
        const bound = inputTokenBound([request.systemPrompt, request.userMessage]);
        const emitted = d.spies.emit.mock.calls
            .map((call) => call[0] as { name: string; value: number; dimensions?: Record<string, string> })
            .find((metric) => metric.name === INPUT_BOUND_EXCEEDED_METRIC_NAME);

        expect(emitted?.value).toBe(9_000 - bound);
        expect(emitted?.dimensions).toEqual({ CallSite: 'verification-gate' });
    });

    it('stays silent when the billed input fits the bound', async () => {
        const d = deps({ stage: 'prod' });
        await processVerification(d, MESSAGE);

        const names = d.spies.emit.mock.calls.map((call) => (call[0] as { name: string }).name);

        expect(names).not.toContain(INPUT_BOUND_EXCEEDED_METRIC_NAME);
    });

    it('emits the detector in an UNGATED stage too — the ~$88/month exposure needs the same eyes', async () => {
        const d = deps({ stage: 'sandbox' });
        d.spies.converse.mockResolvedValue({
            ...ANSWERED,
            usage: { inputTokens: 9_000, outputTokens: 42, totalTokens: 9_042 },
        });
        await processVerification(d, MESSAGE);

        const names = d.spies.emit.mock.calls.map((call) => (call[0] as { name: string }).name);

        expect(names).toContain(INPUT_BOUND_EXCEEDED_METRIC_NAME);
    });
});

describe('the happy path', () => {
    it('reserves, calls, settles and records — in that order', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        const order = [
            d.spies.reserve.mock.invocationCallOrder[0],
            d.spies.converse.mock.invocationCallOrder[0],
            d.spies.settle.mock.invocationCallOrder[0],
            d.spies.recordVerdict.mock.invocationCallOrder[0],
        ];

        // ⛔ SETTLE BEFORE RECORD. A failure after the settle must not fail the handler — SQS would redeliver
        // and the message would reserve and call AGAIN, double-spending for one line.
        expect(order).toEqual([...order].sort((left, right) => (left ?? 0) - (right ?? 0)));
    });

    it('settles with the ACTUAL cost, not the reservation', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        // 660 input at $0.035/1M + 42 output at $0.14/1M, rounded up: 24 + 6 = 30 micros.
        expect(d.spies.settle).toHaveBeenCalledWith(expect.objectContaining({ actualMicros: 30 }));
    });

    it('settles against the period captured at RESERVE', async () => {
        const d = deps({ now: () => new Date('2026-08-31T23:59:59.000Z') });
        await processVerification(d, MESSAGE);

        // The plan is built once and handed to both calls, so a call spanning midnight cannot settle against
        // September. See ADR-0024 §2 — recomputing the key here is named as "a real bug".
        expect(d.spies.settle.mock.calls[0]?.[0]?.plan?.period).toBe('2026-08');
    });

    it('records a verified band and remembers the agreement', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        expect(bandRecorded(d.spies)).toBe('verified');
        expect(d.spies.rememberAgreement).toHaveBeenCalledTimes(1);
    });

    it('stores the model identifier on the verdict (R21)', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        expect(d.spies.recordVerdict.mock.calls[0]?.[0]?.modelId).toBe('amazon.nova-micro-v1:0');
    });

    /**
     * Per-aspect verdicts (owner ruling 2026-08-31, U15 report "Owner rulings" §4): the joint verdict
     * conflates identity with quantity, so the model's per-aspect answers ride the verdict row — U13's
     * re-pick surface reads them, acting only on a high-certainty IDENTITY disagreement.
     */
    it('stores the per-aspect verdicts on the row when the model itemized', async () => {
        const d = deps({
            bedrock: {
                converse: vi.fn().mockResolvedValue({
                    ...ANSWERED,
                    text: '{"verdict":"disagree","certainty":"high","aspects":{"identity":"agree","quantity":"disagree"}}',
                }),
            },
        });
        await processVerification(d, MESSAGE);

        expect(d.spies.recordVerdict.mock.calls[0]?.[0]).toMatchObject({
            verdict: 'disagree',
            identityVerdict: 'agree',
            quantityVerdict: 'disagree',
        });
    });

    it('stores NO per-aspect verdicts for an answer without them — the pre-ruling shape', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        const row = d.spies.recordVerdict.mock.calls[0]?.[0];

        expect(row?.identityVerdict).toBeUndefined();
        expect(row?.quantityVerdict).toBeUndefined();
    });

    it('emits the dollar metric', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        expect(d.spies.emit).toHaveBeenCalled();
    });
});

/**
 * ⛔ THE ID BEDROCK IS CALLED WITH IS NOT THE ID WE RECORD — the defect U35 closes.
 *
 * One string used to serve three jobs: the rate-table key, the recorded model identity (`model_id` on a
 * verdict, `verified_by` on a memo), and the id `Converse` is addressed with. For every on-demand model those
 * coincide, which is why nothing caught it. Claude Haiku 4.5 is `INFERENCE_PROFILE`-only: its bare id is
 * refused with `ValidationException` and its `us.` profile id is not a rate-table key, so a single SSM edit
 * pointing at it failed EVERY call in both directions at once.
 *
 * ⚠️ The recorded halves are the mutation guard. Memos are upserted per phrase, so a `verified_by` that drifted
 * to the profile spelling would produce a silent MIX of two identities for one model rather than an error —
 * a test suite that still passes with the recorded id swapped for the invocation id is not covering this.
 *
 * ⛔ COVERAGE MOVED, AND SOME OF IT WAS LOST — stated rather than hidden (residency wiring, ADR-0024 §4b).
 * Four assertions here drove Claude Haiku 4.5 THROUGH the handler, because it was the one shipped model whose
 * address differs from its identity. Residency now refuses it before any address is derived, so those four
 * cannot run: every model this handler can still call is on-demand, where the two ids COINCIDE, which is
 * precisely the condition that let U35's defect hide in the first place. What replaces them:
 *
 *  - the DIVERGENCE is asserted one layer down, on `planReservation`, which carries `invocationId` out of the
 *    registry entry rather than re-deriving it from `modelId` (`spendArithmetic.test.ts`);
 *  - the handler half asserted here is now that it hands `converse` the plan's ADDRESS and records the plan's
 *    IDENTITY, which is still falsifiable for an on-demand model if the handler ever stopped reading the plan
 *    at all;
 *  - the profile path itself is asserted as REFUSED below.
 *
 * ⚠️ The residual gap is real: no shipped model can currently distinguish `plan.invocationId` from
 * `plan.modelId` at this call site. Rostering a residency-CLEARED profile — or 016 warranting one — restores
 * it, and the four deleted assertions should come back with it.
 */
describe('the invocation id, and the identity it is not', () => {
    /** The profile-only entry the shipped registry already carries — and which residency now refuses. */
    const PROFILE_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';
    const PROFILE_INVOCATION_ID = `us.${PROFILE_MODEL_ID}`;

    /** Deps whose SSM settings name a model, so only the registry decides how it is addressed. */
    const depsForModel = (modelId: string): ReturnType<typeof deps> =>
        deps({ settings: { resolve: vi.fn().mockResolvedValue({ ...SETTINGS, modelId }) } });

    it('invokes an on-demand model with the same id it records — Nova is unchanged', async () => {
        const d = depsForModel('amazon.nova-micro-v1:0');
        await processVerification(d, MESSAGE);

        expect(d.spies.converse.mock.calls[0]?.[0]?.invocationId).toBe('amazon.nova-micro-v1:0');
        expect(d.spies.recordVerdict.mock.calls[0]?.[0]?.modelId).toBe('amazon.nova-micro-v1:0');
        expect(d.spies.rememberAgreement.mock.calls[0]?.[0]?.modelId).toBe('amazon.nova-micro-v1:0');
    });

    it('addresses and records from the REGISTRY entry, for every model residency clears', async () => {
        // Derived from the table rather than restated, so a new rostered model inherits the assertion. The
        // two halves are equal today for every callable entry — see this block's docstring for why that is
        // the residual gap and not a claim that the property is proved here.
        for (const [modelId, entry] of Object.entries(BEDROCK_MODEL_REGISTRY)) {
            if (residencyClearance(entry, DEPLOY_REGION) === 'unapproved') {
                continue;
            }

            const d = depsForModel(modelId);
            await processVerification(d, MESSAGE);

            expect(d.spies.converse.mock.calls[0]?.[0]?.invocationId, modelId).toBe(entry.invocation.invocationId);
            expect(d.spies.recordVerdict.mock.calls[0]?.[0]?.modelId, modelId).toBe(modelId);
            expect(d.spies.rememberAgreement.mock.calls[0]?.[0]?.modelId, modelId).toBe(modelId);
        }
    });

    it('still fails closed for an unregistered model, before any address is derived', async () => {
        const d = depsForModel(PROFILE_INVOCATION_ID);

        // ⛔ The profile id is an ADDRESS, never a key. Feeding it back in as a model id must be refused, or
        // the registry would have two spellings for one model and the memos would carry both.
        await expect(processVerification(d, MESSAGE)).rejects.toThrow(/not priced/u);
        expect(d.spies.converse).not.toHaveBeenCalled();
    });

    /**
     * RESIDENCY (ADR-0024 §4b) — the refusal, and the three things that make it different from every other
     * refusal this handler issues.
     *
     * ⛔ IT MUST NOT THROW. An unpriced model, a ceiling denial and an unreadable counter are all TRANSIENT
     * here: they throw, the message returns to the queue, and it drains to the DLQ after `maxReceiveCount`
     * attempts. A residency refusal can never succeed on retry — no amount of redelivery makes 016 record a
     * warrant — so throwing would spend twenty deliveries reaching the same answer and would report a
     * standing product decision as queue depth.
     *
     * ⛔ IT MUST RECORD NO VERDICT (ADR-0026 §3, "absence is not dissent"). Nothing about this line was
     * judged; writing a verdict would manufacture the wrong-DISAGREE outcome U11 ranks as unacceptable, in
     * bulk, for a reason that has nothing to do with any recipe. The line publishes UNVERIFIED — which is
     * exactly today's behaviour, so the refusal is no worse than not having shipped the gate.
     *
     * ⚠️ It is the `decision.kind === 'reject'` shape this file already uses for a deterministic condition:
     * terminal, logged, silent. Not a new vocabulary.
     */
    it('REFUSES a residency-unapproved model without calling, reserving, or recording a verdict', async () => {
        const d = depsForModel(PROFILE_MODEL_ID);

        await expect(processVerification(d, MESSAGE)).resolves.toBeUndefined();

        expect(d.spies.converse).not.toHaveBeenCalled();
        expect(d.spies.reserve).not.toHaveBeenCalled();
        expect(d.spies.recordVerdict).not.toHaveBeenCalled();
        expect(d.spies.rememberAgreement).not.toHaveBeenCalled();
        expect(d.spies.bandRecord).not.toHaveBeenCalled();
    });

    /**
     * ⛔ THE REFUSAL MUST BE VISIBLE, and a log line is not visibility for this package.
     *
     * Every other way this handler can go quiet leaves a trace an alarm already watches: a throw becomes DLQ
     * depth, a settle failure becomes `VerificationSettleFailures`. This branch acknowledges the message,
     * writes no row, and reserves nothing — so `VerificationSpendMicros` merely goes flat, which no alarm
     * distinguishes from a quiet hour.
     *
     * ⚠️ AND THE LOG IS NOT AN ALERT HERE. `recipe-workers` has no `SubscriptionFilter` and no metric filter:
     * the only log drain in this repository is `WebhooksStack`'s, whose three targets are the webhook, the API
     * and the identity ECS service. So `logger.error` lands in CloudWatch Logs with nothing subscribed to it.
     * This metric is the alert, and it carries `CallSite` for the same reason
     * `VerificationInputBoundExceeded` does: WHICH leg went dark is the whole diagnostic.
     */
    it('EMITS the refusal so a dark gate is visible — the log alone reaches nothing', async () => {
        const d = depsForModel(PROFILE_MODEL_ID);
        await processVerification(d, MESSAGE);

        const emitted = d.spies.emit.mock.calls
            .map((call) => call[0] as EmfMetric)
            .find((metric) => metric?.name === RESIDENCY_REFUSED_METRIC_NAME);

        expect(emitted).toBeDefined();
        expect(emitted?.namespace).toBe(SPEND_METRIC_NAMESPACE);
        expect(emitted?.value).toBe(1);
        expect(emitted?.dimensions).toEqual({ CallSite: 'verification-gate' });
    });

    it('stays silent on that metric when the model IS cleared', async () => {
        // The non-vacuity floor: an emitter that fired unconditionally would satisfy the test above.
        const d = depsForModel('amazon.nova-micro-v1:0');
        await processVerification(d, MESSAGE);

        expect(d.spies.emit.mock.calls.map((call) => (call[0] as EmfMetric)?.name)).not.toContain(
            RESIDENCY_REFUSED_METRIC_NAME,
        );
    });

    it('refuses the shipped PARSE model too — it is the same table, judged the same way', async () => {
        // Nova 2 Lite was selected on gold-set accuracy and is `INFERENCE_PROFILE`-only over three regions.
        // Pointing the gate's SSM parameter at it is the mid-incident change this refusal has to survive.
        const d = depsForModel(NOVA_2_LITE_MODEL_ID);

        await expect(processVerification(d, MESSAGE)).resolves.toBeUndefined();
        expect(d.spies.converse).not.toHaveBeenCalled();
    });
});

/**
 * WHO SPENT IT (U36 / KTD-17) — the ceiling is ONE pool, and that is exactly why the spend must be attributed.
 *
 * The owner's 2026-08-24 ruling makes $100/month a single global pool shared by this gate, the ingredient
 * parse leg and 017's capture tiers, first come first served. ⛔ Not capping per consumer makes attribution
 * MORE important, not less: when the pool empties the first question is "who burned it", and a dimensionless
 * `VerificationSpendMicros` cannot answer it.
 *
 * ⛔ ATTRIBUTION IS NOT PARTITIONING. The dimension rides on the METRIC only. Nothing about the reservation —
 * the ceiling, the worst case, the headroom, the counter row — may learn about the call site, or the single
 * pool would silently become several.
 */
describe('the call site the spend is attributed to', () => {
    /** The spend emissions of one run, in order. */
    const spendEmissions = (d: ReturnType<typeof deps>): Record<string, unknown>[] =>
        d.spies.emit.mock.calls
            .map((call) => call[0] as Record<string, unknown>)
            .filter((metric) => metric['name'] === 'VerificationSpendMicros');

    it('attributes the gated emission to this gate', async () => {
        const d = deps({ stage: 'prod' });
        await processVerification(d, MESSAGE);

        expect(spendEmissions(d)).toHaveLength(1);
        expect(spendEmissions(d)[0]?.['dimensions']).toEqual({ CallSite: 'verification-gate' });
    });

    it('attributes the UNGATED emission too — the ~$88/month/stage exposure needs a name as well', async () => {
        // ADR-0024 §3 leaves sandbox and every pr-{N} ungated, bounded only by layer 2. That spend is real and
        // is the only exposure the counter never sees; an unattributed metric there is the co-mingling defect.
        const d = deps({ stage: 'sandbox' });
        await processVerification(d, MESSAGE);

        expect(spendEmissions(d)).toHaveLength(1);
        expect(spendEmissions(d)[0]?.['dimensions']).toEqual({ CallSite: 'verification-gate' });
    });

    it('leaves the ceiling arithmetic UNTOUCHED — one pool, keyed on the period alone', async () => {
        const d = deps({ stage: 'prod' });
        await processVerification(d, MESSAGE);

        const plan = d.spies.reserve.mock.calls[0]?.[0] as Record<string, unknown>;

        // ⛔ THE ANTI-PARTITION ASSERTION. A call site reaching the plan would key the counter row — or the
        // headroom — per consumer, turning one $100 pool into N pools of unstated size. The plan carries the
        // period, the model, the worst case, the headroom and the rate, and nothing about who asked.
        expect(Object.keys(plan).sort()).toEqual([
            'headroomMicros',
            'invocationId',
            'kind',
            'modelId',
            'period',
            'rate',
            'worstMicros',
        ]);
        expect(d.spies.settle.mock.calls[0]?.[0]).toEqual({ plan, actualMicros: 30 });
    });

    it('reports the same reserved total it always did — the dimension changes no number', async () => {
        const d = deps({ stage: 'prod' });
        await processVerification(d, MESSAGE);

        // `reserve` resolves `{ reservedMicros: 116 }`; the metric reports the period's running total, which
        // is what the half-ceiling alarm compares. A dimension that altered the VALUE would be a new metric.
        expect(spendEmissions(d)[0]?.['value']).toBe(116);
    });
});

describe('the aspects it asks about', () => {
    it('asks about identity AND quantity for a ranked shortlist with a narrow margin', async () => {
        const d = deps();
        await processVerification(d, {
            ...MESSAGE,
            shortlist: [
                { foodId: 'a', score: 0.9 },
                { foodId: 'b', score: 0.89 },
            ],
        });

        expect(d.spies.converse.mock.calls[0]?.[0]?.userMessage).toMatch(/identity/u);
    });

    it('asks about QUANTITY ONLY for a curated exact hit', async () => {
        const d = deps();
        await processVerification(d, { ...MESSAGE, evidenceKind: 'curated-exact', shortlist: [] });

        const user = d.spies.converse.mock.calls[0]?.[0]?.userMessage ?? '';

        expect(user).toMatch(/quantity/u);
        expect(user).not.toMatch(/identity/u);
    });

    it('RE-RUNS the policy rather than trusting the producer', async () => {
        const d = deps();

        // A producer that (buggily, or from an older release) claims identity is settled must not be able to
        // make the worker skip it. The message carries inputs; the conclusion is re-derived here.
        await processVerification(d, {
            ...MESSAGE,
            evidenceKind: 'ranked',
            shortlist: [{ foodId: 'a', score: 1 }],
            ...({ aspects: ['quantity'] } as Record<string, unknown>),
        });

        expect(d.spies.converse.mock.calls[0]?.[0]?.userMessage).toMatch(/identity/u);
    });

    it('does NOT remember an agreement whose identity was never checked', async () => {
        // ⛔ `ingredient_resolution_memos` records that a MODEL agreed this phrase means this food. An `agree`
        // from a run that only asked about quantity says nothing about identity, so writing a memo from it
        // would launder a curated human assertion — or a lexical guess — into a machine verification that
        // never happened, and that memo then answers for every future cook.
        const d = deps();
        await processVerification(d, { ...MESSAGE, evidenceKind: 'curated-exact', shortlist: [] });

        expect(bandRecorded(d.spies)).toBe('verified');
        expect(d.spies.rememberAgreement).not.toHaveBeenCalled();
    });
});

/**
 * The memo grain (migration 0041, owner ruling 2026-08-31, U15 report "Owner rulings" §3).
 *
 * The memo tier's read side queries `normalizedIngredientKey(name)` — the phrase a picker types — so the
 * memo must be keyed on the PHRASE the parse lifted out of the line, never on the whole line: U15 measured
 * 289 line-keyed memos of which not one could ever serve any query. And because
 * `ingredient_resolution_memos` answers for EVERY user while the model's agreement is about the LINE, a
 * phrase the producer asserts must actually appear in the judged line, or a hostile producer could bind an
 * arbitrary key to a legitimately-verified food.
 */
describe('the memo is keyed on the parsed phrase, and only a phrase the model actually judged', () => {
    it('remembers the agreement under the PHRASE, not the line', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        expect(d.spies.rememberAgreement).toHaveBeenCalledWith(
            expect.objectContaining({ phrase: 'all-purpose flour', foodId: MESSAGE.foodId }),
        );
    });

    it('writes NO memo when the message carries no phrase — never one at the dead line grain', async () => {
        // An older producer, or a line whose parse produced no phrase. The verdict still lands; only the
        // shared cache abstains, exactly as it does for a private food.
        const d = deps();
        const { ingredientPhrase: _omitted, ...withoutPhrase } = MESSAGE;
        await processVerification(d, withoutPhrase);

        expect(bandRecorded(d.spies)).toBe('verified');
        expect(d.spies.rememberAgreement).not.toHaveBeenCalled();
    });

    it('⛔ REFUSES a phrase that does not appear in the judged line — the cross-user poisoning guard', async () => {
        const d = deps();
        await processVerification(d, { ...MESSAGE, ingredientPhrase: 'granulated sugar' });

        expect(bandRecorded(d.spies)).toBe('verified');
        expect(d.spies.rememberAgreement).not.toHaveBeenCalled();
    });

    it('containment is judged on normalized tokens, not raw substrings', async () => {
        // Case and pluralization differences between the phrase and the line must not defeat a legitimate
        // memo — both sides go through the same normalization the memo key itself uses.
        const d = deps();
        await processVerification(d, { ...MESSAGE, ingredientPhrase: 'All-Purpose FLOUR' });

        expect(d.spies.rememberAgreement).toHaveBeenCalledTimes(1);
    });
});

describe('outcomes that must NOT spend', () => {
    it('does not call the provider when the ceiling denies the reservation', async () => {
        const d = deps();
        d.spies.reserve.mockResolvedValue({ kind: 'denied', period: '2026-08' });

        await expect(processVerification(d, MESSAGE)).rejects.toThrow();
        expect(d.spies.converse).not.toHaveBeenCalled();
    });

    it('does not RESOLVE the line on a ceiling denial — it retries', async () => {
        // ⛔ The distinction ADR-0024 calls load-bearing. A denial is a billing outcome, not a judgement about
        // the line; recording one as a withheld line invites the user to correct something we declined to
        // check.
        const d = deps();
        d.spies.reserve.mockResolvedValue({ kind: 'denied', period: '2026-08' });

        await processVerification(d, MESSAGE).catch(() => undefined);

        expect(d.spies.recordVerdict).not.toHaveBeenCalled();
    });

    it('does not call the provider when the counter is unreadable', async () => {
        const d = deps();
        d.spies.reserve.mockRejectedValue(new Error('connection terminated'));

        await expect(processVerification(d, MESSAGE)).rejects.toThrow();
        expect(d.spies.converse).not.toHaveBeenCalled();
        expect(d.spies.recordVerdict).not.toHaveBeenCalled();
    });

    it('does not call the provider when the settings are unreadable', async () => {
        const d = deps({ settings: { resolve: vi.fn().mockRejectedValue(new Error('ParameterNotFound')) } });

        await expect(processVerification(d, MESSAGE)).rejects.toThrow();
        expect(d.spies.converse).not.toHaveBeenCalled();
    });

    it('does not call the provider for a model the rate table does not price', async () => {
        // ⛔ Membership of the rate table IS authorization. Without a rate there is no worst case, so there is
        // nothing to reserve — an unpriced model can only ever cost a denial, never uncounted spend.
        const d = deps({ settings: { resolve: vi.fn().mockResolvedValue({ ...SETTINGS, modelId: 'meta.llama' }) } });

        await expect(processVerification(d, MESSAGE)).rejects.toThrow();
        expect(d.spies.converse).not.toHaveBeenCalled();
    });
});

describe('the prod-only ruling', () => {
    it('reserves in prod', async () => {
        const d = deps({ stage: 'prod' });
        await processVerification(d, MESSAGE);

        expect(d.spies.reserve).toHaveBeenCalledTimes(1);
    });

    it.each([['sandbox'], ['pr-73']])('does NOT reserve in %s, but still calls the provider', async (stage) => {
        const d = deps({ stage });
        await processVerification(d, MESSAGE);

        expect(d.spies.reserve).not.toHaveBeenCalled();
        expect(d.spies.settle).not.toHaveBeenCalled();
        expect(d.spies.converse).toHaveBeenCalledTimes(1);
    });

    it('emits the dollar metric even where the counter is bypassed', async () => {
        // ⚠️ It costs one log line and it is the ONLY visibility on the ungated ~$88/month/stage exposure
        // ADR-0024 accepts. A metric emitted only where spend is already capped watches the safe stage.
        const d = deps({ stage: 'sandbox' });
        await processVerification(d, MESSAGE);

        expect(d.spies.emit).toHaveBeenCalled();
    });
});

describe('a call that failed', () => {
    it('REFUNDS IN FULL and retries when the provider throttled', async () => {
        const d = deps();
        d.spies.converse.mockRejectedValue(new BedrockThrottledError());

        await expect(processVerification(d, MESSAGE)).rejects.toThrow();
        expect(d.spies.settle).toHaveBeenCalledWith(expect.objectContaining({ actualMicros: 0 }));
        expect(d.spies.recordVerdict).not.toHaveBeenCalled();
    });

    it('KEEPS the reservation for a failure nobody enumerated', async () => {
        // ⛔ The direction of the unknown. Refunding a call that WAS billed under-counts, and a counter that
        // under-reports during a runaway reports green precisely when it matters.
        const d = deps();
        d.spies.converse.mockRejectedValue(new BedrockClientError('bedrock: unrecognised failure'));

        await expect(processVerification(d, MESSAGE)).rejects.toThrow();
        expect(d.spies.settle).not.toHaveBeenCalled();
    });

    it('never records a verdict from a failed call', async () => {
        // ⚠️ A DEPARTURE from the plan's literal wording, argued rather than assumed. Plan U11 says provider
        // failures "terminate as unresolved"; `unresolved` WITHHOLDS, which is the wrong-DISAGREE direction
        // the same plan calls unacceptable — and a provider outage would produce it in bulk for reasons that
        // have nothing to do with any line's quality. So a provider failure retries and, if it exhausts the
        // queue's attempts, DLQs: the line then publishes unverified, which is exactly today's behaviour.
        const d = deps();
        d.spies.converse.mockRejectedValue(new BedrockThrottledError());

        await processVerification(d, MESSAGE).catch(() => undefined);

        expect(d.spies.recordVerdict).not.toHaveBeenCalled();
    });
});

describe('a response that arrived but cannot be believed', () => {
    it.each([
        ['a malformed_model_output stop reason', { ...ANSWERED, stopReason: 'malformed_model_output' }],
        ['a max_tokens truncation', { ...ANSWERED, stopReason: 'max_tokens' }],
        ['prose instead of JSON', { ...ANSWERED, text: 'Sure! The parse looks right to me.' }],
        ['a wrong enum member', { ...ANSWERED, text: '{"verdict":"probably","certainty":"high"}' }],
        [
            'an unusable envelope',
            { kind: 'unusable' as const, reason: 'no text', stopReason: 'end_turn', usage: ANSWERED.usage },
        ],
    ])('records %s as inconclusive — NEVER as agreement', async (_label, outcome) => {
        const d = deps();
        d.spies.converse.mockResolvedValue(outcome);

        await processVerification(d, MESSAGE);

        expect(bandRecorded(d.spies)).toBe('inconclusive');
        expect(d.spies.rememberAgreement).not.toHaveBeenCalled();
    });

    it('still SETTLES the actual cost — those tokens were billed', async () => {
        const d = deps();
        d.spies.converse.mockResolvedValue({ ...ANSWERED, stopReason: 'malformed_model_output' });

        await processVerification(d, MESSAGE);

        expect(d.spies.settle).toHaveBeenCalledWith(expect.objectContaining({ actualMicros: 30 }));
    });

    it('KEEPS the reservation when the usage itself was unreadable', async () => {
        // `undefined` usage means COST UNKNOWN, not zero. Settling at zero would refund a call that really
        // spent; leaving the worst case standing over-counts, which is the safe direction.
        const d = deps();
        d.spies.converse.mockResolvedValue({
            kind: 'unusable',
            reason: 'no readable usage',
            stopReason: 'end_turn',
            usage: undefined,
        });

        await processVerification(d, MESSAGE);

        expect(d.spies.settle).not.toHaveBeenCalled();
        expect(bandRecorded(d.spies)).toBe('inconclusive');
    });

    it('does not retry a structured-output failure', async () => {
        // Plan U11: recorded "for the bake-off, not silently retried". The model answered and was billed;
        // asking again costs money for probably the same answer.
        const d = deps();
        d.spies.converse.mockResolvedValue({ ...ANSWERED, stopReason: 'malformed_model_output' });

        await expect(processVerification(d, MESSAGE)).resolves.toBeUndefined();
        expect(d.spies.converse).toHaveBeenCalledTimes(1);
    });
});

describe('a disagreement', () => {
    it('records a contradicted band and does NOT remember it', async () => {
        const d = deps();
        d.spies.converse.mockResolvedValue({
            ...ANSWERED,
            text: '{"verdict":"disagree","certainty":"high","reason":"line says 2 tbsp"}',
        });

        await processVerification(d, MESSAGE);

        expect(bandRecorded(d.spies)).toBe('contradicted');
        // "An embedding entry is not written for a resolution the gate did not agree with."
        expect(d.spies.rememberAgreement).not.toHaveBeenCalled();
    });

    it('treats a LOW-certainty disagreement as inconclusive', async () => {
        const d = deps();
        d.spies.converse.mockResolvedValue({
            ...ANSWERED,
            text: '{"verdict":"disagree","certainty":"low","reason":"not sure"}',
        });

        await processVerification(d, MESSAGE);

        expect(bandRecorded(d.spies)).toBe('inconclusive');
    });
});

describe('failures AFTER the money is spent', () => {
    it('does not fail the handler when the settlement fails', async () => {
        // ⛔ Throwing here would redeliver the message, which would reserve and call AGAIN — spending twice
        // for one line because a refund did not land. The standing reservation over-counts, which is safe.
        const d = deps();
        d.spies.settle.mockRejectedValue(new Error('check constraint violated'));

        await expect(processVerification(d, MESSAGE)).resolves.toBeUndefined();
        expect(d.spies.recordVerdict).toHaveBeenCalledTimes(1);
    });

    it('does not fail the handler when the verdict write fails', async () => {
        // Same reasoning, and it is safe because absence of a verdict means PUBLISH — a lost verdict degrades
        // to today's behaviour rather than manufacturing a withholding.
        const d = deps();
        d.spies.recordVerdict.mockRejectedValue(new Error('deadlock detected'));

        await expect(processVerification(d, MESSAGE)).resolves.toBeUndefined();
    });

    it('emits a metric when the settlement fails, so an unrefunded reservation is observable', async () => {
        const d = deps();
        d.spies.settle.mockRejectedValue(new Error('check constraint violated'));

        await processVerification(d, MESSAGE);

        const names = d.spies.emit.mock.calls.map((call) => call[0]?.name);

        expect(names).toContain('VerificationSettleFailures');
    });

    it('ALERTS when a cache token count is non-zero, which ADR-0024 says cannot happen', async () => {
        // ⚠️ At ~660 input tokens prompt caching cannot engage on any candidate (Haiku 4.5's minimum is
        // 4,096). A non-zero value means the prompt grew past the threshold and the cost model needs
        // revisiting — so it raises a signal rather than being quietly assumed correct.
        const d = deps();
        d.spies.converse.mockResolvedValue({
            ...ANSWERED,
            usage: { ...ANSWERED.usage, cacheReadInputTokens: 4_096 },
        });

        await processVerification(d, MESSAGE);

        expect(d.spies.emit.mock.calls.map((call) => call[0]?.name)).toContain('VerificationCacheTokensObserved');
    });
});

/**
 * U7/U11 — a RESTATED line, end to end through the handler.
 *
 * ⛔ TWO DESTINATIONS, ONE FACT, AND MISSING EITHER IS A DIFFERENT SILENT FAILURE. `statedMeasure` says what
 * the source PRINTED before the importer converted a historical measure (`one gill of milk` → `0.5 cup`), and
 * the handler must hand it to BOTH collaborators:
 *
 *  - to the PROMPT, or the model is shown `0.5 cup` beside a line reading `one gill of milk` and correctly
 *    disagrees with a parse that was right — the false DISAGREE U11 calls the number that triggers a rethink;
 *  - to the KEY, or the verdict is stored under the identity of a DIFFERENT judgement (the un-restated one),
 *    which U14's reader never looks up. Absence of a verdict publishes, so that failure is invisible.
 *
 * The unit suite replaces both collaborators wholesale, so this is the only tier that can observe the
 * handler wiring them to the same value.
 */
describe('a line whose measure was RESTATED', () => {
    const GILL = { quantityLow: 1, quantityHigh: null, unit: 'gill' };
    const RESTATED = {
        ...MESSAGE,
        sourceLine: 'one gill of milk',
        candidateFoodName: 'Milk, whole',
        quantityLow: 0.5,
        quantityHigh: null,
        unit: 'cup',
        statedMeasure: GILL,
    };

    /** The user turn the handler actually sent to the model. */
    const userTurn = (spies: { converse: ReturnType<typeof vi.fn> }): string =>
        String(spies.converse.mock.calls[0]?.[0]?.userMessage ?? '');

    it('asks the model about the GILL, not about the cups we stored', async () => {
        const d = deps();
        await processVerification(d, RESTATED);

        expect(userTurn(d.spies)).toContain('unit: gill');
        expect(userTurn(d.spies)).not.toContain('cup');
    });

    it('keys the verdict on a DIFFERENT identity than the same line un-restated', async () => {
        const restated = deps();
        await processVerification(restated, RESTATED);

        const plain = deps();
        await processVerification(plain, { ...RESTATED, statedMeasure: undefined });

        // ⛔ Both messages agree on the source line, the food and the persisted pair. Only the stated measure
        // differs — and it is what the model was shown, so they are different judgements and must not collide.
        expect(restated.spies.recordVerdict.mock.calls[0]?.[0]?.verificationKey).not.toBe(
            plain.spies.recordVerdict.mock.calls[0]?.[0]?.verificationKey,
        );
    });

    it('keys it under the v2 generation, so no pre-0027 verdict can be served to it', async () => {
        const d = deps();
        await processVerification(d, RESTATED);

        expect(String(d.spies.recordVerdict.mock.calls[0]?.[0]?.verificationKey)).toMatch(/^v2:/u);
    });
});

describe('band feedback (plan U3)', () => {
    it('reports the TERMINAL verdict to the band store, after the verdict is recorded', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        expect(d.spies.bandRecord).toHaveBeenCalledWith(
            expect.objectContaining({
                foodId: MESSAGE.foodId,
                band: 'verified',
                aspects: expect.arrayContaining(['identity']),
            }),
        );
        expect(d.spies.bandRecord.mock.invocationCallOrder[0]!).toBeGreaterThan(
            d.spies.recordVerdict.mock.invocationCallOrder[0]!,
        );
    });

    it('⚠️ a band-feedback failure never fails the handler — the call is already billed', async () => {
        const d = deps();
        d.spies.bandRecord.mockRejectedValue(new Error('band store down'));

        await expect(processVerification(d, MESSAGE)).resolves.toBeUndefined();
    });

    it('an unreadable answer reports inconclusive — which the mapping discards as absence', async () => {
        const d = deps();
        d.spies.converse.mockResolvedValue({
            kind: 'answered',
            text: 'not json at all',
            stopReason: 'end_turn',
            usage: { inputTokens: 660, outputTokens: 42, totalTokens: 702 },
        });
        await processVerification(d, MESSAGE);

        expect(d.spies.bandRecord).toHaveBeenCalledWith(expect.objectContaining({ band: 'inconclusive' }));
    });
});

describe('band authority at the worker (plan U4b, KTD-A)', () => {
    const AGREEING = [
        {
            foodId: '01JFOOD000000000000000000',
            score: 0.9,
            energyKcalPer100g: 364,
            proteinGPer100g: 10,
            fatGPer100g: 1,
            carbohydrateGPer100g: 76,
        },
        {
            foodId: '01JFOOD000000000000000001',
            score: 0.2,
            energyKcalPer100g: 364,
            proteinGPer100g: 10,
            fatGPer100g: 1,
            carbohydrateGPer100g: 76,
        },
    ];

    it('reads its OWN authority — never the message — and an authorized band narrows to quantity', async () => {
        const d = deps();
        d.spies.bandAuthority.mockResolvedValue({ state: 'authorized', epoch: 1 });
        await processVerification(d, { ...MESSAGE, shortlist: AGREEING });

        expect(d.spies.bandAuthority).toHaveBeenCalledWith(MESSAGE.foodId);
        expect(d.spies.recordVerdict.mock.calls[0]?.[0]?.aspects).toEqual(['quantity']);
    });

    it('day one — no authority — a ranked line asks identity and quantity', async () => {
        const d = deps();
        await processVerification(d, { ...MESSAGE, shortlist: AGREEING });

        expect(d.spies.recordVerdict.mock.calls[0]?.[0]?.aspects).toEqual(
            expect.arrayContaining(['identity', 'quantity']),
        );
    });

    it('⛔ a SHADOW-sampled message never consults authority — the coin already decided to ask', async () => {
        const d = deps();
        d.spies.bandAuthority.mockResolvedValue({ state: 'authorized', epoch: 1 });
        await processVerification(d, { ...MESSAGE, shortlist: AGREEING, shadowSample: true });

        expect(d.spies.bandAuthority).not.toHaveBeenCalled();
        expect(d.spies.recordVerdict.mock.calls[0]?.[0]?.aspects).toEqual(
            expect.arrayContaining(['identity', 'quantity']),
        );
        expect(d.spies.bandRecord).toHaveBeenCalledWith(expect.objectContaining({ shadowSample: true }));
    });

    it('⚠️ an authority-read failure verifies identity — the stale-read direction is fixed', async () => {
        const d = deps();
        d.spies.bandAuthority.mockRejectedValue(new Error('band table unreachable'));

        await expect(processVerification(d, { ...MESSAGE, shortlist: AGREEING })).resolves.toBeUndefined();
        expect(d.spies.recordVerdict.mock.calls[0]?.[0]?.aspects).toEqual(
            expect.arrayContaining(['identity', 'quantity']),
        );
    });
});

describe('U11/R20 — private-food and author-augmented lines stay OUT of the shared knowledge', () => {
    it('a privateFood message writes NO memo, even on a verified identity agreement', async () => {
        const d = deps();
        await processVerification(d, { ...MESSAGE, privateFood: true });

        // The verdict itself still lands — the author's own line is verified like any other.
        expect(d.spies.recordVerdict).toHaveBeenCalledTimes(1);
        expect(d.spies.rememberAgreement).not.toHaveBeenCalled();
    });

    it('a privateFood message feeds NO band observation and consults NO authority', async () => {
        const d = deps();
        await processVerification(d, { ...MESSAGE, privateFood: true });

        expect(d.spies.bandRecord).not.toHaveBeenCalled();
        expect(d.spies.bandAuthority).not.toHaveBeenCalled();
    });

    it('an authorAugmented message feeds NO band observation — but the memo is NOT its concern', async () => {
        const d = deps();
        await processVerification(d, { ...MESSAGE, authorAugmented: true });

        expect(d.spies.bandRecord).not.toHaveBeenCalled();
        expect(d.spies.bandAuthority).not.toHaveBeenCalled();
        // The BOUND food here is public (only the shortlist ranked a private one), so the phrase → food
        // memo is still legitimate shared knowledge and still written.
        expect(d.spies.rememberAgreement).toHaveBeenCalledTimes(1);
    });

    it('an unreadable answer on an excluded line reports nothing to the bands either', async () => {
        const d = deps();
        d.spies.converse.mockResolvedValue({
            kind: 'answered',
            text: 'not json at all',
            stopReason: 'end_turn',
            usage: { inputTokens: 660, outputTokens: 42, totalTokens: 702 },
        });
        await processVerification(d, { ...MESSAGE, privateFood: true });

        expect(d.spies.bandRecord).not.toHaveBeenCalled();
    });
});
