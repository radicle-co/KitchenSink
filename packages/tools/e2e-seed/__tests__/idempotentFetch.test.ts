/**
 * The seed tool's one transport seam: a GET that meets a gateway blip (502/503/504) or a network failure is repeated,
 * and nothing else ever is. The bug it closes: one `502` from the gateway in front of the single recipe task, while 13
 * shards reset at once, stopped a whole Maestro shard before its first flow.
 *
 * Every test drives the REAL wrapper over a scripted base `fetch`; delays are injected so nothing sleeps.
 */
import { describe, expect, it, vi } from 'vitest';

import { idempotentRetryFetch } from '../src/idempotentFetch.js';

type Script = ReadonlyArray<Response | Error>;

function scripted(script: Script): { readonly fetch: typeof fetch; readonly calls: () => number } {
    let index = 0;
    const fn = vi.fn((): Promise<Response> => {
        const step = script[Math.min(index, script.length - 1)];
        index += 1;

        return step instanceof Error ? Promise.reject(step) : Promise.resolve(step!.clone());
    });

    return { fetch: fn as unknown as typeof fetch, calls: () => fn.mock.calls.length };
}

const respond = (status: number, headers?: Record<string, string>): Response =>
    new Response(status === 200 ? '{}' : 'no', { status, headers });

const fast = { minTimeoutMs: 0, maxTimeoutMs: 0 };

describe('idempotentRetryFetch', () => {
    it.each([502, 503, 504])('repeats a GET answered %i and returns the later answer', async (status) => {
        const base = scripted([respond(status), respond(200)]);
        const response = await idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a');

        expect(response.status).toBe(200);
        expect(base.calls()).toBe(2);
    });

    it('repeats a HEAD', async () => {
        const base = scripted([respond(502), respond(200)]);
        const response = await idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a', {
            method: 'HEAD',
        });

        expect(response.status).toBe(200);
        expect(base.calls()).toBe(2);
    });

    it('repeats a GET carried by a Request object', async () => {
        const base = scripted([respond(502), respond(200)]);
        const response = await idempotentRetryFetch({ base: base.fetch, ...fast })(new Request('https://x.test/a'));

        expect(response.status).toBe(200);
        expect(base.calls()).toBe(2);
    });

    it('gives up after five attempts and hands back the last gateway answer for the client to classify', async () => {
        const base = scripted([respond(503)]);
        const response = await idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a');

        expect(response.status).toBe(503);
        expect(base.calls()).toBe(5);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('never repeats a %s', async (method) => {
        const base = scripted([respond(502), respond(200)]);
        const response = await idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a', { method });

        expect(response.status).toBe(502);
        expect(base.calls()).toBe(1);
    });

    it('never repeats a non-idempotent Request object', async () => {
        const base = scripted([respond(502), respond(200)]);
        const response = await idempotentRetryFetch({ base: base.fetch, ...fast })(
            new Request('https://x.test/a', { method: 'POST', body: '{}' }),
        );

        expect(response.status).toBe(502);
        expect(base.calls()).toBe(1);
    });

    it.each([400, 401, 404, 409, 429, 500, 501])('does not repeat a GET answered %i', async (status) => {
        const base = scripted([respond(status), respond(200)]);
        const response = await idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a');

        expect(response.status).toBe(status);
        expect(base.calls()).toBe(1);
    });

    it('repeats a GET after a network failure', async () => {
        const base = scripted([new TypeError('fetch failed'), respond(200)]);
        const response = await idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a');

        expect(response.status).toBe(200);
        expect(base.calls()).toBe(2);
    });

    it('rethrows a persistent network failure after the bound', async () => {
        const base = scripted([new TypeError('fetch failed')]);

        await expect(idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a')).rejects.toThrow(
            'fetch failed',
        );
        expect(base.calls()).toBe(5);
    });

    it('never repeats a POST that fails on the network', async () => {
        const base = scripted([new TypeError('fetch failed'), respond(200)]);

        await expect(
            idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a', { method: 'POST' }),
        ).rejects.toThrow('fetch failed');
        expect(base.calls()).toBe(1);
    });

    it('does not repeat a GET whose own deadline has aborted it', async () => {
        const base = scripted([new DOMException('timed out', 'TimeoutError'), respond(200)]);
        const controller = new AbortController();
        controller.abort();

        await expect(
            idempotentRetryFetch({ base: base.fetch, ...fast })('https://x.test/a', { signal: controller.signal }),
        ).rejects.toThrow('timed out');
        expect(base.calls()).toBe(1);
    });

    it('waits out Retry-After beyond the backoff, bounded by maxRetryAfterMs', async () => {
        const sleep = vi.fn((): Promise<void> => Promise.resolve());
        const base = scripted([
            respond(503, { 'retry-after': '2' }),
            respond(503, { 'retry-after': '99' }),
            respond(200),
        ]);

        await idempotentRetryFetch({ base: base.fetch, ...fast, sleep, maxRetryAfterMs: 5_000 })('https://x.test/a');

        expect(sleep.mock.calls).toEqual([[2_000], [5_000]]);
    });

    it('does not sleep when the response states no Retry-After', async () => {
        const sleep = vi.fn((): Promise<void> => Promise.resolve());
        const base = scripted([respond(502), respond(200)]);

        await idempotentRetryFetch({ base: base.fetch, ...fast, sleep })('https://x.test/a');

        expect(sleep).not.toHaveBeenCalled();
    });
});
