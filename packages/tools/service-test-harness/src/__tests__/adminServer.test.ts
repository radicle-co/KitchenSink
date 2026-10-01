/**
 * The admin-server Specification — which PostgreSQL SERVER the integration tiers may provision on.
 *
 * Moved here from `recipe-workers/__tests__/integration/disposableDatabaseUrl.ts`, whose reasoning this
 * inherits: a URL being set is not permission to destroy what it points at. `DATABASE_URL` is the
 * APPLICATION's variable — `.env.development` sets it to a live database and a tunnel sets it to a shared
 * RDS — so the harness reads `DATABASE_ADMIN_URL` instead, and admits it only when the host is loopback.
 *
 * ⛔ Set-but-refused FAILS; absent SKIPS. A skip is the quiet failure (a whole tier once reported thirteen
 * skips because its `beforeAll` threw), so a misconfigured URL must be seen.
 */
import { describe, expect, it } from 'vitest';

import { decideAdminServerUrl } from '../adminServer.js';

describe('decideAdminServerUrl', () => {
    it('is absent when the variable is unset or empty — the tier then skips in lockstep', () => {
        expect(decideAdminServerUrl({})).toEqual({ kind: 'absent' });
        expect(decideAdminServerUrl({ DATABASE_ADMIN_URL: '' })).toEqual({ kind: 'absent' });
    });

    it('admits a loopback server, by any of its spellings', () => {
        for (const host of ['localhost', '127.0.0.1', '[::1]']) {
            const url = `postgres://postgres:postgres@${host}:5432/postgres`;

            expect(decideAdminServerUrl({ DATABASE_ADMIN_URL: url })).toEqual({ kind: 'usable', url });
        }
    });

    it('⛔ REFUSES a server that is not loopback — the tunnel case, which is what this exists for', () => {
        const url = 'postgres://postgres:postgres@db.example.com:5432/postgres';
        const decision = decideAdminServerUrl({ DATABASE_ADMIN_URL: url });

        expect(decision).toMatchObject({ kind: 'refused', url });
        expect(decision.kind === 'refused' && decision.reason).toMatch(/db\.example\.com.*not loopback/u);
    });

    it('refuses an unparseable URL, and one that names no database', () => {
        expect(decideAdminServerUrl({ DATABASE_ADMIN_URL: 'not a url' })).toMatchObject({ kind: 'refused' });
        expect(decideAdminServerUrl({ DATABASE_ADMIN_URL: 'postgres://postgres@localhost:5432' })).toMatchObject({
            kind: 'refused',
        });
    });
});
