/**
 * Unit tests for the account-erasure sweeper (T136b / C-007 / D7).
 *
 * Written BEFORE the handler (TDD red → green).
 *
 * This sweeper is NOT the archive sweeper with the nouns swapped, and the tests below exist to pin the
 * two places the semantics diverge:
 *
 *  1. **It is a backstop, not the only trigger.** `ErasureService` sends eagerly on
 *     `POST /api/v1/account/erasure`, so a healthy job never reaches this sweeper. It exists for the job
 *     whose send failed, or whose message was lost, or whose worker died — which is why it re-dispatches
 *     on STALENESS rather than on sight. Re-dispatching a job that is merely slow puts two workers on one
 *     owner: idempotent, but wasteful and lock-contending.
 *  2. **It owns the give-up decision.** The worker deliberately never writes `failed` (see
 *     `recordErasureJobError`) — it records the error and rethrows, leaving the retry to SQS and the
 *     recovery to this sweeper. That makes the transition to `failed` this module's job, and the
 *     `attempts` column its evidence. Without it, `failed` is a state nothing writes, and the C-007
 *     "after a `failed` job → fresh 202" path is dead.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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
    ERASURE_GIVE_UP_AGE_SECONDS,
    ERASURE_GIVE_UP_ATTEMPTS,
    handler,
    toErasureMessage,
    toTestPrincipalResetMessage,
    type StaleErasureJobRow,
    type StaleTestResetJobRow,
} from '../erasureSweeper.js';

interface SendInput {
    QueueUrl: string;
    MessageBody: string;
}
const sendInput = (call: unknown): SendInput => (call as { input: SendInput }).input;

function makeStaleJob(overrides: Partial<StaleErasureJobRow> = {}): StaleErasureJobRow {
    return {
        id: 'job-1',
        owner_id: '01J0000000000000000000OWN0',
        // No donate election by default; a test that cares sets it. Reconstructed onto the wire (U3b) so a
        // job recovered from the durable row does not lose the election its eager message carried.
        publish_recipe_ids: null,
        attempts: 1,
        // Old by default (2h) so an attempts-exhausted fixture is past the give-up age floor unless a test
        // makes it young on purpose (the U5 cross-generation-counter guard).
        age_seconds: 7200,
        ...overrides,
    };
}

/** Every SQL statement the handler issued, in order, as inspectable text. */
const executedSql = (execute: Mock): string[] => execute.mock.calls.map((call) => JSON.stringify(call[0]));

function makeStaleResetJob(overrides: Partial<StaleTestResetJobRow> = {}): StaleTestResetJobRow {
    return { id: 'reset-1', user_id: '01J0000000000000000000RST0', attempts: 1, age_seconds: 7200, ...overrides };
}

/**
 * A schema-less Drizzle stub. Routes the age query and the claim query by their text, and records the
 * `UPDATE … 'failed'` statements so the give-up path is assertable.
 *
 * ⚠️ `test_reset_jobs` is routed FIRST, by table name (ADR-0040). The sweeper now issues a second `LIMIT`-bearing
 * claim, and without this route every erasure fixture below would be served to it too — re-dispatching each erasure
 * job as a reset as well and silently doubling every send count this file asserts.
 */
function dbWithStaleJobs(
    rows: StaleErasureJobRow[],
    ageSeconds = 0,
    resetRows: StaleTestResetJobRow[] = [],
): { execute: Mock } {
    const execute = vi.fn().mockImplementation(async (query: unknown) => {
        const text = JSON.stringify(query);

        if (text.includes('test_reset_jobs')) {
            if (text.includes('LIMIT')) {
                return { rows: resetRows };
            }

            // The re-queue before a re-dispatch: every stale row is still where the sweeper read it.
            return { rows: text.includes("status = 'queued'") ? [{ id: 'requeued' }] : [] };
        }

        // The CLAIM query now also selects `age_seconds` per row, so route it FIRST by its own marker
        // (`LIMIT`) before the oldest-age metric query (which is the other `age_seconds` statement).
        if (text.includes('LIMIT')) {
            return { rows };
        }

        if (text.includes('age_seconds')) {
            return { rows: [{ age_seconds: ageSeconds }] };
        }

        return { rows: [] };
    });

    return { execute };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env['ACCOUNT_ERASURE_QUEUE_URL'] = 'https://sqs.test/erasure';
    sqsSend.mockResolvedValue({ MessageId: 'm-1' });
});

afterEach(() => {
    delete process.env['ACCOUNT_ERASURE_QUEUE_URL'];
    delete process.env['STAGE'];
});

describe('toErasureMessage', () => {
    it('produces the owner-scoped contract the worker parses, defaulting a null election to donate-nothing', () => {
        const message = toErasureMessage(makeStaleJob(), '2026-07-16T00:00:00.000Z');

        // REWRITTEN for ADR-0040: the message now states its kind explicitly. The worker still honours an absent kind
        // as an erasure (every message produced before the queue carried a second kind), but a producer that relies on
        // that default is one refactor away from sending a reset that reads as an erasure.
        // No jobId, deliberately: `idx_erasure_jobs_active_owner` makes "the active job for this owner"
        // unique, so the worker resolves the job FROM ownerId. A jobId on the wire would let a redelivered
        // message name a job that is no longer the active one — the exact index violation the worker's
        // `claimErasureJob` avoids by resolving on owner. A `null` persisted election ⇒ `[]` (donate none).
        expect(message).toEqual({
            kind: 'accountErasure',
            ownerId: '01J0000000000000000000OWN0',
            requestedAt: '2026-07-16T00:00:00.000Z',
            publishRecipeIds: [],
        });
    });

    it('reconstructs the DONATE election from the durable row (U3b) so a re-drained job does not lose it', () => {
        // THE reason this reads the row: the eager message this sweeper backstops was LOST, so re-sending an
        // empty election would silently turn the owner's "publish these" into "delete everything". The row is
        // the source of truth, so the election rides the reconstructed message.
        const message = toErasureMessage(
            makeStaleJob({ publish_recipe_ids: ['00000000-0000-4000-8000-0000000000d1'] }),
            '2026-07-16T00:00:00.000Z',
        );

        expect(message.publishRecipeIds).toEqual(['00000000-0000-4000-8000-0000000000d1']);
    });
});

describe('erasure-sweeper handler — the re-drain path', () => {
    it('re-dispatches a stale in-flight job to the erasure queue', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithStaleJobs([makeStaleJob({ owner_id: 'own-1' })]) as never);

        await handler();

        expect(sqsSend).toHaveBeenCalledTimes(1);
        expect(sendInput(sqsSend.mock.calls[0][0]).QueueUrl).toBe('https://sqs.test/erasure');
        expect(JSON.parse(sendInput(sqsSend.mock.calls[0][0]).MessageBody)).toMatchObject({ ownerId: 'own-1' });
    });

    it('claims ONLY jobs that are both in-flight and stale', async () => {
        // The two predicates are the whole safety model of this sweeper, and neither is observable from
        // the returned rows — so they are pinned on the statement itself.
        //
        //  - `status IN ('queued','running')`: without it the sweeper re-dispatches `completed` jobs,
        //    re-running an erasure for a user who is already gone, forever.
        //  - the staleness interval: without it EVERY tick re-dispatches every in-flight job, so a job
        //    that is merely mid-erasure (the worker runs up to 5 minutes) gets a second worker racing it
        //    on the same owner's rows. Idempotent, but pure lock contention and duplicate S3 sweeps.
        const db = dbWithStaleJobs([]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        const claim = executedSql(db.execute).find((text) => text.includes('owner_id') && text.includes('SELECT'));
        // Exactly one such claim statement — not zero (missing), not duplicated.
        expect(
            executedSql(db.execute).filter((text) => text.includes('owner_id') && text.includes('SELECT')),
        ).toHaveLength(1);
        expect(claim).toContain('queued');
        expect(claim).toContain('running');
        expect(claim).toContain('interval');
    });

    it('is a no-op when nothing is stuck', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithStaleJobs([]) as never);

        await handler();

        expect(sqsSend).not.toHaveBeenCalled();
    });

    it('keeps sweeping the remaining jobs when one send fails', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(
            dbWithStaleJobs([makeStaleJob({ id: 'job-1' }), makeStaleJob({ id: 'job-2', owner_id: 'own-2' })]) as never,
        );
        sqsSend.mockRejectedValueOnce(new Error('SQS throttled'));

        // One throttled send must not strand another user's right-to-erasure request.
        await expect(handler()).resolves.toBeUndefined();

        expect(sqsSend).toHaveBeenCalledTimes(2);
    });

    it('requires the queue URL rather than silently sweeping into the void', async () => {
        delete process.env['ACCOUNT_ERASURE_QUEUE_URL'];
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithStaleJobs([makeStaleJob()]) as never);

        await expect(handler()).rejects.toThrow(/ACCOUNT_ERASURE_QUEUE_URL/);
    });
});

describe('erasure-sweeper handler — the give-up path (who writes `failed`)', () => {
    it('abandons a job whose attempts are exhausted instead of re-dispatching it forever', async () => {
        const db = dbWithStaleJobs([makeStaleJob({ attempts: ERASURE_GIVE_UP_ATTEMPTS })]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        // `failed` is what makes the C-007 recovery path live: a fresh POST after a `failed` job returns
        // 202 and enqueues a retry (data-model.md). If nothing ever writes it, a permanently-broken
        // erasure is a 202 pointing at a job that will never finish, and the user cannot re-ask.
        const update = executedSql(db.execute).find((text) => text.includes('failed'));
        // Exactly one give-up UPDATE — not zero (missing), not duplicated.
        expect(executedSql(db.execute).filter((text) => text.includes('failed'))).toHaveLength(1);
        expect(update).toContain('job-1');
        expect(sqsSend).not.toHaveBeenCalled();
    });

    it('does NOT abandon an attempts-exhausted job that is still YOUNG — it re-dispatches (U5 counter guard)', async () => {
        // The cross-generation counter bug: a fresh job re-POSTed after a failure can have its `attempts`
        // inflated past the limit by the previous cycle's still-in-flight messages. Abandoning it on the
        // counter alone would fail a request the user only just made. The age floor protects it: a young
        // job (well under ERASURE_GIVE_UP_AGE_SECONDS) is re-dispatched to get its OWN real retries, even
        // with an exhausted counter.
        const db = dbWithStaleJobs([makeStaleJob({ attempts: ERASURE_GIVE_UP_ATTEMPTS + 5, age_seconds: 60 })]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        expect(sqsSend).toHaveBeenCalledTimes(1); // re-dispatched, not abandoned
        expect(executedSql(db.execute).find((text) => text.includes('failed'))).toBeUndefined();
    });

    it('abandons an attempts-exhausted job once it is ALSO past the give-up age floor', async () => {
        // Both signals must agree: exhausted attempts AND old enough that those attempts are genuinely its
        // own (a DLQ message + alarm already fired). age_seconds exactly at the floor abandons (>=).
        const db = dbWithStaleJobs([
            makeStaleJob({ attempts: ERASURE_GIVE_UP_ATTEMPTS, age_seconds: ERASURE_GIVE_UP_AGE_SECONDS }),
        ]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        // This test's whole point is WHETHER the give-up UPDATE fired at all (attempts exhausted AND past
        // the age floor) — its exact SQL shape is pinned separately by the "guards the give-up UPDATE" and
        // "records why it gave up" tests above, so existence here is the intended check.
        expect(executedSql(db.execute).find((text) => text.includes('failed'))).toBeDefined();
        expect(sqsSend).not.toHaveBeenCalled();
    });

    it('still re-dispatches a job one attempt short of the limit', async () => {
        // Pins the boundary: `>` instead of `>=` (or an off-by-one on the constant) would abandon a
        // request that still had a retry left.
        const db = dbWithStaleJobs([makeStaleJob({ attempts: ERASURE_GIVE_UP_ATTEMPTS - 1 })]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        expect(sqsSend).toHaveBeenCalledTimes(1);
        expect(executedSql(db.execute).find((text) => text.includes('failed'))).toBeUndefined();
    });

    it('guards the give-up UPDATE on the job still being in flight', async () => {
        // The read→update window is real: the worker can mark the job `completed` between our SELECT and
        // our UPDATE. Without the status guard we would flip a COMPLETED erasure back to `failed` —
        // turning a lawful 410 ("already erased") into a 202 that re-runs an erasure for a user whose
        // data is already gone, and corrupting the compliance record in the process.
        const db = dbWithStaleJobs([makeStaleJob({ attempts: ERASURE_GIVE_UP_ATTEMPTS })]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        const update = executedSql(db.execute).find((text) => text.includes('failed'));
        expect(update).toContain('queued');
        expect(update).toContain('running');
    });

    it('records why it gave up rather than leaving a bare `failed` row', async () => {
        const db = dbWithStaleJobs([makeStaleJob({ attempts: ERASURE_GIVE_UP_ATTEMPTS })]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        const update = executedSql(db.execute).find((text) => text.includes('failed'));
        expect(update).toContain('last_error');
    });

    it('keeps going when one give-up UPDATE fails', async () => {
        const db = dbWithStaleJobs([
            makeStaleJob({ id: 'job-1', attempts: ERASURE_GIVE_UP_ATTEMPTS }),
            makeStaleJob({ id: 'job-2', owner_id: 'own-2' }),
        ]);
        db.execute.mockImplementation(async (query: unknown) => {
            const text = JSON.stringify(query);

            if (text.includes('test_reset_jobs')) {
                return { rows: [] };
            }

            if (text.includes('age_seconds')) {
                return { rows: [{ age_seconds: 0 }] };
            }

            if (text.includes('failed')) {
                throw new Error('deadlock detected');
            }

            if (text.includes('SELECT')) {
                return {
                    rows: [
                        makeStaleJob({ id: 'job-1', attempts: ERASURE_GIVE_UP_ATTEMPTS }),
                        makeStaleJob({ id: 'job-2', owner_id: 'own-2' }),
                    ],
                };
            }

            return { rows: [] };
        });
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await expect(handler()).resolves.toBeUndefined();

        // job-2 is a different user's erasure — job-1's bookkeeping failure must not strand it.
        expect(sqsSend).toHaveBeenCalledTimes(1);
    });
});

describe('oldest-job-age metric (the erasure alarm signal)', () => {
    it('emits the age of the oldest outstanding job, unbounded by the sweep batch', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        // The archive sweeper's `countBacklog` comment explains why this is a SEPARATE, uncapped query:
        // deriving the signal from the batch-capped claim read caps the metric at the batch size, and an
        // alarm threshold above that can never fire. The same trap applies here — worse, because a COUNT
        // is the wrong metric for erasure entirely: you will never have 100 concurrent erasures, and ONE
        // stuck erasure is already a compliance incident. Age is the signal; the batch cannot bound it.
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithStaleJobs([makeStaleJob()], 7200) as never);
        process.env['STAGE'] = 'sandbox';

        await handler();

        const emf = log.mock.calls
            .map((call) => String(call[0]))
            .find((line) => line.includes('OldestErasureJobAgeSeconds'));
        // The full EMF envelope (namespace/dimension/unit) — not just that SOME matching line exists —
        // since the erasure age alarm depends on all of these matching exactly, not only the value.
        expect(JSON.parse(emf as string)).toMatchObject({
            _aws: {
                CloudWatchMetrics: [
                    {
                        Namespace: 'Commise/RecipeErasure',
                        Dimensions: [['Stage']],
                        Metrics: [{ Name: 'OldestErasureJobAgeSeconds', Unit: 'Seconds' }],
                    },
                ],
            },
        });
        expect(JSON.parse(emf as string)).toMatchObject({
            OldestErasureJobAgeSeconds: 7200,
            Stage: 'sandbox',
        });
        log.mockRestore();
    });

    it('emits 0 when no job is outstanding, so the alarm has data instead of INSUFFICIENT_DATA', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithStaleJobs([], 0) as never);

        await handler();

        const emf = log.mock.calls
            .map((call) => String(call[0]))
            .find((line) => line.includes('OldestErasureJobAgeSeconds'));
        expect(JSON.parse(emf as string)).toMatchObject({ OldestErasureJobAgeSeconds: 0 });
        log.mockRestore();
    });

    it('measures age over every in-flight job, not just the stale ones', async () => {
        // A job that is 59 minutes old and being retried normally is not "stale" (its `updated_at` is
        // fresh), but it IS the oldest outstanding erasure and the alarm must see it climb. Scoping the
        // age query to the sweeper's staleness window would hide exactly the job about to breach.
        const db = dbWithStaleJobs([], 3540);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        const ageQuery = executedSql(db.execute).find((text) => text.includes('age_seconds'));
        // Exactly one age-metric query — not zero (missing), not duplicated. Excludes the claim query,
        // which also selects `age_seconds` per row (line 128) but is distinguishable by its `LIMIT`.
        expect(
            executedSql(db.execute).filter((text) => text.includes('age_seconds') && !text.includes('LIMIT')),
        ).toHaveLength(1);
        expect(ageQuery).not.toContain('interval');
        expect(ageQuery).not.toContain('LIMIT');
    });
});

describe('test-reset jobs (ADR-0040) — the same backstop for the queue’s second kind of work', () => {
    it('shapes a stuck reset job into the reset contract the worker dispatches on', () => {
        expect(toTestPrincipalResetMessage(makeStaleResetJob(), '2026-09-13T00:00:00.000Z')).toEqual({
            kind: 'testPrincipalReset',
            ownerId: '01J0000000000000000000RST0',
            requestedAt: '2026-09-13T00:00:00.000Z',
        });
    });

    it('re-dispatches a stale in-flight reset job as a testPrincipalReset message on the erasure queue', async () => {
        // Without this a lost eager send leaves the job `queued` forever, and the recipe service's 423 write lock on
        // the principal (held while a reset is active) never releases — the whole test-pool slot is wedged.
        vi.mocked(getRecipeDbMock).mockReturnValue(dbWithStaleJobs([], 0, [makeStaleResetJob()]) as never);

        await handler();

        expect(sqsSend).toHaveBeenCalledTimes(1);
        expect(sendInput(sqsSend.mock.calls[0][0]).QueueUrl).toBe('https://sqs.test/erasure');
        expect(JSON.parse(sendInput(sqsSend.mock.calls[0][0]).MessageBody)).toMatchObject({
            kind: 'testPrincipalReset',
            ownerId: '01J0000000000000000000RST0',
        });
    });

    it('⛔ hands a stale RUNNING reset back to queued BEFORE re-dispatching it, guarded on the attempt it read', async () => {
        // A delivery claims only `queued` (LOW-5), so re-sending a message for a job left `running` by a dead
        // invocation would be acknowledged as a duplicate and recover nothing. The guard on `attempts` means a claim
        // made between this read and the update is left alone — its invocation is alive.
        const db = dbWithStaleJobs([], 0, [makeStaleResetJob({ attempts: 2 })]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        const requeue = executedSql(db.execute).find(
            (text) => text.includes('test_reset_jobs') && text.includes("status = 'queued'"),
        );
        expect(requeue).toBeDefined();
        expect(requeue).toContain('running');
        expect(requeue).toContain('attempts');
        expect(requeue).toContain('reset-1');
        expect(db.execute.mock.invocationCallOrder.at(-1)).toBeLessThan(sqsSend.mock.invocationCallOrder[0] ?? 0);
        expect(sqsSend).toHaveBeenCalledTimes(1);
    });

    it('⛔ does NOT re-dispatch a reset whose re-queue matched nothing — it was claimed or finished in between', async () => {
        const execute = vi.fn().mockImplementation(async (query: unknown) => {
            const text = JSON.stringify(query);

            return { rows: text.includes('test_reset_jobs') && text.includes('LIMIT') ? [makeStaleResetJob()] : [] };
        });
        vi.mocked(getRecipeDbMock).mockReturnValue({ execute } as never);

        await handler();

        expect(sqsSend).not.toHaveBeenCalled();
    });

    it('claims ONLY reset jobs that are both in-flight and stale, oldest first and batch-capped', async () => {
        const db = dbWithStaleJobs([]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        const claims = executedSql(db.execute).filter(
            (text) => text.includes('test_reset_jobs') && text.includes('SELECT'),
        );
        expect(claims).toHaveLength(1);
        expect(claims[0]).toContain('queued');
        expect(claims[0]).toContain('running');
        expect(claims[0]).toContain('interval');
        expect(claims[0]).toContain('LIMIT');
        expect(claims[0]).toContain('user_id');
    });

    it('re-drains resets even when no erasure job is stuck, and erasures even when no reset is', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(
            dbWithStaleJobs([makeStaleJob({ owner_id: 'own-1' })], 0, [makeStaleResetJob()]) as never,
        );

        await handler();

        const kinds = sqsSend.mock.calls.map((call) => JSON.parse(sendInput(call[0]).MessageBody).kind);
        expect(kinds.sort()).toEqual(['accountErasure', 'testPrincipalReset']);
    });

    it('abandons an exhausted AND old reset job to `failed`, guarded on it still being in flight', async () => {
        // `failed` frees `idx_test_reset_jobs_active_user`, which is what releases the principal's write lock and lets
        // a fresh reset be requested. Same two-signal rule as erasure: the message carries only the owner id, so a
        // prior cycle's redeliveries can inflate a fresh job's counter.
        const db = dbWithStaleJobs([], 0, [makeStaleResetJob({ attempts: ERASURE_GIVE_UP_ATTEMPTS })]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        const updates = executedSql(db.execute).filter((text) => text.includes('failed'));
        expect(updates).toHaveLength(1);
        expect(updates[0]).toContain('test_reset_jobs');
        expect(updates[0]).toContain('reset-1');
        expect(updates[0]).toContain('queued');
        expect(updates[0]).toContain('last_error');
        expect(sqsSend).not.toHaveBeenCalled();
    });

    it('re-dispatches an exhausted reset job that is still YOUNG rather than abandoning it', async () => {
        const db = dbWithStaleJobs([], 0, [
            makeStaleResetJob({ attempts: ERASURE_GIVE_UP_ATTEMPTS + 3, age_seconds: 60 }),
        ]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        expect(sqsSend).toHaveBeenCalledTimes(1);
        expect(executedSql(db.execute).find((text) => text.includes('failed'))).toBeUndefined();
    });

    it('keeps sweeping the remaining reset jobs when one send fails', async () => {
        vi.mocked(getRecipeDbMock).mockReturnValue(
            dbWithStaleJobs([], 0, [
                makeStaleResetJob(),
                makeStaleResetJob({ id: 'reset-2', user_id: 'rst-2' }),
            ]) as never,
        );
        sqsSend.mockRejectedValueOnce(new Error('SQS throttled'));

        await expect(handler()).resolves.toBeUndefined();

        expect(sqsSend).toHaveBeenCalledTimes(2);
    });

    it('keeps the erasure age metric about ERASURE only — a stuck test reset is not a compliance incident', async () => {
        const db = dbWithStaleJobs([], 0, [makeStaleResetJob()]);
        vi.mocked(getRecipeDbMock).mockReturnValue(db as never);

        await handler();

        const ageQuery = executedSql(db.execute).find(
            (text) => text.includes('age_seconds') && !text.includes('LIMIT'),
        );
        expect(ageQuery).toContain('account_erasure_jobs');
        expect(ageQuery).not.toContain('test_reset_jobs');
    });
});
