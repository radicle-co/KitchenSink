/**
 * `pgSeedSession` (curated catalog plan U6): the Adapter from the seed's one-connection port to a `pg` client.
 *
 * Over an unconnected client whose `query` is a spy, as `catalogSnapshot.dao.test.ts` does: a statement passes its text
 * and values through and hands back the driver's rows and row count unchanged, `null` included, and a COPY is a
 * pg-copy-streams query built on the exact statement. That the COPY reaches a server is the LOCAL e2e tier's.
 */
import { Writable } from 'node:stream';

import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { pgSeedSession } from '../catalogSeedSession.js';

describe('pgSeedSession', () => {
    it('passes a statement through and hands back the driver’s rows and row count', async () => {
        const client = new pg.Client();
        const query = vi.spyOn(client, 'query').mockImplementation(() => ({ rows: [{ seed_sha: 'x' }], rowCount: 1 }));

        expect(await pgSeedSession(client).query('SELECT $1', ['a'])).toEqual({
            rows: [{ seed_sha: 'x' }],
            rowCount: 1,
        });
        expect(query).toHaveBeenCalledWith('SELECT $1', ['a']);
    });

    it('keeps a null row count null, which the apply reads as no row touched', async () => {
        const client = new pg.Client();

        vi.spyOn(client, 'query').mockImplementation(() => ({ rows: [], rowCount: null }));

        expect(await pgSeedSession(client).query('BEGIN')).toEqual({ rows: [], rowCount: null });
    });

    it('opens a COPY as a pg-copy-streams query on the exact statement, and returns its writable end', () => {
        const client = new pg.Client();
        const query = vi.spyOn(client, 'query').mockImplementation((submittable: unknown) => submittable);
        const sql = 'COPY pg_temp.catalog_seed_item (id) FROM STDIN';

        const target = pgSeedSession(client).copyFrom(sql);
        const [submitted] = query.mock.calls[0] ?? [];

        // pg-copy-streams exports its query class as a type only, so the instance is known by its shape.
        expect(submitted).toBeInstanceOf(Writable);
        expect(submitted).toMatchObject({ text: sql });
        expect(target).toBe(submitted);
    });
});
