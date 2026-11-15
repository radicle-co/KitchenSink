/**
 * @module staticServer — the one loopback HTTP server both e2e hosts (the artifacts and the repo canvases) run on, and
 * the facts they share: content types and the instruction for a missing Design canvas runtime. Each host keeps its own
 * route table and hands it in as `respond`.
 */
import { createServer } from 'node:http';
import type { Server } from 'node:http';

/** What a route table answers. */
export interface StaticResponse {
    readonly status: number;
    readonly type: string;
    readonly body: Buffer | string;
}

/** A running server. */
export interface StaticServer {
    readonly origin: string;
    close(): Promise<void>;
}

export const TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ttf': 'font/ttf',
    '.jpg': 'image/jpeg',
    '.txt': 'text/plain; charset=utf-8',
};

/**
 * Starts a server on an ephemeral loopback port.
 *
 * @param respond - The host's route table.
 * @returns The origin and a `close`.
 * @sideEffect Opens a listening socket on 127.0.0.1.
 */
export async function startStaticServer(respond: (url: URL) => Promise<StaticResponse>): Promise<StaticServer> {
    const server: Server = createServer((request, response) => {
        respond(new URL(request.url ?? '/', 'http://127.0.0.1')).then(
            ({ status, type, body }) => {
                response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
                response.end(body);
            },
            (error: unknown) => {
                response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
                response.end(String(error));
            },
        );
    });

    await new Promise<void>((done, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', done);
    });

    const address = server.address();

    if (address === null || typeof address === 'string') {
        throw new Error('The static server did not bind a TCP port.');
    }

    return {
        origin: `http://127.0.0.1:${String(address.port)}`,
        close: () =>
            new Promise<void>((done, fail) => {
                server.close((error) => (error === undefined ? done() : fail(error)));
            }),
    };
}
