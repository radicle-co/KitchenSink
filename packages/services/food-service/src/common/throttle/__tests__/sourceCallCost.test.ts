/**
 * What one request on a budgeted route charges the requester's source budget: the source calls its handler can make.
 *
 * The charge must be the handler's real worst case, read from the authorities that decide it, so the budget counts
 * source calls and not requests. A literal would drift the day the resolve bound moves.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import { MAX_RESOLVE_CANDIDATE_IDS } from '../../../foods/foods.schema.js';
import { adoptCost, resolveCost } from '../sourceCallCost.js';

/** `count` distinct candidate ids. */
function picks(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `01JCAND1DATE0000000000${String(index).padStart(4, '0')}`);
}

describe('resolveCost', () => {
    it('charges one call for its one pick', () => {
        expect(resolveCost({ candidateIds: picks(MAX_RESOLVE_CANDIDATE_IDS) })).toBe(MAX_RESOLVE_CANDIDATE_IDS);
    });

    // The pipe answers these with a 400 after the guard, so the handler never calls the source. They still cost one,
    // so a flood of malformed bodies spends the budget rather than slipping past it.
    it.each([
        ['no body', undefined],
        ['a body that is not an object', 'candidateIds'],
        ['an empty pick list', { candidateIds: [] }],
        ['a repeated pick', { candidateIds: ['a', 'a'] }],
        ['more picks than the bound', { candidateIds: picks(MAX_RESOLVE_CANDIDATE_IDS + 1) }],
        ['an unknown key beside the picks', { candidateIds: picks(2), extra: true }],
    ])('charges one call for %s, which the pipe refuses', (_label, body) => {
        expect(resolveCost(body)).toBe(1);
    });
});

describe('adoptCost', () => {
    // `AdoptRemoteFood` fetches the picked item once, and only when the catalog does not already stand for it; the
    // interceptor gives the call back when none was made.
    it.each([undefined, { reference: 'a.b.c.d.e' }, 'not a body'])('charges one call for %j', (body) => {
        expect(adoptCost(body)).toBe(1);
    });
});
