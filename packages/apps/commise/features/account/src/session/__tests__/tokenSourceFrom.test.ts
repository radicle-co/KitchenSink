/**
 * Unit tests for `tokenSourceFrom` — the ONE rule both apps' identity clients mint their bearer by.
 *
 * Two properties, each of which was broken on web: a missing token FAILS CLOSED (web used to coalesce to `''` and send
 * `Authorization: Bearer ` with no value), and `forceRefresh` is forwarded as Clerk's `skipCache` (five of web's six
 * call sites dropped it, so a refused bearer was never replayed with a fresh one).
 */
import { describe, expect, it, vi } from 'vitest';

import { isUnauthorizedError } from '../../errors.js';
import { tokenSourceFrom } from '../tokenSourceFrom.js';

describe('tokenSourceFrom', () => {
    it('answers the token the session mints, reading the cache by default', async () => {
        const getToken = vi.fn(async () => 'tok-1');

        await expect(tokenSourceFrom(getToken)()).resolves.toBe('tok-1');
        expect(getToken).toHaveBeenCalledWith({ skipCache: false });
    });

    it('forwards forceRefresh as skipCache so a refused bearer can be replaced', async () => {
        const getToken = vi.fn(async () => 'tok-2');

        await tokenSourceFrom(getToken)({ forceRefresh: true });

        expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    });

    it('passes the Clerk token template through when one is given, and only then', async () => {
        const getToken = vi.fn(async () => 'tok-3');

        await tokenSourceFrom(getToken, 'commise-native')({ forceRefresh: true });
        await tokenSourceFrom(getToken)();

        expect(getToken).toHaveBeenNthCalledWith(1, { template: 'commise-native', skipCache: true });
        expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: false });
    });

    it.each([null, undefined, ''])(
        'rejects with an unauthenticated UnauthorizedError when the session yields %j',
        async (none) => {
            const source = tokenSourceFrom(async () => none);

            const failure = await source().then(
                () => undefined,
                (error: unknown) => error,
            );

            expect(isUnauthorizedError(failure)).toBe(true);
            expect(failure).toMatchObject({ code: 'unauthenticated' });
        },
    );
});
