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

import { processVerification, type VerificationDeps } from '../verifyLine.js';

const MESSAGE = {
    recipeId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    sourceLine: '2 cups all-purpose flour',
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

/** Deps with everything healthy, and spies on every side effect. */
function deps(overrides: Partial<VerificationDeps> = {}): VerificationDeps & {
    readonly spies: {
        reserve: ReturnType<typeof vi.fn>;
        settle: ReturnType<typeof vi.fn>;
        converse: ReturnType<typeof vi.fn>;
        recordVerdict: ReturnType<typeof vi.fn>;
        rememberAgreement: ReturnType<typeof vi.fn>;
        emit: ReturnType<typeof vi.fn>;
    };
} {
    const spies = {
        reserve: vi.fn().mockResolvedValue({ kind: 'reserved', reservedMicros: 116 }),
        settle: vi.fn().mockResolvedValue(undefined),
        converse: vi.fn().mockResolvedValue(ANSWERED),
        recordVerdict: vi.fn().mockResolvedValue(undefined),
        rememberAgreement: vi.fn().mockResolvedValue(undefined),
        emit: vi.fn(),
    };

    return {
        spies,
        stage: 'prod',
        settings: { resolve: vi.fn().mockResolvedValue(SETTINGS) },
        ledger: { reserve: spies.reserve, settle: spies.settle },
        bedrock: { converse: spies.converse },
        store: { recordVerdict: spies.recordVerdict, rememberAgreement: spies.rememberAgreement },
        emit: spies.emit,
        now: () => new Date('2026-08-21T10:00:01.000Z'),
        ...overrides,
    } as VerificationDeps & { spies: typeof spies };
}

/** The band a run recorded, or `undefined` when it recorded nothing. */
const bandRecorded = (spies: { recordVerdict: ReturnType<typeof vi.fn> }): string | undefined =>
    spies.recordVerdict.mock.calls[0]?.[0]?.band;

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

    it('emits the dollar metric', async () => {
        const d = deps();
        await processVerification(d, MESSAGE);

        expect(d.spies.emit).toHaveBeenCalled();
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
