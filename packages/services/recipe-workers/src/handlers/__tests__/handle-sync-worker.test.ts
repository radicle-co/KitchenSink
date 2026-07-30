/**
 * W8-a.2 — unit tests for the handle-sync consumer. Pins the two load-bearing behaviours the raw-SQL
 * worker owns (its DB semantics mirror the recipe-service `AuthorHandlesDal.applyRename`, which is proven
 * against a real database by that vertical's integration spec):
 *
 *   1. **Message parsing** — unwrap the SNS `Notification` envelope (or a raw-delivery body), and DROP a
 *      structurally-invalid payload (bad JSON / missing fields / unparseable timestamp) rather than retry it.
 *   2. **SQL shape** — a monotonic ON CONFLICT upsert guarded on `source_timestamp <`, then a fan-out to
 *      `recipes.author_handle` + `recipe_versions.editor_handle`, all in one transaction.
 *   3. **Batch isolation** — a record whose apply throws is reported in `batchItemFailures` (retried alone);
 *      an unparseable record is not.
 */
import { describe, it, expect, vi } from 'vitest';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { applyHandleRename, handler, parseHandleSyncMessage } from '../handle-sync-worker.js';

const { getRecipeDb } = vi.hoisted(() => ({ getRecipeDb: vi.fn() }));
vi.mock('../../common/db.js', () => ({ getRecipeDb }));

const dialect = new PgDialect();

/** A fake schema-less handle whose `transaction` runs the callback with a `tx` capturing rendered SQL. */
function makeFakeDb(txExecute: (statement: SQL) => Promise<{ rows: unknown[] }>): {
    db: NodePgDatabase<Record<string, never>>;
    texts: () => string[];
} {
    const texts: string[] = [];
    const tx = {
        execute: (statement: SQL) => {
            texts.push(dialect.sqlToQuery(statement).sql.toLowerCase());

            return txExecute(statement);
        },
    };
    const db = {
        transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
    } as unknown as NodePgDatabase<Record<string, never>>;

    return { db, texts: () => texts };
}

function record(body: unknown, messageId = 'm-1'): SQSRecord {
    return { messageId, body: typeof body === 'string' ? body : JSON.stringify(body) } as SQSRecord;
}

const VALID = { userId: 'user-1', displayName: 'Ada Lovelace', sourceTimestamp: '2026-07-20T00:00:00.000Z' };

describe('parseHandleSyncMessage', () => {
    it('parses a raw-delivery body', () => {
        expect(parseHandleSyncMessage(record(VALID))).toEqual(VALID);
    });

    it('unwraps an SNS Notification envelope (payload in .Message)', () => {
        const sns = { Type: 'Notification', Message: JSON.stringify(VALID) };
        expect(parseHandleSyncMessage(record(sns))).toEqual(VALID);
    });

    it.each([
        ['bad JSON', 'not json'],
        ['missing userId', { displayName: 'x', sourceTimestamp: VALID.sourceTimestamp }],
        ['blank userId', { ...VALID, userId: '  ' }],
        ['missing timestamp', { userId: 'u', displayName: 'x' }],
        ['unparseable timestamp', { ...VALID, sourceTimestamp: 'not-a-date' }],
    ])('drops a structurally-invalid message (%s) → undefined', (_label, body) => {
        expect(parseHandleSyncMessage(record(body))).toBeUndefined();
    });
});

describe('applyHandleRename SQL', () => {
    it('does a monotonic upsert then fans out to recipes + versions', async () => {
        const { db, texts } = makeFakeDb(() => Promise.resolve({ rows: [{ user_id: 'user-1' }] }));

        const applied = await applyHandleRename(db, VALID);

        expect(applied).toBe(true);
        const sql = texts().join('\n');
        expect(sql).toContain('insert into author_handles');
        expect(sql).toContain('on conflict (user_id) do update');
        expect(sql).toContain('author_handles.source_timestamp < excluded.source_timestamp'); // monotonic guard
        expect(sql).toContain('update recipes set author_handle');
        expect(sql).toContain('update recipe_versions set editor_handle');
    });

    it('reports NOT applied and does NOT fan out when the upsert guard rejects a stale event', async () => {
        const { db, texts } = makeFakeDb(() => Promise.resolve({ rows: [] })); // 0 rows → guard rejected

        const applied = await applyHandleRename(db, VALID);

        expect(applied).toBe(false);
        // Only the upsert ran; no fan-out UPDATEs.
        expect(texts().some((t) => t.includes('update recipes'))).toBe(false);
    });
});

describe('handler batch isolation', () => {
    it('reports a failing record in batchItemFailures and drops an unparseable one', async () => {
        // First record applies fine; second throws; third is unparseable (dropped, not a failure).
        let call = 0;
        const fakeDb = {
            transaction: () => {
                call += 1;

                if (call === 2) {
                    return Promise.reject(new Error('db down'));
                }

                return Promise.resolve(true);
            },
        } as unknown as NodePgDatabase<Record<string, never>>;
        vi.mocked(getRecipeDb).mockReturnValue(fakeDb as never);

        const event = {
            Records: [record(VALID, 'ok'), record(VALID, 'boom'), record('garbage', 'bad')],
        } as SQSEvent;

        const result = await handler(event, {} as never, () => {});

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'boom' }] });
    });
});
