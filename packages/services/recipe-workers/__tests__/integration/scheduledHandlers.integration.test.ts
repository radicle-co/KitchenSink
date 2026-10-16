import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { handler as erasureOrphanSweeper } from '../../src/handlers/erasureOrphanSweeper.js';
import { handler as erasureSweeper } from '../../src/handlers/erasureSweeper.js';
import { handler as queueCheck } from '../../src/handlers/queueCheck.js';

/**
 * The frequently-scheduled handlers reach the database WHENEVER THEY ARE INVOKED, through the REAL `pg` pool to a
 * socket.
 *
 * ⛔ REWRITTEN (owner ruling 2026-10-12). This suite used to prove the opposite: that on a non-prod stage between
 * 00:00 and 09:00 ET the handlers stood down and opened NO connection, because an idle `pg.Pool` dials the
 * database on `connect()` and ADR-0007 had stopped it. The clock is deleted. A non-prod scheduled rule is
 * switched on only while its sandbox is up ("The queue checks, sweeps, and reconciliations should only be
 * enabled when the sandbox is up for that PR"), so the handler no longer decides from the hour whether to run.
 *
 * The unit suites mock `getRecipePool`/`getRecipeDb`, so they can only show the handler CALLED them. This one
 * points the real pool at a TCP listener standing in for the database and counts the connections that reach it:
 * at least one at every hour, on every stage. A clock gate re-added anywhere in a handler's path turns the 01:00
 * New York cases red.
 */
let listener: Server;
let connections = 0;
const sockets = new Set<Socket>();

/** 01:00 in New York — an hour the handlers used to refuse to run in on a non-prod stage. */
const SMALL_HOURS = new Date('2026-10-09T05:00:00Z');

/** 11:00 in New York. */
const MIDDAY = new Date('2026-10-09T15:00:00Z');

beforeAll(async () => {
    listener = createServer((socket) => {
        connections += 1;
        sockets.add(socket);
        // Refuse the startup at once: the run fails fast instead of waiting out a connect timeout.
        socket.destroy();
    });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));

    process.env['RECIPE_DB_HOST'] = '127.0.0.1';
    process.env['RECIPE_DB_PORT'] = String((listener.address() as AddressInfo).port);
    process.env['RECIPE_DB_NAME'] = 'kitchensink_recipes_pr_91';
    process.env['STAGE'] = 'pr-91';
    process.env['ACCOUNT_ERASURE_QUEUE_URL'] = 'https://sqs.us-east-1.amazonaws.com/000000000000/erasure';
    process.env['RECIPE_ARCHIVE_BUCKET'] = 'archive';
    process.env['RECIPE_MEDIA_BUCKET'] = 'media';
    // A deployed stage always carries the media distribution id (ADR-0064); without it the sweeper refuses to start.
    process.env['CLOUDFRONT_DISTRIBUTION_ID'] = 'E2TESTDISTRIBUTION';
});

afterAll(async () => {
    for (const socket of sockets) {
        socket.destroy();
    }

    await new Promise<void>((resolve) => listener.close(() => resolve()));
});

beforeEach(() => {
    connections = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('frequently-scheduled handlers', () => {
    describe.each([
        ['01:00 New York', SMALL_HOURS],
        ['11:00 New York', MIDDAY],
    ])('at %s', (_label, at) => {
        it.each([
            ['queue check', queueCheck],
            ['erasure sweeper', erasureSweeper],
            ['erasure orphan sweeper', erasureOrphanSweeper],
        ])('⛔ the %s reaches the database, and the refused connection fails the run', async (_name, run) => {
            vi.setSystemTime(at);

            await expect(run()).rejects.toThrow();

            expect(connections).toBeGreaterThan(0);
        });
    });
});
