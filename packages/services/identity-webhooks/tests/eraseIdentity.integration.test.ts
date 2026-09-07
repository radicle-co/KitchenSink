/**
 * Integration specs for the shared identity-erasure primitive, against REAL Postgres.
 *
 * Validates **FR-002 / C-007** (hard purge occurs only via the explicit GDPR "Erase my data" action, and is
 * irreversible) and **CR-002 R1/R8/R10** as they land in the identity database: the erased field-scrub, the
 * companion-row purge, the append-only audit row, and the terminal `status='erased'` that arms the
 * anti-resurrection guard.
 *
 * WHY THIS TIER EXISTS. `eraseIdentityRow` is the ONE authoritative "erase this identity" transaction,
 * consumed by both the 12-month tombstone sweep and the `user.deleted` webhook. Its unit spec
 * (`packages/shared/identity-db/src/__tests__/eraseIdentityRow.test.ts`) drives a drizzle-shaped mock that discards `.where(...)`
 * entirely and records deletes as an untyped `'table'` string, so it cannot observe the three properties
 * that actually make an erasure safe. All three of the following mutations were VERIFIED to pass the unit
 * spec before these specs were written:
 *
 *   1. dropping `.where(eq(users.id, input.userId))` from the destructive `UPDATE` — erases EVERY user row;
 *   2. replacing the `accounts`/`profiles` purge with `delete(users)` — hard-deletes the row R1 says must
 *      NEVER be hard-deleted (and cascades the companion rows, so naive counts still look "purged");
 *   3. dropping `.where(...)` from the companion `DELETE`s — purges EVERY user's accounts and profiles.
 *
 * Only a real database evaluates a `WHERE`, so each spec below seeds a BYSTANDER alongside the target and
 * asserts the bystander survives byte-for-byte. A spec that only inspected the target would be satisfied by
 * an unbounded statement — which is precisely how the mutations above survived.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { accounts, eraseIdentityRow, lifecycleEvents, profiles, users } from '@kitchensink/identity-db';

import { hasDatabaseUrl, openIntegrationDb, resetIdentityRows } from './integrationDb.js';
import { makeIdentityAccount, makeIdentityProfile, makeIdentityUser } from './__fixtures__/makeIdentityUser.js';

/**
 * `eraseIdentityRow` is typed against `PostgresJsDatabase`, while `src/common/db.ts` builds a
 * `NodePgDatabase` (the production `pg` Pool) and casts at the call site. The specs reproduce the
 * PRODUCTION pairing — real `pg` driver, same cast — rather than "fixing" the mismatch here, so what runs
 * under test is what runs in the Lambda. (The signature/driver mismatch is reported separately.)
 */
const asErasureDb = (db: NodePgDatabase<Record<string, never>>): PostgresJsDatabase<Record<string, never>> =>
    db as unknown as PostgresJsDatabase<Record<string, never>>;

describe.skipIf(!hasDatabaseUrl)('eraseIdentityRow (integration — real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        ({ pool, db } = openIntegrationDb());
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        await resetIdentityRows(pool);
    });

    /**
     * Seed a complete identity world (user + both companion rows).
     *
     * @param overrides - `users`-row overrides.
     * @returns The seeded user's ULID.
     * @sideEffect Inserts into `users`, `accounts`, `profiles`.
     */
    async function seedCompleteUser(overrides: Parameters<typeof makeIdentityUser>[0] = {}): Promise<string> {
        const row = makeIdentityUser(overrides);
        await db.insert(users).values(row);
        await db.insert(accounts).values(makeIdentityAccount(row.id));
        await db.insert(profiles).values(makeIdentityProfile(row.id));

        return row.id;
    }

    it('scrubs ONLY the target row — a bystander active user keeps every PII column (FR-002/C-007)', async () => {
        const targetId = await seedCompleteUser({ name: 'Target Person', email: 'target@example.com' });
        const bystanderId = await seedCompleteUser({ name: 'Bystander Person', email: 'bystander@example.com' });
        const now = new Date('2026-08-01T00:00:00.000Z');

        await eraseIdentityRow(
            asErasureDb(db),
            { userId: targetId, triggerSource: 'admin', actor: 'clerk-webhook' },
            now,
        );

        const [target] = await db.select().from(users).where(eq(users.id, targetId));
        expect(target!.status).toBe('erased');
        expect(target!.name).toBeNull();
        expect(target!.picture).toBeNull();
        expect(target!.email).toContain('@erased.invalid');
        expect(target!.updatedAt?.toISOString()).toBe(now.toISOString());

        // The load-bearing half: an unbounded UPDATE would have erased this row too.
        const [bystander] = await db.select().from(users).where(eq(users.id, bystanderId));
        expect(bystander!.status).toBe('active');
        expect(bystander!.name).toBe('Bystander Person');
        expect(bystander!.picture).not.toBeNull();
        expect(bystander!.email).toBe('bystander@example.com');
    });

    it('NEVER hard-deletes the users row — it stays present and resolvable by id (R1)', async () => {
        const targetId = await seedCompleteUser({ identityId: 'user_clerk_r1' });

        await eraseIdentityRow(asErasureDb(db), { userId: targetId, triggerSource: 'sweep', actor: null }, new Date());

        const rows = await db.select().from(users).where(eq(users.id, targetId));
        expect(rows).toHaveLength(1);
        // `identityId` is deliberately left intact so the row stays resolvable (and blocks resurrection).
        expect(rows[0]!.identityId).toBe('user_clerk_r1');
    });

    it('purges ONLY the target’s companion rows — a bystander keeps their account and profile', async () => {
        const targetId = await seedCompleteUser();
        const bystanderId = await seedCompleteUser();

        await eraseIdentityRow(
            asErasureDb(db),
            { userId: targetId, triggerSource: 'admin', actor: 'clerk-webhook' },
            new Date(),
        );

        expect(await db.select().from(accounts).where(eq(accounts.userId, targetId))).toHaveLength(0);
        expect(await db.select().from(profiles).where(eq(profiles.userId, targetId))).toHaveLength(0);

        // The load-bearing half: an unbounded companion DELETE would have taken these too.
        expect(await db.select().from(accounts).where(eq(accounts.userId, bystanderId))).toHaveLength(1);
        expect(await db.select().from(profiles).where(eq(profiles.userId, bystanderId))).toHaveLength(1);
    });

    it('appends exactly ONE R8 audit row, carrying the caller’s trigger source and actor', async () => {
        const targetId = await seedCompleteUser();
        const now = new Date('2026-08-02T12:00:00.000Z');

        await eraseIdentityRow(asErasureDb(db), { userId: targetId, triggerSource: 'sweep', actor: null }, now);

        const audit = await db.select().from(lifecycleEvents).where(eq(lifecycleEvents.userId, targetId));
        expect(audit).toHaveLength(1);
        expect(audit[0]!.event).toBe('erasure');
        expect(audit[0]!.triggerSource).toBe('sweep');
        expect(audit[0]!.actor).toBeNull();
        expect(audit[0]!.occurredAt?.toISOString()).toBe(now.toISOString());

        // The audit is scoped to the erased user — no stray row was written for anyone else.
        expect(await db.select().from(lifecycleEvents)).toHaveLength(1);
    });

    it('is ATOMIC — a failure inside the transaction commits NOTHING (no half-erased row, no orphan audit)', async () => {
        const targetId = await seedCompleteUser({ name: 'Still Here', email: 'atomic@example.com' });

        // Force the LAST statement in the transaction (the R8 audit insert) to fail, by making the audit's
        // NOT NULL `event` column unsatisfiable for this transaction. A CHECK constraint is the least
        // invasive real-database failure injection: it needs no mock, and it fails exactly where the
        // primitive's own final statement runs — the point a non-transactional implementation would already
        // have committed the scrub and the companion purge.
        await pool.query(
            "ALTER TABLE lifecycle_events ADD CONSTRAINT lifecycle_events_atomicity_probe CHECK (event <> 'erasure')",
        );

        try {
            await expect(
                eraseIdentityRow(
                    asErasureDb(db),
                    { userId: targetId, triggerSource: 'admin', actor: 'probe' },
                    new Date(),
                ),
            ).rejects.toThrow();
        } finally {
            await pool.query('ALTER TABLE lifecycle_events DROP CONSTRAINT lifecycle_events_atomicity_probe');
        }

        // Rolled back: the scrub did NOT stick.
        const [row] = await db.select().from(users).where(eq(users.id, targetId));
        expect(row!.status).toBe('active');
        expect(row!.name).toBe('Still Here');
        expect(row!.email).toBe('atomic@example.com');

        // Rolled back: the companion purge did NOT stick either — the user is not left un-erased but stripped.
        expect(await db.select().from(accounts).where(eq(accounts.userId, targetId))).toHaveLength(1);
        expect(await db.select().from(profiles).where(eq(profiles.userId, targetId))).toHaveLength(1);

        // And no audit row claims an erasure that never happened.
        expect(await db.select().from(lifecycleEvents)).toHaveLength(0);
    });

    it('frees the erased user’s email for re-registration while the row itself persists (0009 partial unique)', async () => {
        // The `users_email_unique` index is partial (`WHERE deleted_at IS NULL`), and erasure rewrites the
        // email to a ULID-keyed `@erased.invalid` placeholder. Together those mean a genuinely erased person
        // can sign up again with their real address — a real GDPR-adjacent behaviour that only the live index
        // can prove, since a mock has no uniqueness at all.
        const targetId = await seedCompleteUser({ email: 'reuse@example.com' });

        await eraseIdentityRow(
            asErasureDb(db),
            { userId: targetId, triggerSource: 'admin', actor: 'clerk-webhook' },
            new Date(),
        );

        const reregistered = makeIdentityUser({ email: 'reuse@example.com' });
        await expect(db.insert(users).values(reregistered)).resolves.toBeDefined();

        // Two distinct rows: the erased tombstone and the fresh identity. The erased one is NOT reused.
        const active = await db
            .select()
            .from(users)
            .where(and(eq(users.status, 'active'), isNull(users.deletedAt)));
        expect(active.map((row) => row.id)).toContain(reregistered.id);
        expect(active.map((row) => row.id)).not.toContain(targetId);
    });
});
