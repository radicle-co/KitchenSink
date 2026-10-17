/**
 * The recipe backstop's ENTRY POINT: it runs whenever invoked, and its connection is taken at the first READ.
 *
 * ⛔ REWRITTEN (owner ruling 2026-10-12). The handler used to stand down between 00:00 and 09:00 ET on a non-prod
 * stage (ADR-0007's window, R35); that clock is deleted, because the check's schedule rule is enabled only while
 * the sandbox is up for its PR ("The queue checks, sweeps, and reconciliations should only be enabled when the
 * sandbox is up for that PR"). So an invoked handler always reaches the database, at any hour on any stage.
 *
 * The lazy connection stays pinned: an idle `pg.Pool` opens a physical connection (TCP, TLS, IAM auth) on
 * `connect()`, so the connection belongs to the first READ rather than to the handler's entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock('../../common/db.js', () => ({ getRecipePool: () => ({ connect }) }));
vi.mock('../../common/queueEscalation.js', () => ({ escalate: vi.fn(), checkInQueueCheck: vi.fn() }));

import { handler, lazyReadSession } from '../queueCheck.js';

/** 01:00 in New York — an hour the handler used to refuse to run in on a non-prod stage. */
const SMALL_HOURS = new Date('2026-10-09T05:00:00Z');

/** A fake checked-out client that records what ran on it. */
function fakeClient() {
    return {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
    delete process.env['STAGE'];
});

describe('the scheduled recipe backstop handler', () => {
    it.each(['pr-91', 'sandbox', 'prod'])(
        '⛔ reaches the database at 01:00 New York on %s, and a failed connect fails the run',
        async (stage) => {
            vi.setSystemTime(SMALL_HOURS);
            process.env['STAGE'] = stage;
            const unreachable = Object.assign(new Error('connect ETIMEDOUT 10.1.4.241:5432'), { code: 'ETIMEDOUT' });
            connect.mockRejectedValue(unreachable);

            await expect(handler()).rejects.toBe(unreachable);

            expect(connect).toHaveBeenCalledTimes(1);
        },
    );
});

describe('lazyReadSession', () => {
    it('opens no connection until the first statement', () => {
        const open = vi.fn();

        lazyReadSession(open);

        expect(open).not.toHaveBeenCalled();
    });

    it('runs every statement on ONE connection, opened once', async () => {
        const client = fakeClient();
        const open = vi.fn().mockResolvedValue(client);
        const { session } = lazyReadSession(open);

        await session.query('BEGIN TRANSACTION READ ONLY');
        await session.query('SELECT 1', [1]);

        expect(open).toHaveBeenCalledTimes(1);
        expect(client.query.mock.calls).toEqual([
            ['BEGIN TRANSACTION READ ONLY', undefined],
            ['SELECT 1', [1]],
        ]);
    });

    it('opens once even when two statements race for the first connection', async () => {
        const client = fakeClient();
        const open = vi.fn().mockResolvedValue(client);
        const { session } = lazyReadSession(open);

        await Promise.all([session.query('SELECT 1'), session.query('SELECT 2')]);

        expect(open).toHaveBeenCalledTimes(1);
    });

    it('releases the connection exactly once on close', async () => {
        const client = fakeClient();
        const { session, close } = lazyReadSession(vi.fn().mockResolvedValue(client));

        await session.query('SELECT 1');
        await close();

        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('closes cleanly when no statement ever ran, opening nothing', async () => {
        const open = vi.fn();
        const { close } = lazyReadSession(open);

        await expect(close()).resolves.toBeUndefined();

        expect(open).not.toHaveBeenCalled();
    });

    it('closes cleanly after the connection itself failed, leaving the read to carry the error', async () => {
        const { session, close } = lazyReadSession(vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT')));

        await expect(session.query('SELECT 1')).rejects.toThrow('connect ETIMEDOUT');
        await expect(close()).resolves.toBeUndefined();
    });
});
