/**
 * The parse-job resource against a REAL, booted in-process HTTP server, driven through the client's REAL
 * transport (`ky` over the platform `fetch`, no injected double).
 *
 * ## What only this tier can prove, and why it is not ceremony here
 *
 * The unit suite (`__tests__/client.parseJobs.test.ts`) asserts the URL the client BUILDS. It cannot assert
 * the URL a server RECEIVES, and this resource is the one in the package where those can differ: it is the
 * only endpoint whose path carries a NUMBER (`/lines/{lineIndex}`), it is the only one whose id is a real
 * UUID rather than a loose token, and it is the only one where a `202` — not a `200`/`201` — decides
 * whether the client parses the body or throws. Each of those has exactly one shape on the wire, and a
 * mocked `fetch` agrees with whatever the client did.
 *
 * The `PATCH` also proves the body actually STREAMS: `ky` serializes the JSON, and a mocked fetch never
 * exercises that path (the unit tier reads a cloned request, not a socket).
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CONTRACT_HASH } from '@kitchensink/schema-recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NotFoundError, ParseJobExpiredError, RecipeServiceClient } from '../index.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';
import { FIXTURE_PARSE_JOB_UUID, makeCompleteParseJob, makeParseJob } from '../__fixtures__/parseJobs.js';

/** A single request as observed on the server socket. */
interface ReceivedRequest {
    readonly method: string;
    readonly url: string;
    readonly body: string;
}

/** A programmable response the test server returns for the Nth request (last entry repeats). */
interface CannedResponse {
    readonly status: number;
    readonly json?: unknown;
}

/** A booted test server: its base URL, the API requests it received (in order), and a shutdown hook. */
interface TestServer {
    readonly baseUrl: string;
    readonly received: ReceivedRequest[];
    close(): Promise<void>;
}

/** Read a request's full body off the socket as a UTF-8 string. */
async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }

    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Boot a real HTTP server answering each request with the next {@link CannedResponse} (the last repeats).
 *
 * `/health` is the drift-layer-3 skew probe and is answered OUT OF BAND — outside the canned sequence and
 * outside `received` — for the reason the sibling integration spec records: letting it consume a queued
 * response would silently shift every sequenced scenario by one.
 *
 * @sideEffect Opens a listening TCP socket on an ephemeral localhost port.
 */
async function startServer(responses: readonly CannedResponse[]): Promise<TestServer> {
    const received: ReceivedRequest[] = [];
    let i = 0;

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async (): Promise<void> => {
            const body = await readBody(req);
            const url = req.url ?? '';

            if (url === '/health') {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', service: 'recipe', contractHash: CONTRACT_HASH }));

                return;
            }

            received.push({ method: req.method ?? '', url, body });

            const canned = responses[Math.min(i, responses.length - 1)]!;
            i += 1;
            res.writeHead(canned.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(canned.json ?? {}));
        })();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        received,
        close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
}

describe('parse jobs (integration, real HTTP server)', () => {
    let server: TestServer | undefined;

    beforeEach(() => {
        resetContractSkewLatchForTests();
    });

    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    /** A client over the real transport — no fetch double anywhere in this file. */
    function clientFor(booted: TestServer): RecipeServiceClient {
        return new RecipeServiceClient({ baseUrl: booted.baseUrl, token: 'tok' });
    }

    it('creates a job: the pasted text arrives as a streamed JSON body and the 202 view round-trips', async () => {
        const job = makeParseJob();
        server = await startServer([{ status: 202, json: job }]);

        const result = await clientFor(server).createParseJob({ text: '2 cups flour\n1 tsp salt' });

        expect(result).toEqual(job);
        expect(server.received).toHaveLength(1);
        expect(server.received[0]?.method).toBe('POST');
        expect(server.received[0]?.url).toBe('/api/v1/recipe-parse-jobs');
        expect(JSON.parse(server.received[0]?.body ?? '')).toEqual({ text: '2 cups flour\n1 tsp salt' });
    });

    it('reads a job at the UUID path the service routes — no escaping surprises on the socket', async () => {
        const job = makeCompleteParseJob();
        server = await startServer([{ status: 200, json: job }]);

        const result = await clientFor(server).getParseJob(FIXTURE_PARSE_JOB_UUID);

        expect(result).toEqual(job);
        expect(server.received[0]?.url).toBe(`/api/v1/recipe-parse-jobs/${FIXTURE_PARSE_JOB_UUID}`);
    });

    it('edits a line at the NUMERIC path segment the controller parses with ParseIntPipe', async () => {
        // ⛔ The one URL in this package that interpolates a number. A stringification that produced
        // `1e21`, `NaN`, or a `+`-escaped segment would be a 400 the unit tier cannot see, because a mocked
        // fetch reflects whatever string the client built.
        const job = makeParseJob();
        server = await startServer([{ status: 202, json: job }]);

        await clientFor(server).editParseJobLine(FIXTURE_PARSE_JOB_UUID, 17, { sourceLine: '1 tsp salt' });

        expect(server.received[0]?.method).toBe('PATCH');
        expect(server.received[0]?.url).toBe(`/api/v1/recipe-parse-jobs/${FIXTURE_PARSE_JOB_UUID}/lines/17`);
        expect(JSON.parse(server.received[0]?.body ?? '')).toEqual({ sourceLine: '1 tsp salt' });
    });

    it('retries at the job-scoped subresource', async () => {
        server = await startServer([{ status: 202, json: makeParseJob() }]);

        await clientFor(server).retryParseJob(FIXTURE_PARSE_JOB_UUID);

        expect(server.received[0]?.method).toBe('POST');
        expect(server.received[0]?.url).toBe(`/api/v1/recipe-parse-jobs/${FIXTURE_PARSE_JOB_UUID}/retry`);
        expect(server.received[0]?.body).toBe('');
    });

    it('maps a real 409 PARSE_JOB_EXPIRED response body to the typed expiry error', async () => {
        server = await startServer([
            { status: 409, json: { code: 'PARSE_JOB_EXPIRED', message: 'Parse job expired.' } },
        ]);

        await expect(clientFor(server).retryParseJob(FIXTURE_PARSE_JOB_UUID)).rejects.toBeInstanceOf(
            ParseJobExpiredError,
        );
    });

    it('maps a real 404 PARSE_JOB_NOT_FOUND response body to NotFoundError', async () => {
        server = await startServer([
            { status: 404, json: { code: 'PARSE_JOB_NOT_FOUND', message: 'Parse job not found.' } },
        ]);

        await expect(clientFor(server).getParseJob(FIXTURE_PARSE_JOB_UUID)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('refuses a 200 where the contract says 202 — the accepted status is part of the contract', async () => {
        // The three writes answer `202` because they re-open asynchronous work. A service that started
        // answering `200` has changed its meaning (the work is done, not accepted), and this client must
        // notice rather than silently treat one as the other.
        server = await startServer([{ status: 200, json: makeParseJob() }]);

        await expect(clientFor(server).createParseJob({ text: '2 cups flour' })).rejects.toThrow();
    });
});
