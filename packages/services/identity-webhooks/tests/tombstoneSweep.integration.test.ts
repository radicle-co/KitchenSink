/**
 * Integration specs for the 12-month tombstone → auto-erasure sweep's SELECTION PREDICATE, against REAL
 * Postgres.
 *
 * Validates **FR-002 / C-007** (a hard purge is irreversible, so it may only ever touch an account that
 * genuinely opted into it) and **CR-002 KTD-3 / R3** (a closed account is auto-erased 12 months after
 * closure — and not before, and not any other account).
 *
 * WHY THIS TIER EXISTS. `innerHandler`'s `where(and(eq(users.status, 'tombstoned'), lte(users.deletedAt,
 * cutoff)))` is the most dangerous statement in the identity domain: every row it returns gets its Clerk
 * identity DELETED and its PII destroyed, irreversibly. The handler's unit spec drives a mock whose
 * `select().from().where()` resolves a list the TEST supplied — `select: () => ({ from: () => ({ where: () =>
 * Promise.resolve(expired) }) })` — so `expect(result).toMatchObject({ scanned: 1 })` is a tautology: the
 * test tells the handler what to find, then asserts it found it. The predicate itself is never evaluated by
 * anything. Dropping `eq(users.status, 'tombstoned')` (which would erase LIVE, ACTIVE accounts) cannot fail
 * that spec, because a mock has no rows to filter.
 *
 * So these specs seed a real POPULATION spanning every neighbouring lifecycle state and assert exactly which
 * member the sweep picks. Everything external is stubbed at the module seam — Clerk `deleteUser` and SQS in
 * particular are NEVER allowed to reach the network (the Clerk dev instance is a single shared rate limit) —
 * while `getDb` returns a genuine drizzle handle on the throwaway harness database, so the SQL is real.
 */
import type { Context, ScheduledEvent } from 'aws-lambda';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { sqsSend } = vi.hoisted(() => ({ sqsSend: vi.fn() }));

// `getDb` is the seam: the spec substitutes a REAL drizzle handle, so the handler's own SQL runs.
vi.mock('../src/common/db.js', () => ({ getDb: vi.fn() }));

// Clerk MUST NOT be contacted. The dev instance is one shared rate limit, and `deleteUser` is irreversible.
vi.mock('../src/common/identityClient.js', () => ({ deleteUser: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function (this: { send: typeof sqsSend }) {
        this.send = sqsSend;
    }),
    SendMessageCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
        this.input = input;
    }),
}));

vi.mock('../src/common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    withObservability: <T, R>(fn: (event: T, ctx: unknown) => Promise<R>) => fn,
}));

import { SendMessageCommand } from '@aws-sdk/client-sqs';

import { accounts, lifecycleEvents, profiles, users } from '@kitchensink/identity-db';

import { getDb } from '../src/common/db.js';
import { resetConfigCacheForTests } from '../src/config/env.js';
import { deleteUser } from '../src/common/identityClient.js';
import { handler as rawHandler } from '../src/handlers/tombstoneSweep.js';
import { hasDatabaseUrl, openIntegrationDb, resetIdentityRows } from './integrationDb.js';
import {
    makeIdentityAccount,
    makeIdentityProfile,
    makeIdentityUser,
    makeTombstonedUser,
} from './__fixtures__/makeIdentityUser.js';

/** The sweep's result shape (the handler is wrapped, so its public signature is the 2-arg Lambda one). */
type SweepHandler = (
    event: ScheduledEvent,
    ctx: Context,
) => Promise<{ scanned: number; erased: number; failed: number }>;

const handler = rawHandler as unknown as SweepHandler;
const mockGetDb = vi.mocked(getDb);
const mockDeleteUser = vi.mocked(deleteUser);

const makeEvent = (): ScheduledEvent => ({ id: 'sched', source: 'aws.events' }) as unknown as ScheduledEvent;
const makeContext = (): Context => ({ awsRequestId: 'req' }) as unknown as Context;

/** Days before `now`, as an absolute instant. Pure. */
function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** The seeded population's ULIDs, keyed by the lifecycle state each row represents. */
interface Population {
    /** tombstoned, closed ~13 months ago — the ONLY row the sweep may erase. */
    expired: string;
    /** tombstoned, closed just past the 12-month cutoff — also eligible (pins the window's size). */
    justExpired: string;
    /** tombstoned, closed ~11 months ago — still inside the retention window. */
    inWindow: string;
    /** ACTIVE with a legacy `deletedAt` — a live account. Erasing this is the catastrophic failure. */
    activeSoftDeleted: string;
    /** tombstoned with NULL `deletedAt` — closure instant unknown, so the window cannot have elapsed. */
    tombstonedNoClosureDate: string;
    /** already `erased` — must never be re-selected (no duplicate Clerk delete, no duplicate audit). */
    alreadyErased: string;
    /** `suspended` (admin moderation hold, RETAINS PII) — a different state entirely, never auto-erased. */
    suspended: string;
}

describe.skipIf(!hasDatabaseUrl)('tombstone-sweep selection predicate (integration — real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;
    let population: Population;
    let result: Awaited<ReturnType<SweepHandler>>;

    beforeAll(() => {
        ({ pool, db } = openIntegrationDb());
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        resetConfigCacheForTests();
        process.env['DB_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:db';
        process.env['AUTH_SECRET_ARN'] = 'arn:aws:secretsmanager:us-east-1:123:secret:auth';
        process.env['IDP_SECRET_KEY'] = 'sk_test_abc';
        process.env['DELETION_QUEUE_URL'] = 'https://sqs.local/queue/deletion';
        mockDeleteUser.mockResolvedValue(undefined);

        await resetIdentityRows(pool);
        population = await seedPopulation();
        // The seam: the handler runs its OWN SQL against the real harness database.
        mockGetDb.mockResolvedValue(db as never);

        result = await handler(makeEvent(), makeContext());
    });

    /**
     * Seed one row per neighbouring lifecycle state, each with companion rows so a wrongly-selected row is
     * visibly damaged.
     *
     * @returns The population's ULIDs by state.
     * @sideEffect Inserts into `users`, `accounts`, `profiles`.
     */
    async function seedPopulation(): Promise<Population> {
        const rows = {
            expired: makeTombstonedUser(daysAgo(400)),
            justExpired: makeTombstonedUser(daysAgo(366)),
            inWindow: makeTombstonedUser(daysAgo(330)),
            activeSoftDeleted: makeIdentityUser({ status: 'active', deletedAt: daysAgo(400) }),
            tombstonedNoClosureDate: makeIdentityUser({ status: 'tombstoned', deletedAt: null }),
            alreadyErased: makeIdentityUser({ status: 'erased', deletedAt: daysAgo(400), name: null, picture: null }),
            suspended: makeIdentityUser({ status: 'suspended', deletedAt: daysAgo(400) }),
        } as const;

        for (const row of Object.values(rows)) {
            await db.insert(users).values(row);
            await db.insert(accounts).values(makeIdentityAccount(row.id as string));
            await db.insert(profiles).values(makeIdentityProfile(row.id as string));
        }

        return Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, row.id])) as unknown as Population;
    }

    /** Read one seeded row back. */
    async function readUser(userId: string) {
        const [row] = await db.select().from(users).where(eq(users.id, userId));

        return row;
    }

    it('erases the tombstone closed beyond the 12-month window (CR-002 KTD-3 / R3)', async () => {
        const row = await readUser(population.expired);
        expect(row!.status).toBe('erased');
        expect(row!.name).toBeNull();
        expect(row!.email).toContain('@erased.invalid');
        expect(await db.select().from(accounts).where(eq(accounts.userId, population.expired))).toHaveLength(0);
    });

    it('erases a tombstone just PAST the cutoff but not one just INSIDE it — pinning the window at 12 months', async () => {
        expect((await readUser(population.justExpired))!.status).toBe('erased');

        const inWindow = await readUser(population.inWindow);
        expect(inWindow!.status).toBe('tombstoned');
        expect(inWindow!.name).not.toBeNull();
        expect(inWindow!.email).not.toContain('@erased.invalid');
    });

    it('NEVER erases an ACTIVE account, even one carrying an old legacy deletedAt (FR-002/C-007)', async () => {
        // The catastrophic case: dropping the `status = 'tombstoned'` conjunct would destroy a live account's
        // PII and irreversibly delete its Clerk identity. Its companion rows must be intact too.
        const row = await readUser(population.activeSoftDeleted);
        expect(row!.status).toBe('active');
        expect(row!.name).not.toBeNull();
        expect(row!.picture).not.toBeNull();
        expect(row!.email).not.toContain('@erased.invalid');
        expect(await db.select().from(accounts).where(eq(accounts.userId, population.activeSoftDeleted))).toHaveLength(
            1,
        );
        expect(await db.select().from(profiles).where(eq(profiles.userId, population.activeSoftDeleted))).toHaveLength(
            1,
        );
    });

    it('NEVER erases a SUSPENDED account — an admin moderation hold retains PII', async () => {
        const row = await readUser(population.suspended);
        expect(row!.status).toBe('suspended');
        expect(row!.name).not.toBeNull();
        expect(await db.select().from(profiles).where(eq(profiles.userId, population.suspended))).toHaveLength(1);
    });

    it('does NOT erase a tombstone whose closure date is unknown (NULL deletedAt cannot satisfy the window)', async () => {
        // Real SQL three-valued logic: `NULL <= cutoff` is NULL, not true, so the row is not selected. A mock
        // has no way to express this, and a JS `<=` comparison against `null` would coerce and select it.
        const row = await readUser(population.tombstonedNoClosureDate);
        expect(row!.status).toBe('tombstoned');
        expect(row!.name).not.toBeNull();
    });

    it('does NOT re-select an already-erased row — no duplicate Clerk delete, no duplicate audit row', async () => {
        expect(mockDeleteUser).toHaveBeenCalledTimes(2);
        expect(mockDeleteUser.mock.calls.flat()).not.toContain((await readUser(population.alreadyErased))!.identityId);

        const audit = await db
            .select()
            .from(lifecycleEvents)
            .where(eq(lifecycleEvents.userId, population.alreadyErased));
        expect(audit).toHaveLength(0);
    });

    it('reports scanned/erased counts derived from the REAL predicate, and audits only the erased rows', async () => {
        // Two of seven seeded rows are eligible. This count comes from Postgres evaluating the predicate —
        // not, as in the unit spec, from a list the test handed the handler.
        expect(result).toMatchObject({ scanned: 2, erased: 2, failed: 0 });

        const audit = await db.select().from(lifecycleEvents);
        expect(audit).toHaveLength(2);
        expect(audit.map((row) => row.userId).sort()).toEqual([population.expired, population.justExpired].sort());
        expect(
            audit.every((row) => row.event === 'erasure' && row.triggerSource === 'sweep' && row.actor === null),
        ).toBe(true);
    });

    it('enqueues the downstream recipe/food erasure legs for exactly the erased rows (U3/U4 seam)', async () => {
        const bodies = vi
            .mocked(SendMessageCommand)
            .mock.calls.map((call) => JSON.parse(call[0]!.MessageBody as string) as { userId: string; event: string });

        expect(bodies).toHaveLength(2);
        expect(bodies.map((body) => body.userId).sort()).toEqual([population.expired, population.justExpired].sort());
        expect(bodies.every((body) => body.event === 'erasure')).toBe(true);
    });
});
