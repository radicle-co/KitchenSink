/** U10 — what "the provider still owes this erased account a deletion" means (R26/R27). */
import { describe, expect, it } from 'vitest';

import { providerDeletionIsOwed } from '../statusConvergence.js';

describe('providerDeletionIsOwed', () => {
    const confirmed = new Date('2026-10-01T00:00:00.000Z');

    it.each([
        ['an erased account the provider has not confirmed deleted', 'erased', null, true],
        ['an erased account the provider confirmed deleted', 'erased', confirmed, false],
        ['an active account (nothing was erased)', 'active', null, false],
        ['a tombstoned account (closure bans, it does not delete)', 'tombstoned', null, false],
        ['a suspended account', 'suspended', null, false],
    ])('%s -> owed: %s', (_label, status, providerDeletedAt, owed) => {
        expect(providerDeletionIsOwed({ status, providerDeletedAt })).toBe(owed);
    });
});
