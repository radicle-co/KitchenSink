/**
 * The reserved single-argument advisory-lock keys (`RESERVED_ADVISORY_LOCK_KEYS`).
 *
 * Each key is already bound by deployed code, so the numbers are pinned: a renumbered key lets an old runner and a new
 * one both hold the lock during a rolling deploy. The repo-wide rule that every advisory lock is namespaced
 * is `packages/infra/global/__tests__/advisoryLockClasses.test.ts`; this file holds the registry's own invariants.
 */
import { describe, expect, it } from 'vitest';

import { RESERVED_ADVISORY_LOCK_KEYS } from '../roles/advisoryLockClasses.js';

/** The largest `int4`, which is the top of `hashtext`'s range. */
const INT4_MAX = 2 ** 31 - 1;

describe('RESERVED_ADVISORY_LOCK_KEYS', () => {
    it('⛔ keeps every reserved key where deployed code already takes it', () => {
        expect(RESERVED_ADVISORY_LOCK_KEYS).toStrictEqual({
            roleCatalog: 7_412_200_228_220_039,
            schemaMigration: 7_412_200_228_220_022,
            testDatabaseProvisioning: 7_412_200_228_220_023,
        });
    });

    it('keeps every key a safe integer above int4, so no hashtext key can land on one', () => {
        for (const key of Object.values(RESERVED_ADVISORY_LOCK_KEYS)) {
            expect(Number.isSafeInteger(key)).toBe(true);
            expect(key).toBeGreaterThan(INT4_MAX);
        }
    });

    it('gives every concern its own key', () => {
        const keys = Object.values(RESERVED_ADVISORY_LOCK_KEYS);

        expect(new Set(keys).size).toBe(keys.length);
    });
});
