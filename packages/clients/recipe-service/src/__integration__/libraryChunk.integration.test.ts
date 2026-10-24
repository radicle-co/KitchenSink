/**
 * The library read against a REAL in-process HTTP server, through the client's REAL transport: the pages a chunk asks
 * for arrive on the socket as `page`, `pageSize=100` and `sortBy` query parameters the endpoint parses, the JSON of every
 * page is validated by the client's own response schema, and the chunk joins them in the server's order. A unit test
 * with a fake `listRecipes` cannot see the query string or the response validation.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CONTRACT_HASH } from '@kitchensink/schema-recipe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RecipeServiceClient } from '../index.js';
import { resetContractSkewLatchForTests } from '../contractSkew.js';
import { fetchLibraryChunk } from '../libraryChunk.js';
import { makeRecipe } from '../__fixtures__/recipes.js';

/** A server holding `total` recipes behind `GET /api/v1/recipes`, paging like the real endpoint. */
async function startLibrary(total: number): Promise<{ baseUrl: string; urls: string[]; close: () => Promise<void> }> {
    const recipes = Array.from({ length: total }, (_unused, index) =>
        makeRecipe({ id: `rec_${String(index).padStart(4, '0')}` }),
    );
    const urls: string[] = [];
    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname === '/health') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'recipe', contractHash: CONTRACT_HASH }));

            return;
        }

        urls.push(req.url ?? '');
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
        const start = (page - 1) * pageSize;
        const data = recipes.slice(start, start + pageSize);

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data, total, page, pageSize, hasMore: start + data.length < total }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        urls,
        close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
}

describe('fetchLibraryChunk (integration, real HTTP server)', () => {
    let close: (() => Promise<void>) | undefined;

    beforeEach(() => {
        resetContractSkewLatchForTests();
    });

    afterEach(async () => {
        await close?.();
        close = undefined;
    });

    it('reads a 230-recipe library in one chunk of three full-size pages, in the server’s order', async () => {
        const library = await startLibrary(230);
        close = library.close;
        const client = new RecipeServiceClient({ baseUrl: library.baseUrl, fetch });

        const chunk = await fetchLibraryChunk(client, { firstPage: 1, sortBy: 'title' });

        expect(chunk.data).toHaveLength(230);
        expect(chunk.data[0]?.id).toBe('rec_0000');
        expect(chunk.data[229]?.id).toBe('rec_0229');
        expect(chunk.hasMore).toBe(false);
        expect([...library.urls].sort()).toEqual([
            '/api/v1/recipes?page=1&pageSize=100&sortBy=title',
            '/api/v1/recipes?page=2&pageSize=100&sortBy=title',
            '/api/v1/recipes?page=3&pageSize=100&sortBy=title',
        ]);
    });

    it('stops a 612-recipe library at 500 and reads the rest as the next chunk', async () => {
        const library = await startLibrary(612);
        close = library.close;
        const client = new RecipeServiceClient({ baseUrl: library.baseUrl, fetch });

        const first = await fetchLibraryChunk(client, { firstPage: 1 });
        const second = await fetchLibraryChunk(client, { firstPage: first.nextFirstPage });

        expect(first.data).toHaveLength(500);
        expect(first.hasMore).toBe(true);
        expect(second.data).toHaveLength(112);
        expect(second.data[0]?.id).toBe('rec_0500');
        expect(second.hasMore).toBe(false);
        expect(library.urls).toHaveLength(7);
    });
});
