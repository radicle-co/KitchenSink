/**
 * Unit tests for `testPurgePolicy` (ADR-0040's food half) — written RED-first.
 *
 * The policy answers ONE question — "may this caller use the authored-food test purge?" — and every refusal is
 * the SAME `not-found`, because the door must be indistinguishable from a path this service does not route.
 * The table below is exhaustive over the three facts the policy reads (the claim, whether the `sub` is a named
 * service principal, and whether the app-user ULID has synced), so a refusal arm that leaked a 403 or a 401
 * through a later helper would show up here as an `allowed` that should not be.
 */
import { describe, expect, it } from 'vitest';

import { evaluateTestPurgeAccess, type TestPurgeAccessInput } from '../testPurgePolicy.js';

const USER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C2AA';

/** Every combination of the three facts, with the one verdict each must produce. */
const TABLE: ReadonlyArray<readonly [string, TestPurgeAccessInput, ReturnType<typeof evaluateTestPurgeAccess>]> = [
    [
        'a signed test principal with a synced ULID',
        { testPrincipal: true, sub: 'user_pool_1', userId: USER_ULID },
        { kind: 'allowed', userId: USER_ULID },
    ],
    [
        'a signed test principal whose ULID has not synced (absent)',
        { testPrincipal: true, sub: 'user_pool_1', userId: undefined },
        { kind: 'not-found' },
    ],
    [
        'a signed test principal whose ULID is empty',
        { testPrincipal: true, sub: 'user_pool_1', userId: '' },
        { kind: 'not-found' },
    ],
    [
        'a service principal carrying the claim',
        { testPrincipal: true, sub: 'svc_import', userId: USER_ULID },
        { kind: 'not-found' },
    ],
    [
        'a service principal carrying the claim and no ULID',
        { testPrincipal: true, sub: 'svc_import', userId: undefined },
        { kind: 'not-found' },
    ],
    ['a real user', { testPrincipal: false, sub: 'user_real', userId: USER_ULID }, { kind: 'not-found' }],
    [
        'a real user whose ULID has not synced',
        { testPrincipal: false, sub: 'user_real', userId: undefined },
        { kind: 'not-found' },
    ],
    ['a real service principal', { testPrincipal: false, sub: 'svc_import', userId: undefined }, { kind: 'not-found' }],
    [
        'a real service principal with a ULID',
        { testPrincipal: false, sub: 'svc_import', userId: USER_ULID },
        { kind: 'not-found' },
    ],
];

describe('evaluateTestPurgeAccess', () => {
    it.each(TABLE)('%s', (_name, input, expected) => {
        expect(evaluateTestPurgeAccess(input)).toStrictEqual(expected);
    });

    it('admits exactly ONE row of the table — every other combination is the concealing not-found', () => {
        const allowed = TABLE.filter(([, input]) => evaluateTestPurgeAccess(input).kind === 'allowed');

        expect(allowed.map(([name]) => name)).toStrictEqual(['a signed test principal with a synced ULID']);
    });
});
