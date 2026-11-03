/**
 * The provider-convergence RE-DRIVE (ADR-0081 §4): every non-erased account whose provider state is behind the database
 * gets the deletion worker woken again.
 *
 * Why it exists: `suspendUser`, `unsuspendUser`, `deleteUserMe` and `reactivateUser` commit the status and THEN send one
 * SQS message. If SQS is down at that moment the intent stays unapplied and the message is gone. For an unsuspend that
 * leaves the person marked suspended, and recipe and food answer 403 for good. The queue check only reads and
 * escalates, so something must send again; the worker converges idempotently (it reads the stored status), so a repeat
 * is harmless.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function (this: { send: typeof send }) {
        this.send = send;
    }),
    SendMessageCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
        this.input = input;
    }),
}));

const { logger, emitMetric } = vi.hoisted(() => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    emitMetric: vi.fn(),
}));
vi.mock('../observability.js', () => ({ logger, emitMetric }));

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { idpDeletionMessageSchema } from '@kitchensink/identity-core';

import { REDRIVE_BATCH_LIMIT, REDRIVE_GRACE_MS, redriveUnappliedConvergence } from '../convergenceRedrive.js';

interface Row {
    readonly id: string;
    readonly identityId: string;
    readonly status: 'active' | 'suspended' | 'tombstoned';
}

/** A db whose `select().from().where().limit()` resolves `rows` and records the predicate and the limit. */
function dbWith(rows: readonly Row[]) {
    const seen: { where?: SQL; limit?: number } = {};
    const chain = {
        from: () => chain,
        where: (predicate: SQL) => {
            seen.where = predicate;

            return chain;
        },
        orderBy: () => chain,
        limit: (n: number) => {
            seen.limit = n;

            return Promise.resolve(rows);
        },
    };

    return { db: { select: () => chain } as never, seen };
}

const NOW = new Date('2026-11-02T12:00:00.000Z');
const QUEUE = 'https://sqs.local/queue/deletion';

const sentBodies = (): unknown[] =>
    vi.mocked(SendMessageCommand).mock.calls.map((call) => JSON.parse(call[0].MessageBody as string));

beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({});
});

describe('redriveUnappliedConvergence', () => {
    it('selects accounts whose applied version differs from the intent, never an erased one, past the grace window', async () => {
        const { db, seen } = dbWith([]);

        await redriveUnappliedConvergence(db, QUEUE, NOW);

        const { sql, params } = new PgDialect().sqlToQuery(seen.where as SQL);
        expect(sql).toContain('IS DISTINCT FROM');
        expect(sql).toMatch(/"status" <> \$\d/);
        expect(params).toContain('erased');
        expect(sql).toMatch(/"updated_at" <= \$\d/);
        // The driver renders the instant as a timestamp string; compare the moment, not the spelling.
        const cutoffs = params.map((param) => new Date(String(param)).getTime());
        expect(cutoffs).toContain(NOW.getTime() - REDRIVE_GRACE_MS);
        expect(seen.limit).toBe(REDRIVE_BATCH_LIMIT);
    });

    it('wakes the worker once per owed account, naming the event the status implies', async () => {
        const { db } = dbWith([
            { id: 'usr_1', identityId: 'user_1', status: 'active' },
            { id: 'usr_2', identityId: 'user_2', status: 'suspended' },
            { id: 'usr_3', identityId: 'user_3', status: 'tombstoned' },
        ]);

        const result = await redriveUnappliedConvergence(db, QUEUE, NOW);

        expect(result).toStrictEqual({ scanned: 3, redriven: 3, failed: 0 });
        expect(sentBodies()).toMatchObject([
            { identityId: 'user_1', userId: 'usr_1', event: 'reactivation' },
            { identityId: 'user_2', userId: 'usr_2', event: 'reactivation' },
            { identityId: 'user_3', userId: 'usr_3', event: 'closure' },
        ]);
        // The worker REJECTS a malformed message into the DLQ, so each body is parsed with its own schema here.
        for (const body of sentBodies()) {
            expect(idpDeletionMessageSchema.safeParse(body).success).toBe(true);
        }
        expect(vi.mocked(SendMessageCommand).mock.calls.every(([input]) => input.QueueUrl === QUEUE)).toBe(true);
    });

    it('one failed send does not stop the rest, and is counted', async () => {
        const { db } = dbWith([
            { id: 'usr_1', identityId: 'user_1', status: 'active' },
            { id: 'usr_2', identityId: 'user_2', status: 'active' },
        ]);
        send.mockRejectedValueOnce(new Error('sqs down')).mockResolvedValue({});

        const result = await redriveUnappliedConvergence(db, QUEUE, NOW);

        expect(result).toStrictEqual({ scanned: 2, redriven: 1, failed: 1 });
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('re-enqueue failed'),
            expect.objectContaining({ userId: 'usr_1' }),
        );
    });

    it('does nothing, and says so loudly, when the stage has no deletion queue', async () => {
        const { db } = dbWith([{ id: 'usr_1', identityId: 'user_1', status: 'active' }]);

        const result = await redriveUnappliedConvergence(db, undefined, NOW);

        expect(result).toStrictEqual({ scanned: 0, redriven: 0, failed: 0 });
        expect(send).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
    });

    it('emits dimensionless counts, the owner ids stay on the log lines', async () => {
        const { db } = dbWith([{ id: 'usr_1', identityId: 'user_1', status: 'active' }]);

        await redriveUnappliedConvergence(db, QUEUE, NOW);

        expect(emitMetric).toHaveBeenCalledWith('ProviderConvergenceReEnqueued', 1);
        expect(emitMetric.mock.calls.every((call) => call.length === 2)).toBe(true);
    });
});
