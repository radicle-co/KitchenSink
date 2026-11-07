/**
 * Unit tests for `matchRequests.ts`: what the paste host remembers about its `POST /matches` calls (ADR-0071 section 6: a
 * call that leaves a proposal unmade writes no row and "the next call retries"). Written from that rule and from
 * `matchDemand.ts`, seen red first.
 *
 * The danger on both sides: a request the host never repeats leaves a food `unmatched` for ever (a line that never
 * joins), and a request it repeats without a bound is a storm against a service that is down. So an unmade food is asked
 * for again, up to {@link MAX_MATCH_ATTEMPTS} calls, then it is a failed request the COOK retries; a refused call
 * (the network, a 5xx) fails its foods at once; and a food the cook retried starts counting again.
 */
import { describe, expect, it } from 'vitest';

import { shouldRequestMatches, type UnmatchedFood } from '../matchDemand.js';
import {
    MAX_MATCH_ATTEMPTS,
    emptyMatchRequests,
    matchRequestFailures,
    reduceMatchRequests,
    requestedMatchKeys,
    type MatchRequestEvent,
    type MatchRequests,
} from '../matchRequests.js';

const food = (key: string): UnmatchedFood => {
    const [lineIndex = 0, foodIndex = 0] = key.split(':').map(Number);

    return { key, lineIndex, foodIndex };
};

const run = (...events: MatchRequestEvent[]): MatchRequests => events.reduce(reduceMatchRequests, emptyMatchRequests);

const wants = (state: MatchRequests, ...keys: string[]): boolean =>
    shouldRequestMatches(requestedMatchKeys(state), keys.map(food), state.inFlight !== undefined);

describe('a request in flight', () => {
    it('covers the keys it was sent for and blocks a second request until it answers', () => {
        const state = run({ type: 'sent', keys: ['0:0', '1:0'] });

        expect(state.inFlight).toEqual(new Set(['0:0', '1:0']));
        expect(wants(state, '0:0', '1:0', '2:0')).toBe(false);
    });

    it('once answered, a food it covered is not asked for again when it has a match', () => {
        const state = run({ type: 'sent', keys: ['0:0'] }, { type: 'answered', unmatched: new Set() });

        expect(state.inFlight).toBeUndefined();
        expect(wants(state)).toBe(false);
    });

    it('once answered, a NEW unmatched food is asked for: the set gained a member', () => {
        const state = run({ type: 'sent', keys: ['0:0'] }, { type: 'answered', unmatched: new Set() });

        expect(wants(state, '1:0')).toBe(true);
    });
});

describe('a food the call left unmade', () => {
    it('⛔ is asked for again: ADR-0071 section 6 says the next call retries, and nothing else would ask', () => {
        const state = run({ type: 'sent', keys: ['0:0'] }, { type: 'answered', unmatched: new Set(['0:0']) });

        expect(wants(state, '0:0')).toBe(true);
    });

    it('⛔ is asked for at most MAX_MATCH_ATTEMPTS times, then it is a failed request, not a storm', () => {
        const askAndMiss = (state: MatchRequests): MatchRequests =>
            reduceMatchRequests(reduceMatchRequests(state, { type: 'sent', keys: ['0:0'] }), {
                type: 'answered',
                unmatched: new Set(['0:0']),
            });
        let state = emptyMatchRequests;

        for (let attempt = 1; attempt <= MAX_MATCH_ATTEMPTS; attempt += 1) {
            expect(wants(state, '0:0')).toBe(true);
            state = askAndMiss(state);
        }

        expect(wants(state, '0:0')).toBe(false);
        expect(matchRequestFailures(state)).toEqual(new Set(['0:0']));
    });

    it('a food that arrived stops counting', () => {
        const state = run({ type: 'sent', keys: ['0:0', '1:0'] }, { type: 'answered', unmatched: new Set(['1:0']) });

        expect(wants(state, '1:0')).toBe(true);
        expect(matchRequestFailures(state)).toEqual(new Set());
    });
});

describe('a call that failed', () => {
    it('⛔ fails the foods it covered at once, and does not ask again by itself', () => {
        const state = run({ type: 'sent', keys: ['0:0', '1:0'] }, { type: 'refused' });

        expect(matchRequestFailures(state)).toEqual(new Set(['0:0', '1:0']));
        expect(state.inFlight).toBeUndefined();
        expect(wants(state, '0:0', '1:0')).toBe(false);
    });

    it('a food that is not covered by the failed call is unaffected', () => {
        const state = run({ type: 'sent', keys: ['0:0'] }, { type: 'refused' });

        expect(wants(state, '0:0', '1:0')).toBe(true);
    });
});

describe('Try again on a failed request', () => {
    it('⛔ clears the failure and the attempts, so the food is asked for again', () => {
        const failed = run({ type: 'sent', keys: ['0:0'] }, { type: 'refused' });
        const retried = reduceMatchRequests(failed, { type: 'retry', key: '0:0' });

        expect(matchRequestFailures(retried)).toEqual(new Set());
        expect(wants(retried, '0:0')).toBe(true);
    });

    it('retries one food and leaves another failed', () => {
        const failed = run({ type: 'sent', keys: ['0:0', '1:0'] }, { type: 'refused' });
        const retried = reduceMatchRequests(failed, { type: 'retry', key: '0:0' });

        expect(matchRequestFailures(retried)).toEqual(new Set(['1:0']));
    });
});

describe('a new job', () => {
    it('forgets everything: its keys repeat from job to job', () => {
        const state = run({ type: 'sent', keys: ['0:0'] }, { type: 'refused' }, { type: 'reset' });

        expect(state).toEqual(emptyMatchRequests);
    });
});
