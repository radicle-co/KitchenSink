import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';

import { provisionCompleteUser, type ProvisionDeps } from '@kitchensink/identity-utils';
import { computeProfileScrub } from '@kitchensink/identity-core';
import { users, accounts, profiles, lifecycleEvents } from '../src/database/index.js';
import { newUserId } from '@kitchensink/identity-db';

/**
 * Proves R10 (anti-resurrection) against a REAL Postgres: neither a sign-in read-through nor the nightly
 * reconciliation (both routed through `provisionCompleteUser`) may revive a `tombstoned`/`erased` user — the
 * `upsertUser` conflict path must NOT clear `deletedAt`, restore name/avatar, revive the email, or rebuild the
 * scrubbed companion rows. Also exercises the CR-002 migrations (0010 enum values + 0011 lifecycle_events).
 *
 * Runs against the CI Postgres service; locally set DATABASE_URL (a THROWAWAY db — this DROPs the schema).
 */
const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../src/database/migrations');

async function runMigrations(pool: pg.Pool): Promise<void> {
    const files = readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

    for (const file of files) {
        await pool.query(readFileSync(join(migrationsDir, file), 'utf-8'));
    }
}

describe.skipIf(!DATABASE_URL)('lifecycle-aware provisioning — no resurrection (integration)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let deps: ProvisionDeps;

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        await runMigrations(pool);
        db = drizzle(pool);
        deps = {
            db: db as unknown as PostgresJsDatabase<Record<string, never>>,
            schema: { users, accounts, profiles },
            newUserId,
        };
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await pool.query(
            'DELETE FROM lifecycle_events; DELETE FROM profiles; DELETE FROM accounts; DELETE FROM users;',
        );
    });

    it('the CR-002 migrations add the tombstoned/erased enum values and the lifecycle_events table', async () => {
        const labels = await pool.query<{ enumlabel: string }>(
            `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'user_status'`,
        );
        const values = labels.rows.map((r) => r.enumlabel);

        expect(values).toEqual(expect.arrayContaining(['active', 'suspended', 'tombstoned', 'erased']));

        // lifecycle_events exists and accepts an audit insert.
        await db.insert(lifecycleEvents).values({ userId: 'usr_x', event: 'closure', triggerSource: 'user' });
        const audit = await db.select().from(lifecycleEvents).where(eq(lifecycleEvents.userId, 'usr_x'));
        expect(audit).toHaveLength(1);
    });

    it('does NOT revive a TOMBSTONED user (deletedAt/name/picture/email preserved; companion rows kept)', async () => {
        // Provision an active user, then simulate closure (tombstone: scrub email/picture, KEEP name).
        const created = await provisionCompleteUser<typeof users.$inferSelect>(
            deps,
            { identityId: 'idp_tomb', email: 'real@example.com', name: 'Ada Lovelace', picture: 'https://img/a.png' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );
        expect(created.kind).toBe('complete');

        const userId = created.kind === 'complete' ? created.user.id : '';
        const closedAt = new Date('2026-01-01T00:00:00.000Z');
        const directive = computeProfileScrub('closure', userId);
        await db
            .update(users)
            .set({ ...directive.userColumns, deletedAt: closedAt, updatedAt: closedAt })
            .where(eq(users.id, userId));

        // A sign-in read-through / reconciliation re-provisions the SAME identity with fresh Clerk data.
        await provisionCompleteUser<typeof users.$inferSelect>(
            deps,
            { identityId: 'idp_tomb', email: 'real@example.com', name: 'Ada Lovelace', picture: 'https://img/a.png' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );

        const [row] = await db.select().from(users).where(eq(users.id, userId));
        expect(row!.status).toBe('tombstoned');
        expect(row!.deletedAt?.toISOString()).toBe(closedAt.toISOString()); // NOT cleared
        expect(row!.email).toContain('@closed.invalid'); // real email NOT restored
        expect(row!.picture).toBeNull(); // avatar NOT restored
        expect(row!.name).toBe('Ada Lovelace'); // closure keeps the name

        // Companion rows (kept on closure) are not duplicated.
        const accountRows = await db.select().from(accounts).where(eq(accounts.userId, userId));
        expect(accountRows).toHaveLength(1);
    });

    it('does NOT rebuild the companion rows of an ERASED user (kept {id} only)', async () => {
        const created = await provisionCompleteUser<typeof users.$inferSelect>(
            deps,
            { identityId: 'idp_erased', email: 'gone@example.com', name: 'Grace' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );
        const userId = created.kind === 'complete' ? created.user.id : '';

        // Simulate erasure: scrub to {id} + delete the companion rows (what the sweep does).
        const directive = computeProfileScrub('erasure', userId);
        await db.delete(accounts).where(eq(accounts.userId, userId));
        await db.delete(profiles).where(eq(profiles.userId, userId));
        await db
            .update(users)
            .set({ ...directive.userColumns, updatedAt: new Date() })
            .where(eq(users.id, userId));

        // Read-through re-provision must NOT recreate account/profile for the erased user.
        await provisionCompleteUser<typeof users.$inferSelect>(
            deps,
            { identityId: 'idp_erased', email: 'gone@example.com', name: 'Grace' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );

        const [row] = await db.select().from(users).where(eq(users.id, userId));
        expect(row!.status).toBe('erased');
        expect(row!.name).toBeNull();

        const accountRows = await db.select().from(accounts).where(eq(accounts.userId, userId));
        const profileRows = await db.select().from(profiles).where(eq(profiles.userId, userId));
        expect(accountRows).toHaveLength(0); // NOT resurrected
        expect(profileRows).toHaveLength(0); // NOT resurrected
    });

    it('still revives a plain soft-deleted ACTIVE user (deletedAt cleared) — regression guard', async () => {
        // A status='active' row with deletedAt set (legacy soft-delete) must STILL be revived on re-register.
        const created = await provisionCompleteUser<typeof users.$inferSelect>(
            deps,
            { identityId: 'idp_active', email: 'back@example.com', name: 'Reg' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );
        const userId = created.kind === 'complete' ? created.user.id : '';
        await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));

        await provisionCompleteUser<typeof users.$inferSelect>(
            deps,
            { identityId: 'idp_active', email: 'back@example.com', name: 'Reg' },
            { onEmailCollision: 'placeholder', emailIsReal: true },
        );

        const [row] = await db
            .select()
            .from(users)
            .where(and(eq(users.id, userId)));
        expect(row!.status).toBe('active');
        expect(row!.deletedAt).toBeNull(); // revived
    });
});
