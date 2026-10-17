// @vitest-environment node
/**
 * A Vercel read that is never answered must end, not hang the deployed web tier's preflight.
 *
 * `fetch` has no timeout of its own: a server that accepts the connection and goes silent holds the caller for the
 * OS's idle limit (minutes). The unit doubles in `previewCurrency.test.ts` answer instantly, so they cannot see
 * this; the proof needs a REAL socket that never writes, driven through the real `fetch`.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readServedDeployment, VERCEL_READ_DEADLINE_MS } from '../previewCurrency';
import type { HttpSender } from '../previewDomainScope';

const ZONE = 'sandbox.commise.app';
const HOST = 'pr-91.sandbox.commise.app';

let server: Server;
let origin: string;

beforeAll(async () => {
    // Accepts the request and never answers.
    server = createServer(() => undefined);
    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
        server.close(() => {
            resolve();
        });
    });
});

/** `globalThis.fetch`, with the Vercel API origin pointed at the silent server. */
const fetchToSilentServer: HttpSender = (url, init) => fetch(url.replace('https://api.vercel.com', origin), init);

describe('readServedDeployment — a silent server', () => {
    it('⛔ answers `failed` within the deadline instead of waiting for the socket', async () => {
        const started = Date.now();

        const reading = await readServedDeployment(
            fetchToSilentServer,
            { token: 'tok', projectId: 'prj_x' },
            HOST,
            ZONE,
            150,
        );

        expect(reading.kind).toBe('failed');
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('bounds every attempt by the house 15 s deadline when none is given', () => {
        expect(VERCEL_READ_DEADLINE_MS).toBe(15_000);
    });
});
