/**
 * LOCAL e2e — `GET /api/v1/foods/sources` and the read behind it, against a REAL migrated Postgres (plan R55, design
 * §S16). Target: LOCAL (`docs/CODING_STANDARDS.md` §7.1a); it proves the code and the schema, never a deploy. The DAO
 * and the booted app connect as `food_app` (ADR-0039); the catalog rows are written as the owner.
 *
 * What only a real database can show is the query's rule, so the world below holds one row for each way it could be
 * wrong:
 *
 * | Row | A wrong query would… |
 * | --- | --- |
 * | a Ciqual citation a value cites, no conversion | drop a cited source, or mark it converted |
 * | a CoFID citation a value cites, energy from kJ | miss a kJ conversion |
 * | a Matvaretabellen citation a value cites, with a density | miss a per-100 mL conversion |
 * | a USDA Branded citation a value cites | miss USDA when its only dataset is Branded |
 * | an STFCJ citation NO value cites | list a source no stored value cites |
 * | two CNF citations, the converted one cited by NO value | mark CNF converted from a citation nothing uses |
 * | a manufacturer's label a value cites | list a label, which is not a register source |
 * | BLS, the Swiss table, Livsmedelsdatabasen: no citation | list a registered source the catalog does not use |
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { dataSourcesResponseSchema as publishedDataSourcesSchema } from '@kitchensink/schema-food';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic: this route reads only our database, and stubbing the adapter means nothing here can dial a source.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { CitedSourcesDao } from '../../src/foods/dao/citedSources.dao.js';
import { makeDb } from '../support/db.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import {
    insertHeader,
    insertItem,
    insertNutrient,
    insertRoot,
    newId,
    nextNumber,
} from './__fixtures__/catalogWorld.js';
import { bootFoodApp, callFoodApi } from './harness.js';

const APP_AZP = 'https://app.example.com';

const keypair = generateClerkKeypair();
const userToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_data_sources',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1DS',
    azp: APP_AZP,
});

/** One source-item citation to write, and whether a stored value cites it. */
interface CitationSpec {
    readonly dataset: string;
    readonly densityGPerMl?: string;
    readonly kcalFromKj?: boolean;
    readonly cited: boolean;
}

/**
 * Write one seed root whose nutrition header holds the given citations. Each cited citation gets a value of its own
 * nutrient, so a citation nothing cites sits beside one that is cited, on the same header.
 *
 * @param client - The owner's connection.
 * @param citations - The citations to write on the root's header.
 * @sideEffect Writes the catalog as the owner.
 */
async function writeRoot(client: pg.ClientBase, citations: readonly CitationSpec[]): Promise<void> {
    const item = await insertItem(client, `fdc:${nextNumber()}`, 'root');
    const root = await insertRoot(client, item, { seedKey: `curated:sources-${nextNumber()}`, userId: null });
    const header = await insertHeader(client, { foodId: root });

    for (const citation of citations) {
        const id = newId('citation');

        await client.query(
            `INSERT INTO food_nutrition_citation (id, nutrition_id, dataset, external_key, match, density_g_per_ml, kcal_from_kj)
             VALUES ($1, $2, $3, $4, 'exact', $5, $6)`,
            [
                id,
                header,
                citation.dataset,
                String(nextNumber()),
                citation.densityGPerMl ?? null,
                citation.kcalFromKj ?? false,
            ],
        );

        if (citation.cited) {
            await client.query(
                'INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, citation_id) VALUES ($1, $2, $3, $4)',
                [header, await insertNutrient(client), '12.5', id],
            );
        }
    }
}

/**
 * Write one seed root whose numbers a manufacturer's label gives.
 *
 * @param client - The owner's connection.
 * @sideEffect Writes the catalog as the owner.
 */
async function writeLabelRoot(client: pg.ClientBase): Promise<void> {
    const item = await insertItem(client, `fdc:${nextNumber()}`, 'root');
    const root = await insertRoot(client, item, { seedKey: `curated:label-${nextNumber()}`, userId: null });
    const header = await insertHeader(client, { foodId: root });
    const id = newId('citation');

    await client.query(
        `INSERT INTO food_nutrition_citation
             (id, nutrition_id, dataset, url, retrieved_on, manufacturer, serving_label, serving_grams)
         VALUES ($1, $2, 'label', 'https://example.com/label', '2026-09-30', 'Example Foods', '1 bar', '40')`,
        [id, header],
    );
    await client.query(
        'INSERT INTO food_nutrition_value (nutrition_id, nutrient_id, amount, citation_id) VALUES ($1, $2, $3, $4)',
        [header, await insertNutrient(client), '200', id],
    );
}

/**
 * The world the table in the header describes.
 *
 * @sideEffect Writes the catalog as the owner.
 */
async function writeWorld(): Promise<void> {
    await foodDb().asOwner(async (client) => {
        await writeRoot(client, [{ dataset: 'ciqual', cited: true }]);
        await writeRoot(client, [{ dataset: 'cofid', kcalFromKj: true, cited: true }]);
        await writeRoot(client, [{ dataset: 'matvaretabellen', densityGPerMl: '1.03', cited: true }]);
        await writeRoot(client, [{ dataset: 'usdaBranded', cited: true }]);
        await writeRoot(client, [
            { dataset: 'ciqual', cited: true },
            { dataset: 'stfcj', cited: false },
        ]);
        await writeRoot(client, [
            { dataset: 'cnf', cited: true },
            { dataset: 'cnf', kcalFromKj: true, densityGPerMl: '0.98', cited: false },
        ]);
        await writeLabelRoot(client);
    });
}

describe('CitedSourcesDao — the cited datasets, against the migrated schema', () => {
    let pool: pg.Pool;
    let dao: CitedSourcesDao;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        dao = new CitedSourcesDao(makeDb(pool));
    });

    afterAll(async () => {
        await pool?.end();
        await foodDb().truncate();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('reads nothing from an empty catalog', async () => {
        await expect(dao.listCitedDatasets()).resolves.toEqual([]);
    });

    it('reads each dataset a stored value cites once, and whether a cited citation of it was converted', async () => {
        await writeWorld();

        const rows = await dao.listCitedDatasets();

        expect([...rows].sort((a, b) => a.dataset.localeCompare(b.dataset))).toEqual([
            { dataset: 'ciqual', converted: false },
            { dataset: 'cnf', converted: false },
            { dataset: 'cofid', converted: true },
            { dataset: 'label', converted: false },
            { dataset: 'matvaretabellen', converted: true },
            { dataset: 'usdaBranded', converted: false },
        ]);
    });
});

describe('GET /api/v1/foods/sources (booted app + real Postgres)', () => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
        await foodDb().truncate();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('lists only the cited sources, in the register’s order, in the PUBLISHED shape', async () => {
        await writeWorld();

        const res = await callFoodApi(booted.baseUrl, 'GET', '/api/v1/foods/sources', { token: userToken });

        expect(res.status).toBe(200);

        const { sources } = publishedDataSourcesSchema.parse(res.body);

        expect(sources.map((source) => [source.id, source.converted])).toEqual([
            ['usda', false],
            ['ciqual', false],
            ['cofid', true],
            ['matvaretabellen', true],
            ['cnf', false],
        ]);
    });

    it('carries the credit word for word, in its own language', async () => {
        await writeWorld();

        const res = await callFoodApi(booted.baseUrl, 'GET', '/api/v1/foods/sources', { token: userToken });
        const ciqual = publishedDataSourcesSchema.parse(res.body).sources.find((source) => source.id === 'ciqual');

        expect(ciqual?.attribution).toBe('Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.');
        expect(ciqual?.attributionLanguage).toBe('fr');
    });

    it('answers an empty list, not an error, for a catalog that cites nothing', async () => {
        const res = await callFoodApi(booted.baseUrl, 'GET', '/api/v1/foods/sources', { token: userToken });

        expect(res.status).toBe(200);
        expect(publishedDataSourcesSchema.parse(res.body)).toEqual({ sources: [] });
    });

    it('answers 401 without a session token', async () => {
        const res = await callFoodApi(booted.baseUrl, 'GET', '/api/v1/foods/sources');

        expect(res.status).toBe(401);
    });

    it('is served under the deprecated /v1 alias too (ADR-0011)', async () => {
        await writeWorld();

        const res = await callFoodApi(booted.baseUrl, 'GET', '/v1/foods/sources', { token: userToken });

        expect(res.status).toBe(200);
        expect(publishedDataSourcesSchema.parse(res.body).sources.map((source) => source.id)).toContain('usda');
    });
});
