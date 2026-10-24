/**
 * The byline a recipe write stores (plan 2026-10-15-010 D8): the read model — identity's latest snapshot, applied by
 * the handle-sync consumer — wins over the token claim, which can be up to a minute stale. Pure.
 */
import { describe, expect, it } from 'vitest';

import { resolveByline } from '../bylinePolicy.js';

const CLAIMS = { firstName: 'Ada', lastName: 'Lovelace', username: 'ada' };

describe('resolveByline', () => {
    it('takes BOTH halves from the read model when the cook has a row', () => {
        expect(resolveByline({ displayName: 'Chef Ada', username: 'ada_cooks' }, CLAIMS)).toEqual({
            displayName: 'Chef Ada',
            username: 'ada_cooks',
        });
    });

    it('trusts a read-model "no username" over a claim — the row is the newer statement of the same fact', () => {
        expect(resolveByline({ displayName: 'Chef Ada', username: null }, CLAIMS)).toEqual({ displayName: 'Chef Ada' });
    });

    it('falls back to the token claims when the read model has no row yet', () => {
        expect(resolveByline(undefined, CLAIMS)).toEqual({ displayName: 'Ada Lovelace', username: 'ada' });
    });

    it('omits what neither source knows, rather than storing an empty string', () => {
        expect(resolveByline(undefined, {})).toEqual({});
    });

    it('drops a claim the username boundary refuses', () => {
        expect(resolveByline(undefined, { username: 'u'.repeat(65) })).toEqual({});
    });
});
