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
import type { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { applyHandleRename, handler, parseHandleSyncMessage } from '../handleSyncWorker.js';

const { getRecipeDb } = vi.hoisted(() => ({ getRecipeDb: vi.fn() }));
vi.mock('../../common/db.js', () => ({ getRecipeDb }));

/**
 * The handler as this suite drives it: ONE argument, the event.
 *
 * ⛔ Not a convenience. The suite called `handler(event, {} as never, () => {})`, feeding the `context` and
 * `callback` of AWS's `Handler` signature to an implementation that declares neither — CodeQL flags it as
 * superfluous trailing arguments, and it is right twice over: the values are inert placeholders, and passing
 * them implies the handler reads a context it never touches. `SQSHandler`'s declared arity makes a one-arg
 * call a type error, so the shape is a narrowed alias — the same one `accountErasureWorker.test.ts` uses,
 * for the same reason. If the handler ever DOES need its context, this alias is what fails first.
 */
type TestHandler = (event: SQSEvent) => Promise<SQSBatchResponse>;
const runHandler = handler as unknown as TestHandler;

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

/** A real app-user ULID: identity mints ULIDs, and `userId` is now ULID-validated (it is the predicate of three SQL statements). */
const USER = '01J0000000000000000000WN00';
const VALID = { userId: USER, displayName: 'Ada Lovelace', sourceTimestamp: '2026-07-20T00:00:00.000Z' };

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
        // The cases the previous five-clause `typeof` ladder ADMITTED. Each reds if the schema is loosened
        // back to "is a non-blank string" / "is a string".
        ['userId that is not a ULID', { ...VALID, userId: 'user-1' }],
        ['userId with a path fragment', { ...VALID, userId: '../../etc' }],
        ['displayName over the 100-char bound', { ...VALID, displayName: 'x'.repeat(101) }],
        ['displayName that is whitespace only', { ...VALID, displayName: '   ' }],
        ['displayName that is not a string', { ...VALID, displayName: { $ne: null } }],
        // A non-normalized instant would be compared against `source_timestamp` as-is, so it must be refused
        // rather than silently win or lose the monotonic guard.
        ['a date-only timestamp', { ...VALID, sourceTimestamp: '2026-07-20' }],
    ])('drops a structurally-invalid message (%s) → undefined', (_label, body) => {
        expect(parseHandleSyncMessage(record(body))).toBeUndefined();
    });

    it('trims displayName so one name has one stored form across the three tables it fans out to', () => {
        expect(parseHandleSyncMessage(record({ ...VALID, displayName: '  Ada Lovelace  ' }))?.displayName).toBe(
            'Ada Lovelace',
        );
    });
});

describe('applyHandleRename SQL', () => {
    it('does a monotonic upsert then fans out to recipes + versions', async () => {
        const { db, texts } = makeFakeDb(() => Promise.resolve({ rows: [{ user_id: USER }] }));

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

        const result = await runHandler(event);

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'boom' }] });
    });
});
