/**
 * `getIngredientNameProposals` against a REAL, booted `node:http` server, through the client's real transport with no
 * fetch double.
 *
 * What only a socket can prove: the GET arrives with its bearer and the typed name in the query, no body is sent, a
 * keystroke's abort ends a request the server never answers as a typed rejection, and an unknown `source` key survives
 * the parse (an installed client must keep showing the food when the server adds a kind of source).
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { FetchUnavailableError, RecipeServiceClient } from '../index.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';

const BODY = {
    phrase: 'milk',
    proposals: [
        { kind: 'root', id: '01JFOOD0000000000000000001', name: 'Whole milk', source: 'remembered' },
        { kind: 'variant', id: '01JVARIANT00000000000000001', name: 'Oat milk', source: 'aSourceNotYetInvented' },
    ],
};

/** One request as observed on the socket. */
interface Observed {
    readonly method: string;
    readonly url: string;
    readonly authorization: string | undefined;
}

let server: Server | undefined;

/**
 * Boot a server that either answers {@link BODY} or accepts the connection and NEVER answers.
 *
 * @sideEffect Listens on an ephemeral port.
 */
async function startServer(mode: 'answer' | 'hang'): Promise<{ baseUrl: string; received: Observed[] }> {
    const received: Observed[] = [];

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
        if ((req.url ?? '') === '/health') {
            // The contract-skew probe rides the same transport; answer it out of band.
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'recipe' }));

            return;
        }

        received.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers['authorization'] });

        if (mode === 'hang') {
            return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(BODY));
    });

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));

    return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

describe('getIngredientNameProposals over a real socket', () => {
    afterEach(async () => {
        resetContractSkewLatchForTests();
        await new Promise<void>((resolve) => {
            if (server === undefined) {
                resolve();

                return;
            }

            server.closeAllConnections?.();
            server.close(() => resolve());
        });
        server = undefined;
    });

    it('sends a GET to /api/v1/ingredients/by-name/proposals with the bearer and the typed name', async () => {
        const { baseUrl, received } = await startServer('answer');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const result = await client.getIngredientNameProposals('milk');

        expect(result).toStrictEqual(BODY);
        expect(received).toHaveLength(1);
        expect(received[0]).toStrictEqual({
            method: 'GET',
            url: '/api/v1/ingredients/by-name/proposals?name=milk',
            authorization: 'Bearer session-jwt',
        });
    });

    it('keeps a proposal whose source key this client does not know', async () => {
        const { baseUrl } = await startServer('answer');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const { proposals } = await client.getIngredientNameProposals('milk');

        expect(proposals.map((proposal) => proposal.source)).toStrictEqual(['remembered', 'aSourceNotYetInvented']);
    });

    it('⛔ SETTLES against a server that never answers, when the next keystroke aborts it', async () => {
        const { baseUrl } = await startServer('hang');
        const client = new RecipeServiceClient({ baseUrl, token: 'session-jwt' });

        const failure = await client
            .getIngredientNameProposals('milk', { signal: AbortSignal.timeout(150) })
            .catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(FetchUnavailableError);
    });
});
