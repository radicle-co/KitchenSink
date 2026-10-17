// @vitest-environment node
/**
 * `throwawayServerUrl` (`tests/common/throwawayServer.ts`), the gate every LOCAL e2e suite in this package passes
 * before it creates and drops roles and databases as a superuser. A LOCAL e2e suite never skips
 * (`docs/CODING_STANDARDS.md` §7.1a), so an absent server must fail the run. Before the suites became e2e, absent
 * meant "skip", and each suite fell back to `postgres://localhost/postgres`, which only the skip kept unreached.
 */
import { describe, expect, it } from 'vitest';

import { isNonDisposableAdminServerError } from '@kitchensink/service-test-harness';

import { throwawayServerUrl } from '../tests/common/throwawayServer.js';

describe('throwawayServerUrl', () => {
    it('returns a loopback maintenance-database URL unchanged', () => {
        expect(throwawayServerUrl('postgres://postgres:secret@127.0.0.1:55432/postgres')).toBe(
            'postgres://postgres:secret@127.0.0.1:55432/postgres',
        );
    });

    it.each([
        ['absent', undefined],
        ['empty', ''],
        ['not loopback', 'postgres://postgres:secret@db.example.com:5432/postgres'],
    ])('⛔ refuses a server that is %s, so the suite fails instead of reaching a default', (_case, adminUrl) => {
        let thrown: unknown;

        try {
            throwawayServerUrl(adminUrl);
        } catch (error) {
            thrown = error;
        }

        expect(isNonDisposableAdminServerError(thrown)).toBe(true);
    });
});
