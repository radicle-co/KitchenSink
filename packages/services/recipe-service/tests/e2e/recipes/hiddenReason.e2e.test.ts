/**
 * hiddenViews, LOCAL e2e (real Postgres, real app): the OWNER of a public recipe the read rule holds is told why, on detail,
 * the owner's list, search and a collection's members, and nobody else ever is. The truth table runs against the database's
 * own `recipe_held_from_readers`, so a presence disagreement between the owner's chip and the readers' rule goes red here.
 * The owner may also read the held recipe's versions (AE10); versions has no recipe-item producer.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { PRIVATE_ONLY_SOURCE_KEYS_JSON } from '@kitchensink/recipe-core';

import { bootRecipeApp, type BootedRecipeApp } from '../harness.js';
import { asPrincipal } from '../../support/asPrincipal.js';
import { bearerFor, startFoodFake, type FoodFake } from '../../support/foodFake.js';
import { recipeDb } from '../../support/roleDb.js';

const roleDb = recipeDb();
const OWNER = '01JHIDDENREASONOWNER00002';
const READER = '01JHIDDENREASONREADER0002';
const PREFIX = '99999999-9999-4999-8999-0000004';
const rid = (n: number): string => `${PREFIX}${String(n).padStart(5, '0')}`;
const TOKEN = 'zzhiddenreason';

interface Row {
    readonly n: number;
    readonly visibility: 'public' | 'private';
    readonly correctionHold: boolean;
    readonly evidence: boolean;
    /** A private-only origin label (a book), with no evidence row. */
    readonly bookLabel?: boolean;
    /** The wire reason the owner must get; `undefined` is "no key". */
    readonly reason: 'sourceCorrected' | 'heldSource' | undefined;
    readonly name: string;
}

/** The truth table (heldMeansHidden AE7, public audience unless stated). */
const ROWS: readonly Row[] = [
    {
        n: 1,
        visibility: 'public',
        correctionHold: true,
        evidence: false,
        reason: 'sourceCorrected',
        name: 'hold alone',
    },
    { n: 2, visibility: 'public', correctionHold: false, evidence: true, reason: 'heldSource', name: 'cook evidence' },
    {
        n: 3,
        visibility: 'public',
        correctionHold: true,
        evidence: true,
        reason: 'sourceCorrected',
        name: 'hold and evidence',
    },
    {
        n: 6,
        visibility: 'public',
        correctionHold: false,
        evidence: false,
        bookLabel: true,
        reason: 'heldSource',
        name: 'book label',
    },
    { n: 4, visibility: 'public', correctionHold: false, evidence: false, reason: undefined, name: 'nothing holds it' },
    {
        n: 5,
        visibility: 'private',
        correctionHold: true,
        evidence: false,
        reason: undefined,
        name: 'private with the hold (AE4)',
    },
];

describe('hiddenReason: the owner is told, nobody else is', () => {
    let booted: BootedRecipeApp;
    let food: FoodFake;
    let pool: pg.Pool;

    async function seed(row: Row): Promise<void> {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO recipes (id, owner_id, title, description, prep_time_minutes, cook_time_minutes,
                                      total_time_minutes, servings, visibility, status, source_type, source_correction_hold)
                 VALUES ($1, $2, $3, '', 1, 1, 2, 4, $4, 'published', $6, $5)`,
                [
                    rid(row.n),
                    OWNER,
                    `${TOKEN} ${row.name}`,
                    row.visibility,
                    row.correctionHold,
                    row.bookLabel === true ? 'imported_physical' : 'user_created',
                ],
            );

            if (row.evidence) {
                await client.query(
                    `INSERT INTO recipe_source_evidence (recipe_id, capture, source_kind, citation)
                     VALUES ($1, 'editorCitation', 'book', 'A Cookbook, p. 3')`,
                    [rid(row.n)],
                );
            }

            await client.query(
                `INSERT INTO recipe_versions (recipe_id, version_number, snapshot, created_by)
                 VALUES ($1, 1, '{"title":"v1"}'::jsonb, $2)`,
                [rid(row.n), OWNER],
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    function api(path: string, as: string): Promise<Response> {
        return asPrincipal(as, () => fetch(`${booted.baseUrl}${path}`, { headers: { authorization: bearerFor(as) } }));
    }

    async function items(path: string, as: string): Promise<Map<string, Record<string, unknown>>> {
        const body = (await (await api(path, as)).json()) as {
            data?: Array<Record<string, unknown>>;
            results?: Array<{ recipe: Record<string, unknown> }>;
        };
        const list = body.data ?? (body.results ?? []).map((result) => result.recipe);

        return new Map(list.map((item) => [String(item['id']), item]));
    }

    /** A private collection of `owner` holding recipe `n`; returns its id. */
    async function collect(owner: string, n: number): Promise<string> {
        const created = await pool.query<{ id: string }>(
            `INSERT INTO collections (owner_id, name, visibility) VALUES ($1, 'Mine', 'private') RETURNING id`,
            [owner],
        );
        const id = created.rows[0].id;

        await pool.query(
            `INSERT INTO recipe_collections (collection_id, recipe_id, added_via) VALUES ($1, $2, 'manual')`,
            [id, rid(n)],
        );

        return id;
    }

    async function collectionItems(id: string, as: string): Promise<Map<string, Record<string, unknown>>> {
        const body = (await (await api(`/api/v1/collections/${id}`, as)).json()) as {
            recipes?: Array<Record<string, unknown>>;
        };

        return new Map((body.recipes ?? []).map((item) => [String(item['id']), item]));
    }

    beforeAll(async () => {
        food = await startFoodFake();
        process.env['FOOD_SERVICE_URL'] = food.origin;
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: READER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl });
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM collections WHERE owner_id = ANY($1)`, [[OWNER, READER]]);
        await pool.query(`DELETE FROM recipes WHERE owner_id = $1`, [OWNER]);
    });

    afterAll(async () => {
        await pool.end();
        await booted.close();
        await food.close();
    });

    it.each(ROWS)('detail, list, search and a collection tell the owner the reason of "$name"', async (row) => {
        await Promise.all(ROWS.map((r) => seed(r)));
        const collectionId = await collect(OWNER, row.n);

        const detailResponse = await api(`/api/v1/recipes/${rid(row.n)}`, OWNER);
        const detail = (await detailResponse.json()) as Record<string, unknown>;
        const listed = (await items('/api/v1/recipes?pageSize=50', OWNER)).get(rid(row.n));
        const searched = (await items(`/api/v1/search/recipes?query=${TOKEN}&pageSize=50`, OWNER)).get(rid(row.n));
        const member = (await collectionItems(collectionId, OWNER)).get(rid(row.n));

        // Present first, so a missing item or a failed call cannot pass as "no key".
        expect(detailResponse.status).toBe(200);

        for (const item of [detail, listed, searched, member]) {
            expect(item).toBeDefined();

            if (row.reason === undefined) {
                expect(item).not.toHaveProperty('hiddenReason');
            } else {
                expect(item).toHaveProperty('hiddenReason', row.reason);
            }
        }

        // The control: the database's own rule says held exactly when the owner is told a reason.
        const held = await pool.query<{ held: boolean }>(
            `SELECT recipe_held_from_readers(r, $2::jsonb) AS held FROM recipes r WHERE id = $1`,
            [rid(row.n), PRIVATE_ONLY_SOURCE_KEYS_JSON],
        );

        expect(held.rows[0]?.held && row.visibility === 'public').toBe(row.reason !== undefined);
    });

    it("tells the collection's owner nothing for another cook's held recipe (AE3)", async () => {
        await Promise.all(ROWS.map((r) => seed(r)));
        const collectionId = await collect(READER, 4);

        // Cook B's collection holds the clean public recipe of cook A: readable, and no key.
        const members = await collectionItems(collectionId, READER);

        expect(members.get(rid(4))).toBeDefined();
        expect(members.get(rid(4))).not.toHaveProperty('hiddenReason');
    });

    it('tells a stranger nothing on search (the held row is gone, the control row has no key), and nothing in Discover for the owner', async () => {
        await Promise.all(ROWS.map((r) => seed(r)));

        const asReader = await items(`/api/v1/search/recipes?query=${TOKEN}&pageSize=50`, READER);
        const community = await items(`/api/v1/search/recipes?query=${TOKEN}&scope=community&pageSize=50`, OWNER);

        // Cook B finds only the clean public recipe, and it carries no key; every held one is absent.
        expect([...asReader.keys()]).toEqual([rid(4)]);
        expect(asReader.get(rid(4))).toBeDefined();
        expect(asReader.get(rid(4))).not.toHaveProperty('hiddenReason');
        // The owner's own recipes are never in their own Discover, so no reason can be shown there.
        expect(community.size).toBe(0);
    });

    it('lets the owner read a held recipe and its versions (AE10)', async () => {
        await Promise.all(ROWS.map((r) => seed(r)));

        expect((await api(`/api/v1/recipes/${rid(1)}`, OWNER)).status).toBe(200);
        expect((await api(`/api/v1/recipes/${rid(1)}/versions`, OWNER)).status).toBe(200);
        // Control: cook B is refused the same held recipe.
        expect((await api(`/api/v1/recipes/${rid(1)}`, READER)).status).toBe(404);
    });
});
