/**
 * Unit tests for the version-archive sweeper (T132 / FR-007b-i).
 *
 * Written BEFORE the handler (TDD red → green).
 *
 * The sweeper is what makes the outbox an outbox. `recipe-service` deliberately does NOT send to SQS on
 * save — it only writes the `recipe_version_pending_archives` row — because FR-007b-i requires the save
 * to succeed independently of the archive path, and a save that enqueues is a save that can fail when
 * SQS is unreachable. So the row is the source of truth and this scheduled sweeper is the only thing
 * that turns rows into messages.
 *
 * That inversion is the whole point: a lost message, a failed send, an SQS outage — none of them lose
 * work, because the row is still there and the next tick re-dispatches it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sqsSend } = vi.hoisted(() => ({ sqsSend: vi.fn() }));

vi.mock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(function () {
        return { send: sqsSend };
    }),
    SendMessageCommand: vi.fn(function (input: unknown) {
        return { command: 'SendMessage', input };
    }),
}));

const { getRecipeDb } = vi.hoisted(() => ({ getRecipeDb: vi.fn() }));
vi.mock('../../common/db.js', () => ({ getRecipeDb }));

import { getRecipeDb as getRecipeDbMock } from '../../common/db.js';
import {
    handler,
    oldestPendingArchiveAgeSeconds,
    toArchiveMessage,
    type PendingArchiveRow,
} from '../archiveSweeper.js';

interface SendInput {
    QueueUrl: string;
    MessageBody: string;
}
const sendInput = (call: unknown): SendInput => (call as { input: SendInput }).input;

function makePendingRow(overrides: Partial<PendingArchiveRow> = {}): PendingArchiveRow {
    return {
        id: 'pa-1',
        recipe_version_id: 'ver-1',
        recipe_id: 'rec-1',
        version_number: 3,
        created_by: 'own-1',
        ...overrides,
    };
}

/** A schema-less Drizzle stub whose `execute` returns the queued rows for the claim SELECT. */
function dbWithPending(
    rows: PendingArchiveRow[],
    backlog = rows.length,
    oldestAgeSeconds = 0,
): { execute: ReturnType<typeof vi.fn> } {
    const execute = vi.fn().mockImplementation(async (query: unknown) => {
        const serialized = JSON.stringify(query);

        // The handler emits the backlog + oldest-age metrics first, then claims a batch. Each read is
        // matched on a fragment unique to its SELECT so the stub answers the right query.
        if (serialized.includes('count(*)')) {
            return { rows: [{ count: backlog }] };
        }

        if (serialized.includes('age_seconds')) {
            return { rows: [{ age_seconds: oldestAgeSeconds }] };
        }

        return { rows };
    });

    return { execute };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env['RECIPE_ARCHIVE_QUEUE_URL'] = 'https://sqs.test/archive';
    sqsSend.mockResolvedValue({ MessageId: 'm-1' });
});

afterEach(() => {
    delete process.env['RECIPE_ARCHIVE_QUEUE_URL'];
});

describe('toArchiveMessage', () => {
    it('carries the version NUMBER as well as the id (the archive key needs it, ARCH-BE-3)', () => {
        const message = toArchiveMessage(makePendingRow(), '2026-07-15T00:00:00.000Z');

        // versionNumber is what `recipeVersionArchiveKey` keys on, and ownerId is what scopes it under
        // the GDPR erasure prefix — a message missing either produces an unreachable or mis-keyed object.
        expect(message).toEqual({
            recipeId: 'rec-1',
            versionId: 'ver-1',
            versionNumber: 3,
            ownerId: 'own-1',
            requestedAt: '2026-07-15T00:00:00.000Z',
        });
    });
});

describe('archive-sweeper handler', () => {
    it('dispatches one SQS message per claimable outbox row', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(
            dbWithPending([
                makePendingRow({ recipe_version_id: 'ver-1', version_number: 1 }),
                makePendingRow({ id: 'pa-2', recipe_version_id: 'ver-2', version_number: 2 }),
            ]) as never,
        );

        await handler();

        expect(sqsSend).toHaveBeenCalledTimes(2);
        const first = JSON.parse(sendInput(sqsSend.mock.calls[0][0]).MessageBody) as { versionId: string };
        expect(first.versionId).toBe('ver-1');
        expect(sendInput(sqsSend.mock.calls[0][0]).QueueUrl).toBe('https://sqs.test/archive');
    });

    it('is a no-op when the outbox is drained', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithPending([]) as never);

        await handler();

        expect(sqsSend).not.toHaveBeenCalled();
    });

    it('keeps sweeping the remaining rows when one send fails', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(
            dbWithPending([
                makePendingRow({ recipe_version_id: 'ver-1' }),
                makePendingRow({ id: 'pa-2', recipe_version_id: 'ver-2' }),
            ]) as never,
        );
        sqsSend.mockRejectedValueOnce(new Error('SQS throttled'));

        // One bad row must not strand the rest of the backlog: the failed row keeps its outbox record
        // and is simply re-dispatched on the next tick, which is exactly what the row-as-truth design
        // buys. Throwing here would abandon every subsequent row in the batch.
        await expect(handler()).resolves.toBeUndefined();

        expect(sqsSend).toHaveBeenCalledTimes(2);
    });

    it('requires the queue URL rather than silently sweeping into the void', async () => {
        delete process.env['RECIPE_ARCHIVE_QUEUE_URL'];
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithPending([makePendingRow()]) as never);

        await expect(handler()).rejects.toThrow(/RECIPE_ARCHIVE_QUEUE_URL/);
    });
});

describe('backlog metric (T138 wiring)', () => {
    it('emits the TOTAL backlog, not the capped batch — or the >100 alarm could never fire', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        // A batch of 1 while 250 rows are outstanding: the metric must report 250. Reporting the batch
        // length would cap at SWEEP_BATCH_SIZE (100) and sit permanently under the alarm threshold.
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithPending([makePendingRow()], 250) as never);

        await handler();

        const emf = log.mock.calls
            .map((call) => String(call[0]))
            .find((line) => line.includes('PendingArchiveBacklog'));
        // The full EMF envelope (namespace/dimension/unit) — not just that SOME matching line exists —
        // since the T138 alarm depends on all of these matching exactly, not only the metric name.
        expect(JSON.parse(emf as string)).toMatchObject({
            _aws: {
                CloudWatchMetrics: [
                    {
                        Namespace: 'Commise/RecipeArchive',
                        Dimensions: [['Stage']],
                        Metrics: [{ Name: 'PendingArchiveBacklog', Unit: 'Count' }],
                    },
                ],
            },
        });
        expect(JSON.parse(emf as string)).toMatchObject({ PendingArchiveBacklog: 250 });
        log.mockRestore();
    });

    it('emits 0 when drained, so the alarm has data instead of INSUFFICIENT_DATA', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithPending([], 0) as never);

        await handler();

        const emf = log.mock.calls
            .map((call) => String(call[0]))
            .find((line) => line.includes('PendingArchiveBacklog'));
        expect(JSON.parse(emf as string)).toMatchObject({ PendingArchiveBacklog: 0 });
        log.mockRestore();
    });
});

describe('oldestPendingArchiveAgeSeconds', () => {
    it('reads the age of the oldest un-archived row off created_at, unbounded by the sweep batch', async () => {
        // The query the age alarm depends on. It must NOT filter to the batch or to `next_attempt_at <= now()`
        // (a backed-off failing row's next_attempt_at is in the FUTURE) — the 59-minute row still being
        // retried normally is exactly the one about to breach, and it must be counted.
        const execute = vi.fn().mockResolvedValue({ rows: [{ age_seconds: 4200 }] });

        const age = await oldestPendingArchiveAgeSeconds({ execute } as never);

        expect(age).toBe(4200);
        const query = JSON.stringify(execute.mock.calls[0][0]);
        // Age is measured off `created_at` (when the version was saved / became pending debt), never
        // `next_attempt_at`, which backoff pushes into the future and would make a failing row look young.
        expect(query).toContain('created_at');
        expect(query).not.toContain('next_attempt_at');
    });

    it('returns 0 (never null) when the outbox is empty, so the alarm always has a datapoint', async () => {
        // COALESCE(..., 0) in SQL means an empty table yields age 0, not NULL — a metric that only appears
        // while broken cannot be alarmed on reliably.
        const execute = vi.fn().mockResolvedValue({ rows: [{ age_seconds: 0 }] });

        await expect(oldestPendingArchiveAgeSeconds({ execute } as never)).resolves.toBe(0);
    });
});

describe('oldest-pending-age metric (T138 / FR-007b-i wiring)', () => {
    it('emits the oldest un-archived row age every tick — the "oldest pending > 1 hour" alarm depends on it', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        // A single-row batch while the oldest row has aged 2 hours: the metric must report 7200 regardless
        // of how few rows this tick claims, so the 3600s alarm can actually fire.
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithPending([makePendingRow()], 1, 7200) as never);

        await handler();

        const emf = log.mock.calls
            .map((call) => String(call[0]))
            .find((line) => line.includes('OldestPendingArchiveAgeSeconds'));
        // The full EMF envelope (namespace/dimension/unit) — not just that SOME matching line exists —
        // since the FR-007b-i age alarm depends on all of these matching exactly, not only the value.
        expect(JSON.parse(emf as string)).toMatchObject({
            _aws: {
                CloudWatchMetrics: [
                    {
                        Namespace: 'Commise/RecipeArchive',
                        Dimensions: [['Stage']],
                        Metrics: [{ Name: 'OldestPendingArchiveAgeSeconds', Unit: 'Seconds' }],
                    },
                ],
            },
        });
        expect(JSON.parse(emf as string)).toMatchObject({
            Stage: expect.any(String),
            OldestPendingArchiveAgeSeconds: 7200,
        });
        log.mockRestore();
    });

    it('emits 0 when drained, so the age alarm has data instead of INSUFFICIENT_DATA', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithPending([], 0, 0) as never);

        await handler();

        const emf = log.mock.calls
            .map((call) => String(call[0]))
            .find((line) => line.includes('OldestPendingArchiveAgeSeconds'));
        expect(JSON.parse(emf as string)).toMatchObject({ OldestPendingArchiveAgeSeconds: 0 });
        log.mockRestore();
    });

    it('publishes the age under the SAME namespace + Stage dimension as the alarm watches', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        process.env['STAGE'] = 'sandbox';
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithPending([], 0, 0) as never);

        await handler();

        const emf = log.mock.calls
            .map((call) => String(call[0]))
            .find((line) => line.includes('OldestPendingArchiveAgeSeconds'));
        const parsed = JSON.parse(emf as string) as {
            Stage: string;
            _aws: { CloudWatchMetrics: { Namespace: string; Dimensions: string[][] }[] };
        };
        expect(parsed.Stage).toBe('sandbox');
        expect(parsed._aws.CloudWatchMetrics[0].Namespace).toBe('Commise/RecipeArchive');
        expect(parsed._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Stage']]);
        delete process.env['STAGE'];
        log.mockRestore();
    });
});
