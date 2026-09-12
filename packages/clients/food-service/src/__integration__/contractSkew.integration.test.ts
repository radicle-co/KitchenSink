/**
 * DRIFT LAYER 3 (Skew) over a REAL socket — `docs/CODING_STANDARDS.md` §15.2.5, owner ruling 2026-08-11: a
 * contract-hash mismatch WARNS and the call proceeds normally.
 *
 * Integration tier for `@kitchensink/food-service-client`: a REAL booted `node:http` server driven through the
 * client's REAL transport (the platform global `fetch`, with NO injected double). This proves what a mocked
 * `fetch` cannot:
 *
 *   - the skew check is a genuinely SEPARATE request on the wire — `GET /health`, with no `Authorization`;
 *   - the caller's own API request completes normally and unchanged while a mismatch is being reported;
 *   - the fingerprint survives a real JSON round-trip (so the comparison is against bytes, not a stub);
 *   - the probe is fired at most ONCE per origin no matter how many requests or clients pass through — the
 *     property that keeps it off the recipe service's per-keystroke ingredient path, where a client is minted
 *     per keystroke.
 *
 * Self-contained (no Docker, no external service) and runs in CI via `npm run test:integration`.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CONTRACT_HASH } from '@kitchensink/schema-food';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FoodServiceClient } from '../index.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';

/** A well-formed fingerprint that is deliberately NOT this client's pinned one. */
const FOREIGN_HASH = 'e'.repeat(64);

/**
 * What the server answers on `GET /health`.
 *
 * `'agree'` publishes the client's own fingerprint, `'skewed'` a different well-formed one, and `'absent'`
 * omits the field — which is exactly what a food service deployed BEFORE publication serves, and must resolve
 * to silence rather than a false mismatch.
 */
type HealthPosture = 'agree' | 'skewed' | 'absent';

/** A single request as observed on the server socket. */
interface ReceivedRequest {
    readonly method: string;
    readonly url: string;
    readonly authorization: string | undefined;
}

/** A booted test server: base URL, the API + health requests it saw, and a shutdown hook. */
interface TestServer {
    readonly baseUrl: string;
    /** API requests only (everything that is not the `/health` skew probe). */
    readonly received: ReceivedRequest[];
    /** The `/health` skew probes this server answered. */
    readonly healthProbes: ReceivedRequest[];
    close(): Promise<void>;
}

/** The `/health` body for a posture. */
function healthBody(posture: HealthPosture): Record<string, string> {
    const base = { status: 'ok', service: 'food' };

    if (posture === 'absent') {
        return base;
    }

    return { ...base, contractHash: posture === 'skewed' ? FOREIGN_HASH : CONTRACT_HASH };
}

/**
 * Boot a real HTTP server that answers `/health` per `posture` and every other path with a fixed food search
 * result, recording what it received.
 *
 * @sideEffect Opens a listening TCP socket on an ephemeral localhost port.
 */
async function startServer(posture: HealthPosture): Promise<TestServer> {
    const received: ReceivedRequest[] = [];
    const healthProbes: ReceivedRequest[] = [];

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const observed: ReceivedRequest = {
            method: req.method ?? '',
            url: req.url ?? '',
            authorization: req.headers['authorization'],
        };

        // Drain the request so the socket is not left half-read.
        req.resume();

        const isHealth = observed.url === '/health';
        (isHealth ? healthProbes : received).push(observed);

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(isHealth ? healthBody(posture) : { results: [] }));
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        received,
        healthProbes,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            }),
    };
}

describe('FoodServiceClient contract skew (integration, real HTTP server)', () => {
    let server: TestServer | undefined;

    // Each test gets a fresh ephemeral port (so a fresh origin), but resetting the once-per-origin latch makes
    // that an explicit guarantee rather than a side effect of port allocation.
    beforeEach(() => {
        resetContractSkewLatchForTests();
    });

    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    it('probes /health over the wire, unauthenticated, and warns once on a real mismatch', async () => {
        server = await startServer('skewed');
        const onContractSkew = vi.fn();
        const client = new FoodServiceClient({ baseUrl: server.baseUrl, token: 'tok-int', onContractSkew });

        // THE ruling: the caller's call is entirely unaffected.
        await expect(client.search('kale')).resolves.toEqual({ results: [] });

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        expect(server.healthProbes).toHaveLength(1);
        expect(server.healthProbes[0]!.method).toBe('GET');
        // The API request carried the bearer token; the probe deliberately did not. `/health` is public so a
        // consumer can ask about skew before it holds a credential.
        expect(server.received[0]!.authorization).toBe('Bearer tok-int');
        expect(server.healthProbes[0]!.authorization).toBeUndefined();

        const message = onContractSkew.mock.calls[0]?.[0] as string;
        expect(message).toContain(FOREIGN_HASH.slice(0, 12));
        expect(message).toContain(CONTRACT_HASH.slice(0, 12));
    });

    it('stays silent when the real service publishes an agreeing fingerprint', async () => {
        server = await startServer('agree');
        const onContractSkew = vi.fn();
        const client = new FoodServiceClient({ baseUrl: server.baseUrl, onContractSkew });

        await client.search('kale');
        await vi.waitFor(() => {
            expect(server?.healthProbes).toHaveLength(1);
        });

        expect(onContractSkew).not.toHaveBeenCalled();
    });

    // A real service deployed before publication existed. Silence, not noise — otherwise every
    // pre-publication deployment warns and the signal gets muted.
    it('stays silent when the real service publishes no fingerprint at all', async () => {
        server = await startServer('absent');
        const onContractSkew = vi.fn();
        const client = new FoodServiceClient({ baseUrl: server.baseUrl, onContractSkew });

        await client.search('kale');
        await vi.waitFor(() => {
            expect(server?.healthProbes).toHaveLength(1);
        });

        expect(onContractSkew).not.toHaveBeenCalled();
    });

    // The per-keystroke case, for real: the recipe service's `FoodServiceClients` factory mints a NEW client
    // per keystroke, so "once per client instance" would be once per keystroke. This asserts once per ORIGIN.
    it('probes ONCE across many real requests from many separately-constructed clients', async () => {
        server = await startServer('skewed');
        const onContractSkew = vi.fn();
        const baseUrl = server.baseUrl;

        for (let n = 0; n < 6; n += 1) {
            await new FoodServiceClient({ baseUrl, onContractSkew }).search(`kale-${String(n)}`);
        }

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        expect(server.received).toHaveLength(6);
        expect(server.healthProbes).toHaveLength(1);
    });

    // A skew warning must not become an outage. Even when the probe cannot complete — here the server is gone —
    // the client's own calls keep working, and nothing is logged.
    it('keeps serving normally, silently, when the probe cannot reach anything', async () => {
        server = await startServer('skewed');
        const onContractSkew = vi.fn();
        const client = new FoodServiceClient({ baseUrl: server.baseUrl, onContractSkew });
        const deadOriginClient = new FoodServiceClient({
            // A port nothing is listening on: the probe's own fetch will fail outright.
            baseUrl: 'http://127.0.0.1:1',
            onContractSkew,
        });

        await expect(deadOriginClient.search('kale')).rejects.toThrow();
        await expect(client.search('kale')).resolves.toEqual({ results: [] });

        await vi.waitFor(() => {
            expect(onContractSkew).toHaveBeenCalledTimes(1);
        });
        // Exactly one warning — from the reachable origin. The dead origin produced silence, not a second
        // warning and not an unhandled rejection.
        expect(onContractSkew).toHaveBeenCalledTimes(1);
    });
});
