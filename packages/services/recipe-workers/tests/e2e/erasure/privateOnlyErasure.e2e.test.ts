/**
 * ADR-0089 — erasure's donate step never makes a PRIVATE-ONLY recipe public, against a REAL Postgres.
 *
 * A donation flips an elected owner-only recipe to public and published. A copy of a web page, a book recipe and a paid-site
 * recipe may never be public, so they are NOT flipped: they fall into the removed set and are deleted, like a recipe that
 * holds a private food. A recipe the cook wrote and the curator's public-domain text (the same label as a web copy, with no
 * source kind) ARE donated.
 *
 * ⛔ A unit test over the emitted SQL cannot prove this: whether the predicate keeps the curator's text while refusing a web
 * copy is decided by the database over real `source_type` and `source_kind` values, NULL kind included.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';

import { eraseRecipeRows } from '../../../src/handlers/accountErasureWorker.js';
import { recipeWorkersDb } from '../roleDb.js';

const roleDb = recipeWorkersDb();
const USER_ERASED = '01JU89PRIVONLYERASED000A0';

interface Probe {
    readonly name: string;
    readonly sourceType: string;
    readonly sourceKind: string | null;
    readonly sourceUrl: string | null;
    readonly donated: boolean;
}

const PROBES: readonly Probe[] = [
    { name: 'wrote', sourceType: 'user_created', sourceKind: null, sourceUrl: null, donated: true },
    {
        name: 'curator',
        sourceType: 'imported_public',
        sourceKind: null,
        sourceUrl: 'https://gutenberg.org/x',
        donated: true,
    },
    {
        name: 'web',
        sourceType: 'imported_public',
        sourceKind: 'public_web',
        sourceUrl: 'https://example.com/r',
        donated: false,
    },
    { name: 'book', sourceType: 'imported_physical', sourceKind: 'book', sourceUrl: null, donated: false },
    { name: 'paid', sourceType: 'imported_paid', sourceKind: 'paid_site', sourceUrl: null, donated: false },
];

describe('erasure never donates a private-only recipe (ADR-0089)', () => {
    let pool: pg.Pool;
    let db: NodePgDatabase<Record<string, never>>;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
        db = drizzle(pool);
    });

    afterEach(async () => {
        await db.execute(sql`DELETE FROM recipes WHERE owner_id = ${USER_ERASED}`);
        await db.execute(sql`DELETE FROM account_erasure_jobs WHERE owner_id = ${USER_ERASED}`);
    });

    afterAll(async () => {
        await pool.end();
    });

    async function insertPrivatePublished(probe: Probe): Promise<string> {
        const { rows } = await db.execute<{ id: string }>(sql`
            INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                 total_time_minutes, visibility, status, source_type, source_kind, source_url)
            VALUES (${USER_ERASED}, ${'ADR-0089 probe ' + probe.name}, 'probe', 2, 5, 5, 10, 'private', 'published',
                    ${probe.sourceType}, ${probe.sourceKind}, ${probe.sourceUrl})
            RETURNING id
        `);
        const id = rows[0]?.id;

        if (id === undefined) {
            throw new Error('test setup: the recipe insert returned no id');
        }

        return id;
    }

    it('donates what may be public and removes what may not, from one election of all of them', async () => {
        const ids = new Map<string, string>();

        for (const probe of PROBES) {
            ids.set(probe.name, await insertPrivatePublished(probe));
        }

        await eraseRecipeRows(db, USER_ERASED, [...ids.values()]);

        for (const probe of PROBES) {
            const { rows } = await db.execute<{ visibility: string; status: string }>(sql`
                SELECT visibility, status FROM recipes WHERE id = ${ids.get(probe.name) ?? ''}
            `);

            expect(rows[0], probe.name).toEqual(
                probe.donated ? { visibility: 'public', status: 'published' } : undefined,
            );
        }
    });
});
