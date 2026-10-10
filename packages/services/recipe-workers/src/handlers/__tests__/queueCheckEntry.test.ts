/**
 * The recipe backstop's ENTRY POINT and its connection — R35 at the handler, not only inside the check.
 *
 * ⛔ WHY THIS SUITE EXISTS. `runRecipeQueueCheck` honoured the nightly window, but the handler that called it
 * took a pooled connection FIRST, on the claim that `pool.connect()` on an idle pool was a local handshake. It
 * is not: an idle `pg.Pool` opens a physical connection (TCP, TLS, IAM auth). So every five minutes of
 * ADR-0007's stop window, on every non-prod stage, the handler dialled a stopped database and failed — 255 of
 * 255 invocations on pr-91 between 04:05 and 11:10 UTC on 2026-10-08 — invisibly, because the NAT instance that
 * carries Sentry traffic is stopped in the same window. These cases pin the connection to the first READ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock('../../common/db.js', () => ({ getRecipePool: () => ({ connect }) }));
vi.mock('../../common/queueEscalation.js', () => ({ escalate: vi.fn(), checkInQueueCheck: vi.fn() }));

import { handler, lazyReadSession } from '../queueCheck.js';

/** 01:00 in New York — inside ADR-0007's nightly stop. */
const ASLEEP = new Date('2026-10-09T05:00:00Z');

/** 11:00 in New York — the stage is awake. */
const AWAKE = new Date('2026-10-09T15:00:00Z');

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
    it('does not touch the database while a non-prod stage is asleep', async () => {
        vi.setSystemTime(ASLEEP);
        process.env['STAGE'] = 'pr-91';

        await expect(handler()).resolves.toBeUndefined();

        expect(connect).not.toHaveBeenCalled();
    });

    it('reaches the database while the stage is awake, and a failed connect still fails the run', async () => {
        vi.setSystemTime(AWAKE);
        process.env['STAGE'] = 'pr-91';
        const unreachable = Object.assign(new Error('connect ETIMEDOUT 10.1.4.241:5432'), { code: 'ETIMEDOUT' });
        connect.mockRejectedValue(unreachable);

        await expect(handler()).rejects.toBe(unreachable);

        expect(connect).toHaveBeenCalledTimes(1);
    });

    it('reaches the database at night on prod, which never sleeps', async () => {
        vi.setSystemTime(ASLEEP);
        process.env['STAGE'] = 'prod';
        connect.mockRejectedValue(new Error('stop here'));

        await expect(handler()).rejects.toThrow('stop here');

        expect(connect).toHaveBeenCalledTimes(1);
    });
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
