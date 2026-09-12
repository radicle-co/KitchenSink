/**
 * U8 — the consumer-concurrency policy (R1, R2, R4).
 *
 * ⛔ Two numbers that must move TOGETHER, which is why they come from one module. A Lambda's
 * `reservedConcurrentExecutions` caps how many invocations may run; an SQS event source mapping's
 * `maximumConcurrency` caps how many the poller will START. Raise the reservation alone and the poller keeps
 * its old ceiling, so nothing speeds up. Raise the mapping alone and the poller starts more invocations than
 * the reservation admits, and the surplus is THROTTLED — which on an SQS event source is not free: a
 * throttled delivery still spends a receive, so a healthy message walks its `maxReceiveCount` down and
 * dead-letters for no reason but our own configuration (R2).
 *
 * ⛔ AND THEY ARE NOT A CONSTANT — they are a function of the stage CLASS, because ADR-0024's ceiling is
 * prod-only. In sandbox and every preview `reservedConcurrentExecutions: 1` is the ONLY thing standing
 * between a redrive loop and the invoice, which the ADR names as the change that would make its ruling
 * unsafe. So the policy is: prod scales both, non-prod scales neither.
 */
import { describe, expect, it } from 'vitest';

import {
    consumerConcurrencyFor,
    PROD_CONSUMER_CONCURRENCY,
    stageClassOf,
    type ConsumerConcurrency,
    type StageClass,
} from '../lib/consumerConcurrency.js';

describe('stageClassOf', () => {
    it('reads prod as prod and everything else as non-prod', () => {
        expect(stageClassOf('prod')).toBe('prod');
        expect(stageClassOf('sandbox')).toBe('non-prod');
        expect(stageClassOf('pr-91')).toBe('non-prod');
        expect(stageClassOf('dev')).toBe('non-prod');
    });

    /**
     * ⚠️ A stage NAMED like prod but not equal to it is non-prod. Exact equality rather than a prefix,
     * because `pr-1` shares no prefix with `prod` but `production` would — and admitting a stage into the
     * scaled class by accident is the direction that spends money.
     */
    it('⛔ admits ONLY the exact stage, never something that merely looks like it', () => {
        expect(stageClassOf('production')).toBe('non-prod');
        expect(stageClassOf('prod-2')).toBe('non-prod');
        expect(stageClassOf('PROD')).toBe('non-prod');
    });
});

describe('consumerConcurrencyFor', () => {
    it('⛔ gives prod the SAME value for the reservation and the mapping (R1)', () => {
        const prod = consumerConcurrencyFor('prod');

        expect(prod.reserved).toBe(prod.maximumConcurrency);
        expect(prod.reserved).toBe(PROD_CONSUMER_CONCURRENCY);
    });

    it('⛔ scales prod above one — a reservation of 1 is what R1 exists to raise', () => {
        expect(consumerConcurrencyFor('prod').reserved).toBeGreaterThanOrEqual(2);
    });

    /**
     * ⛔ AWS refuses a `maximumConcurrency` below 2 on an SQS event source mapping, so "prod runs at N and
     * non-prod at 1" cannot be expressed by setting the mapping to 1 — non-prod must set NO mapping
     * concurrency at all. `undefined` is the only representation of that, and it is why this field is
     * optional rather than a number with a sentinel.
     */
    it('⛔ leaves non-prod at a reservation of ONE and NO mapping concurrency (R4, ADR-0024 layer 2)', () => {
        for (const stage of ['sandbox', 'pr-91', 'dev']) {
            const policy = consumerConcurrencyFor(stage);

            expect(policy.reserved, stage).toBe(1);
            expect(policy.maximumConcurrency, stage).toBeUndefined();
        }
    });

    it('never emits a mapping concurrency AWS would refuse', () => {
        const prod = consumerConcurrencyFor('prod');

        expect(prod.maximumConcurrency).toBeGreaterThanOrEqual(2);
    });
});

describe('the stage class is a CLOSED union', () => {
    /**
     * ⛔ A COMPILE-TIME check, which is the point: the policy is a `Record` over the union, so adding a
     * third stage class without giving it a policy is a BUILD failure rather than a runtime default nobody
     * notices. This case would stop compiling if the exhaustive map were replaced by a lookup with a
     * fallback — which is exactly the shape that lets a new class silently inherit prod's spend.
     */
    it('has a policy for every member, proven by exhaustive assignment', () => {
        const everyClass: Record<StageClass, ConsumerConcurrency> = {
            prod: consumerConcurrencyFor('prod'),
            'non-prod': consumerConcurrencyFor('sandbox'),
        };

        expect(Object.keys(everyClass).sort()).toEqual(['non-prod', 'prod']);
    });
});
