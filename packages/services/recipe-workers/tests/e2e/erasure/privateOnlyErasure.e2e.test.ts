/**
 * ADR-0089 — erasure's donate step never makes a PRIVATE-ONLY recipe public, against a REAL Postgres.
 *
 * A donation flips an elected owner-only recipe to public and published. A copy of a web page, a book recipe and a paid-site
 * recipe may never be public, so they are NOT flipped: they fall into the removed set and are deleted, like a recipe that
 * holds a private food. A recipe the cook wrote and the curator's public-domain text (the same label as a web copy, with no
 * source kind) ARE donated.
 *
 * ⛔ The EVIDENCE RULE rides the same step: a recipe the cook wrote, whose stated web source they later cleared, has evidence
 * behind it (`recipe_source_evidence`, migration 0086) and is NOT donated either (`SOURCE_CONFLICT_SQL`). It is removed with the
 * owner-only set, its evidence rows go with it by the cascade, and the erasure completes. Every probe that states a source
 * carries the evidence row the database demands (the deferred backstop), written in the same transaction.
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
    /** What the cook stated (0087). Omitted: a stated kind reads as `source`, none as no statement. */
    readonly statementKind?: 'authored';
    /** Whether the cook's client reported content pasted into the recipe (0087). */
    readonly pasted?: boolean;
    /** The evidence the recipe carries, if any: a stated source, or one the cook cleared. */
    readonly evidence?: {
        readonly capture: 'editorLink' | 'importFile';
        readonly kind: 'public_web' | 'book' | 'paid_site';
        readonly url: string | null;
        readonly domain: string | null;
        readonly citation: string | null;
    };
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
        evidence: {
            capture: 'editorLink',
            kind: 'public_web',
            url: 'https://example.com/r',
            domain: 'example.com',
            citation: null,
        },
    },
    {
        name: 'book',
        sourceType: 'imported_physical',
        sourceKind: 'book',
        sourceUrl: null,
        donated: false,
        evidence: { capture: 'importFile', kind: 'book', url: null, domain: null, citation: 'A cookbook' },
    },
    {
        name: 'paid',
        sourceType: 'imported_paid',
        sourceKind: 'paid_site',
        sourceUrl: null,
        donated: false,
        evidence: { capture: 'importFile', kind: 'paid_site', url: null, domain: null, citation: 'A paid site' },
    },
    {
        // The cook stated a web source, then cleared it: the recipe reads as theirs, and the evidence says otherwise.
        name: 'clearedWeb',
        sourceType: 'user_created',
        sourceKind: null,
        sourceUrl: null,
        donated: false,
        evidence: {
            capture: 'editorLink',
            kind: 'public_web',
            url: 'https://example.com/cleared',
            domain: 'example.com',
            citation: null,
        },
    },
    // The statement rule (0087): pasted and never said to be theirs is not donated, because a donation would publish it as theirs.
    { name: 'pastedNoStatement', sourceType: 'user_created', sourceKind: null, sourceUrl: null, pasted: true, donated: false },
    // …and once the cook has said so it may be donated like any recipe they wrote.
    {
        name: 'pastedAuthored',
        sourceType: 'user_created',
        sourceKind: null,
        sourceUrl: null,
        pasted: true,
        statementKind: 'authored',
        donated: true,
    },
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
        // ONE transaction: the deferred backstop (migration 0086) checks a stated source's evidence at COMMIT.
        return db.transaction(async (tx) => {
            const { rows } = await tx.execute<{ id: string }>(sql`
                INSERT INTO recipes (owner_id, title, description, servings, prep_time_minutes, cook_time_minutes,
                                     total_time_minutes, visibility, status, source_type, source_kind, source_url,
                                     statement_kind, content_pasted_at)
                VALUES (${USER_ERASED}, ${'ADR-0089 probe ' + probe.name}, 'probe', 2, 5, 5, 10, 'private', 'published',
                        ${probe.sourceType}, ${probe.sourceKind}, ${probe.sourceUrl},
                        ${probe.statementKind ?? (probe.sourceKind === null ? null : 'source')},
                        ${probe.pasted === true ? new Date().toISOString() : null}::timestamptz)
                RETURNING id
            `);
            const id = rows[0]?.id;

            if (id === undefined) {
                throw new Error('test setup: the recipe insert returned no id');
            }

            const evidence = probe.evidence;

            if (evidence !== undefined) {
                await tx.execute(sql`
                    INSERT INTO recipe_source_evidence (recipe_id, capture, source_url, source_key, source_domain,
                                                        source_kind, citation)
                    VALUES (${id}, ${evidence.capture}, ${evidence.url}, ${evidence.url}, ${evidence.domain},
                            ${evidence.kind}, ${evidence.citation})
                `);
            }

            return id;
        });
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

        // The removed recipes took their evidence with them (the append-only guard lets the cascade through), so the
        // erasure left nothing behind about a source for a recipe that no longer exists.
        const { rows: left } = await db.execute<{ n: string }>(sql`
            SELECT count(*) AS n FROM recipe_source_evidence WHERE recipe_id IN (SELECT jsonb_array_elements_text(${JSON.stringify([...ids.values()])}::jsonb)::uuid)
        `);

        expect(Number(left[0]?.n)).toBe(0);
    });
});
