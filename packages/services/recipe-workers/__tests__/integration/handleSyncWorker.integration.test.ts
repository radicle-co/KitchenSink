import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const { getRecipeDb } = vi.hoisted(() => ({ getRecipeDb: vi.fn() }));
vi.mock('../../src/common/db.js', () => ({ getRecipeDb }));

import { handler } from '../../src/handlers/handleSyncWorker.js';

/**
 * The handle-sync consumer, driven the way SQS drives it: an SNS ENVELOPE in the record body, through the real
 * `handler` (parse → schema → transaction → upsert), over a MOCKED database (integration mocks its dependencies,
 * §7.1a — the real-database proof is `tests/e2e/handleSync/applyHandleRename.e2e.test.ts`).
 *
 * ⛔ WHAT THIS PINS. A snapshot the upsert REFUSES — an erased author's tombstone (0056) or a stale timestamp, both
 * of which surface as "the upsert returned no row" — must be ACKed and must NOT fan out. A fan-out of a refused
 * snapshot would write the real name onto the recipes the erasure just pseudonymized, which is the defect the
 * tombstone exists to close; and a thrown error instead of an ACK would redeliver the same refused snapshot until
 * the DLQ.
 */
type TestHandler = (event: SQSEvent) => Promise<SQSBatchResponse>;
const runHandler = handler as unknown as TestHandler;

const dialect = new PgDialect();
const USER = '01J0000000000000000000WN00';

/** The SNS Notification envelope the subscription delivers (raw message delivery is OFF). */
const envelope = (messageId: string): SQSEvent =>
    ({
        Records: [
            {
                messageId,
                body: JSON.stringify({
                    Type: 'Notification',
                    Message: JSON.stringify({
                        userId: USER,
                        displayName: 'Ada Lovelace',
                        username: 'ada',
                        sourceTimestamp: '2026-10-16T00:00:00.000Z',
                    }),
                }),
            },
        ],
    }) as SQSEvent;

/** A database whose transaction records every statement and answers the upsert with `upsertRows`. */
function databaseAnswering(upsertRows: unknown[]): { db: unknown; statements: string[] } {
    const statements: string[] = [];
    const tx = {
        execute: (statement: SQL) => {
            const text = dialect.sqlToQuery(statement).sql.toLowerCase();

            statements.push(text);

            return Promise.resolve({ rows: text.includes('insert into author_handles') ? upsertRows : [] });
        },
    };

    return { db: { transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(tx) }, statements };
}

describe('handle-sync consumer — SNS envelope to refused snapshot', () => {
    beforeEach(() => {
        process.env['STAGE'] = 'pr-91';
    });

    it('⛔ ACKs a refused snapshot and issues NO fan-out UPDATE', async () => {
        const { db, statements } = databaseAnswering([]);
        getRecipeDb.mockReturnValue(db);

        const result = await runHandler(envelope('late-after-erasure'));

        expect(result).toEqual({ batchItemFailures: [] });
        expect(statements).toHaveLength(1);
        expect(statements[0]).toContain('author_handles.erased_at is null');
        expect(
            statements.some((text) => text.includes('update recipes') || text.includes('update recipe_versions')),
        ).toBe(false);
    });

    it('fans an ACCEPTED snapshot out to recipes and versions', async () => {
        const { db, statements } = databaseAnswering([{ user_id: USER }]);
        getRecipeDb.mockReturnValue(db);

        const result = await runHandler(envelope('fresh'));

        expect(result).toEqual({ batchItemFailures: [] });
        expect(statements).toHaveLength(3);
        expect(statements[1]).toContain('update recipes');
        expect(statements[2]).toContain('update recipe_versions');
    });
});
