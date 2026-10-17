// @vitest-environment node
/**
 * `postEnvelope`: the one bounded POST of one envelope, shared by the silent-no-op reporter (which swallows a
 * failure by design) and the alarm relay (which must not). It returns `true` ONLY for a 2xx and never throws, so each
 * caller decides what a failure means; the answer itself must be exact.
 *
 * ⛔ Against a real local HTTP server, not a mocked `fetch`: a mock answers the question the test author asked it, and
 * the failures that matter here (a refused connection, a stalled socket, a 5xx, a redirect) are transport behaviour.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { parseDsn, postEnvelope } from '../src/observability/sentryEnvelope.js';

interface Received {
    readonly method: string | undefined;
    readonly url: string | undefined;
    readonly headers: IncomingMessage['headers'];
    readonly body: string;
}

let server: Server | undefined;

afterEach(async () => {
    const closing = server;

    server = undefined;

    if (closing !== undefined) {
        closing.closeAllConnections();
        await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
});

/** Start a stand-in that records the request and answers with `respond`. */
async function listen(respond: (request: IncomingMessage, body: string) => { status: number } | 'stall'): Promise<{
    target: { url: string; key: string };
    received: Received[];
}> {
    const received: Received[] = [];

    server = createServer((request, response) => {
        const chunks: Buffer[] = [];

        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');

            received.push({ method: request.method, url: request.url, headers: request.headers, body });

            const answer = respond(request, body);

            if (answer !== 'stall') {
                response.statusCode = answer.status;
                response.end('{}');
            }
        });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));

    const address = server?.address() as AddressInfo | undefined;

    if (address === undefined) {
        throw new Error('the stand-in Sentry server did not start');
    }

    const { port } = address;
    const target = parseDsn(`http://publickey@127.0.0.1:${String(port)}/7`);

    expect(target).toBeDefined();

    return { target: target as { url: string; key: string }, received };
}

describe('postEnvelope', () => {
    it('POSTs the body to the ingest URL as a Sentry envelope, authenticated by the DSN key', async () => {
        const { target, received } = await listen(() => ({ status: 200 }));

        await expect(postEnvelope(target, 'ENVELOPE-BODY', 2_000)).resolves.toBe(true);
        expect(received).toHaveLength(1);
        expect(received[0]).toMatchObject({ method: 'POST', url: '/api/7/envelope/', body: 'ENVELOPE-BODY' });
        expect(received[0]?.headers['content-type']).toBe('application/x-sentry-envelope');
        expect(received[0]?.headers['x-sentry-auth']).toBe('Sentry sentry_version=7, sentry_key=publickey');
    });

    it.each([200, 202, 204])('answers true for %i', async (status) => {
        const { target } = await listen(() => ({ status }));

        await expect(postEnvelope(target, 'x', 2_000)).resolves.toBe(true);
    });

    it.each([400, 401, 403, 413, 429, 500, 503])(
        '⛔ answers false for %i: a resolved response is not a delivery',
        async (status) => {
            const { target } = await listen(() => ({ status }));

            await expect(postEnvelope(target, 'x', 2_000)).resolves.toBe(false);
        },
    );

    it('answers false, not a throw, when nothing is listening', async () => {
        const { target } = await listen(() => ({ status: 200 }));

        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = undefined;

        await expect(postEnvelope(target, 'x', 2_000)).resolves.toBe(false);
    });

    it('⛔ answers false when the server stalls past the deadline, and does not wait for it', async () => {
        const { target } = await listen(() => 'stall');
        const started = Date.now();

        await expect(postEnvelope(target, 'x', 150)).resolves.toBe(false);
        expect(Date.now() - started).toBeLessThan(2_000);
    });
});
