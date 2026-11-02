/**
 * The provider-convergence re-drive's SELECTION, against REAL Postgres (LOCAL e2e, `docs/CODING_STANDARDS.md` §7.1a).
 *
 * The unit suite renders the predicate to SQL text. Only a database can say which rows it actually picks, and the
 * rule has four moving parts at once: the version comparison (`IS DISTINCT FROM`, which treats the columns as
 * values, not as booleans), the erased exclusion, the grace window, and the oldest-first limit. This seeds one row per
 * neighbouring state and asserts exactly which accounts the worker would be woken for.
 *
 * Runs as `identity_service` (ADR-0039). With no `DATABASE_ADMIN_URL` the harness throws; this tier never skips.
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function (this: { send: typeof send }) {
        this.send = send;
    }),
    SendMessageCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
        this.input = input;
    }),
}));

vi.mock('../../src/common/observability.js', () => ({
    emitMetric: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { SendMessageCommand } from '@aws-sdk/client-sqs';

import { accounts, profiles, users } from '@kitchensink/identity-db';

import { redriveUnappliedConvergence } from '../../src/common/convergenceRedrive.js';
import { openTestDb, resetIdentityRows } from '../support/roleDb.js';
import { makeIdentityAccount, makeIdentityProfile, makeIdentityUser } from '../__fixtures__/makeIdentityUser.js';

const QUEUE = 'https://sqs.local/queue/deletion';

describe('convergence re-drive selection (LOCAL e2e — real Postgres)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        ({ pool, db } = openTestDb());
    });

    afterAll(async () => {
        await pool?.end();
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        send.mockResolvedValue({});
        await resetIdentityRows(pool);
    });

    /** Seed one account with a given status, intent/applied versions, and an `updated_at` this many minutes ago. */
    async function seed(
        status: 'active' | 'suspended' | 'tombstoned' | 'erased',
        versions: { readonly intent: number; readonly applied: number },
        minutesAgo: number,
    ): Promise<string> {
        const row = makeIdentityUser({ status });

        await db.insert(users).values(row);
        await db.insert(accounts).values(makeIdentityAccount(row.id));
        await db.insert(profiles).values(makeIdentityProfile(row.id));
        await pool.query(
            `UPDATE users SET status_version = $2, status_applied_version = $3,
                    updated_at = now() - ($4 || ' minutes')::interval WHERE id = $1`,
            [row.id, versions.intent, versions.applied, String(minutesAgo)],
        );

        return row.identityId;
    }

    const sentIdentities = (): string[] =>
        vi
            .mocked(SendMessageCommand)
            .mock.calls.map((call) => (JSON.parse(call[0].MessageBody as string) as { identityId: string }).identityId)
            .sort();

    it('wakes the worker for every owed, settled-long-enough, non-erased account and for nobody else', async () => {
        const owedActive = await seed('active', { intent: 3, applied: 2 }, 60);
        const owedSuspended = await seed('suspended', { intent: 4, applied: 1 }, 60);
        const owedTombstoned = await seed('tombstoned', { intent: 2, applied: 1 }, 60);
        await seed('active', { intent: 5, applied: 5 }, 60); // converged: nothing owed
        await seed('erased', { intent: 9, applied: 1 }, 60); // erasure has its own re-drive
        await seed('active', { intent: 3, applied: 2 }, 1); // owed but fresh: still in flight on the queue

        const result = await redriveUnappliedConvergence(db, QUEUE, new Date());

        expect(result).toStrictEqual({ scanned: 3, redriven: 3, failed: 0 });
        expect(sentIdentities()).toStrictEqual([owedActive, owedSuspended, owedTombstoned].sort());
    });

    it('is idempotent in effect: a second run with nothing settled re-sends the same set, harmlessly', async () => {
        await seed('suspended', { intent: 4, applied: 1 }, 60);

        await redriveUnappliedConvergence(db, QUEUE, new Date());
        await redriveUnappliedConvergence(db, QUEUE, new Date());

        expect(vi.mocked(SendMessageCommand)).toHaveBeenCalledTimes(2);
    });
});
