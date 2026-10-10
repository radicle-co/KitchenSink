import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { handler as bandDrain } from '../../src/handlers/bandDrain.js';
import { handler as erasureOrphanSweeper } from '../../src/handlers/erasureOrphanSweeper.js';
import { handler as erasureSweeper } from '../../src/handlers/erasureSweeper.js';
import { handler as queueCheck } from '../../src/handlers/queueCheck.js';

/**
 * The frequently-scheduled handlers and ADR-0007's nightly window, through the REAL `pg` pool to a socket.
 *
 * ⛔ The unit suites mock `getRecipePool`/`getRecipeDb`, so they can only show the handler did not CALL them.
 * The defect this guards lived one layer down: the queue check took `pool.connect()` before its window check on
 * the belief that an idle pool connects locally. It does not — it dials the database. So this suite points the
 * real pool at a TCP listener standing in for the database and counts the connections that reach it: none at
 * night on a non-prod stage, at least one in the awake day (which is what keeps the night assertion from passing
 * against a listener nothing could have reached).
 */
let listener: Server;
let connections = 0;
const sockets = new Set<Socket>();

/** 01:00 in New York — inside ADR-0007's nightly stop. */
const ASLEEP = new Date('2026-10-09T05:00:00Z');

/** 11:00 in New York — the stage is awake. */
const AWAKE = new Date('2026-10-09T15:00:00Z');

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

describe('frequently-scheduled handlers in the nightly window', () => {
    it.each([
        ['queue check', queueCheck],
        ['erasure sweeper', erasureSweeper],
        ['erasure orphan sweeper', erasureOrphanSweeper],
        ['band drain', bandDrain],
    ])('the %s opens no database connection while a non-prod stage is asleep', async (_name, run) => {
        vi.setSystemTime(ASLEEP);

        await expect(run()).resolves.toBeUndefined();

        expect(connections).toBe(0);
    });

    it.each([
        ['queue check', queueCheck],
        ['erasure sweeper', erasureSweeper],
    ])('the %s reaches the database in the awake day, and the refused connection fails the run', async (_name, run) => {
        vi.setSystemTime(AWAKE);

        await expect(run()).rejects.toThrow();

        expect(connections).toBeGreaterThan(0);
    });
});
