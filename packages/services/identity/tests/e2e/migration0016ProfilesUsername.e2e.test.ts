/**
 * Migration `0016_profiles_username` and the read-through create that fills it, against a real database.
 *
 * ⛔ WHY THIS TIER. The decision's claims are properties of Postgres (plan 2026-10-15-010 D3): the column is plain
 * `text` (not `citext` — nothing looks a user up by username, and `citext` would hide a case-only rename), it is
 * nullable with NO default, it carries NO unique index (Clerk is the authority, and a swapped pair arriving out of
 * order must not fail a sync), and the service role reaches it through ADR-0039's default privileges with no
 * migration granting anything. A mocked database answers whatever it is told about every one of those.
 *
 * Runs as `identity_service`, the role the deployed service holds. Catalog reads use `pg_catalog`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

import { profiles, users } from '@kitchensink/identity-db';

import { noopHandleSyncPublisher } from '../../src/users/handleSync.publisher.js';
import { UsersService } from '../../src/users/users.service.js';
import type { VerifiedClerkClaims } from '../../src/auth/clerkAuth.service.js';
import { identityDb } from '../support/roleDb.js';

const roleDb = identityDb();

/** A verified token for a new cook, with the username both session tokens carry. */
function claimsFor(sub: string, overrides: Partial<VerifiedClerkClaims> = {}): VerifiedClerkClaims {
    return {
        sub,
        email: `${sub}@example.com`,
        firstName: 'Ada',
        lastName: 'Lovelace',
        username: 'ada',
        scopes: [],
        roles: [],
        permissions: [],
        testPrincipal: false,
        ...overrides,
    };
}

describe('0016_profiles_username (real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await roleDb.truncate();
    });

    describe('the column', () => {
        it('is plain text, nullable, with NO default', async () => {
            const { rows } = await pool.query<{ type: string; not_null: boolean; has_default: boolean }>(
                `SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS not_null, a.atthasdef AS has_default
                   FROM pg_attribute a
                  WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'username' AND NOT a.attisdropped`,
            );

            expect(rows).toEqual([{ type: 'text', not_null: false, has_default: false }]);
        });

        it('carries NO index, unique or otherwise (Clerk enforces uniqueness)', async () => {
            const { rows } = await pool.query<{ index: string }>(
                `SELECT i.indexrelid::regclass::text AS index
                   FROM pg_index i
                   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                  WHERE i.indrelid = 'public.profiles'::regclass AND a.attname = 'username'`,
            );

            expect(rows).toEqual([]);
        });

        it('lets two profiles hold the same username (a swap in flight must not fail a sync)', async () => {
            const service = new UsersService(db, {} as never, {} as never, noopHandleSyncPublisher, {} as never, false);

            await service.resolveOrCreateFromClaims(claimsFor('sub_swap_a', { username: 'same' }));
            await service.resolveOrCreateFromClaims(claimsFor('sub_swap_b', { username: 'same' }));

            const held = await db.select({ username: profiles.username }).from(profiles);
            expect(held).toEqual([{ username: 'same' }, { username: 'same' }]);
        });
    });

    describe('the service role (ADR-0039)', () => {
        it('can SELECT, INSERT and UPDATE the column without a migration granting it', async () => {
            const { rows } = await pool.query<Record<string, boolean>>(
                `SELECT has_column_privilege(current_user, 'public.profiles', 'username', 'SELECT') AS "select",
                        has_column_privilege(current_user, 'public.profiles', 'username', 'INSERT') AS "insert",
                        has_column_privilege(current_user, 'public.profiles', 'username', 'UPDATE') AS "update"`,
            );

            expect(rows).toEqual([{ select: true, insert: true, update: true }]);
        });
    });

    describe('read-through create', () => {
        it('stores the token’s username, exactly as sent, beside the display name', async () => {
            const service = new UsersService(db, {} as never, {} as never, noopHandleSyncPublisher, {} as never, false);

            const ctx = await service.resolveOrCreateFromClaims(claimsFor('sub_create', { username: 'GoodFellow' }));

            const [row] = await db
                .select({ displayName: profiles.displayName, username: profiles.username })
                .from(profiles)
                .where(eq(profiles.userId, ctx.userId));
            expect(row).toEqual({ displayName: 'Ada Lovelace', username: 'GoodFellow' });
        });

        it('stores NULL — never an empty string — for a token with no username', async () => {
            const service = new UsersService(db, {} as never, {} as never, noopHandleSyncPublisher, {} as never, false);

            const ctx = await service.resolveOrCreateFromClaims(claimsFor('sub_none', { username: undefined }));

            const [row] = await db
                .select({ username: profiles.username })
                .from(profiles)
                .innerJoin(users, eq(users.id, profiles.userId))
                .where(eq(profiles.userId, ctx.userId));
            expect(row).toEqual({ username: null });
        });
    });
});
