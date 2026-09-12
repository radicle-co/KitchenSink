/**
 * LOCAL e2e — the barcode crosswalk in `GET /api/v1/foods/search` reads catalog rows only, against a REAL migrated
 * Postgres. Boots the real app as `food_app` (ADR-0039) behind the real `FoodAuthGuard` over genuinely signed tokens.
 * Target: LOCAL (`docs/CODING_STANDARDS.md` §7.1a).
 *
 * A query that is a barcode is unshifted onto the answer by the crosswalk, beside the ranked name search. The name
 * search already keeps a stranger's authored food out of the DAO (ADR-0036), so the crosswalk was the one path left
 * from a private food into another caller's answer. Each row's barcode is written by SQL as the owner, because no
 * route writes one and no constraint stops a barcode on an authored row.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | a stranger's search by an authored food's barcode does not return it | an empty answer |
 * | a catalog food's barcode still resolves for anyone | the food, at score 1 |
 * | an authored row with the same barcode cannot hide the catalog row | the catalog food |
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { searchResponseSchema } from '@kitchensink/schema-food';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic: search never dials a source, and stubbing the adapter means it cannot.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { makeCatalogFood } from '../__fixtures__/catalogFood.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { bootFoodApp, callFoodApi } from './harness.js';

const APP_AZP = 'https://app.example.com';
const AUTHOR_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const keypair = generateClerkKeypair();
const strangerToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_barcode_stranger',
    externalId: '01J9ZK8N7QF3B2X4M6T0V5C1AC',
    azp: APP_AZP,
});

/** Digits only, so neither food's name can match the query and only the crosswalk can return a row. */
const AUTHORED_BARCODE = '0049000028911';
const CATALOG_BARCODE = '0012000161155';

describe('the barcode crosswalk reads catalog rows only — LOCAL e2e', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;

    /**
     * Write one food and set its barcode as the owner.
     *
     * @param options - The food's name, its author (none for a catalog food) and its barcode.
     * @returns The food's id.
     */
    async function foodWithBarcode(options: {
        readonly name: string;
        readonly userId: string | null;
        readonly barcode: string;
    }): Promise<string> {
        const { id } = await makeCatalogFood(pool, { id: ulid(), name: options.name, userId: options.userId });

        await foodDb().asOwner(async (client) => {
            await client.query('UPDATE food SET barcode = $1 WHERE id = $2', [options.barcode, id]);
        });

        return id;
    }

    /**
     * Search by `query` as the stranger.
     *
     * @param query - The query.
     * @returns The answer, parsed by the published schema.
     */
    async function strangerSearch(query: string): Promise<ReturnType<typeof searchResponseSchema.parse>> {
        const res = await callFoodApi(
            booted.baseUrl,
            'GET',
            `/api/v1/foods/search?query=${encodeURIComponent(query)}`,
            { token: strangerToken },
        );

        expect(res.status).toBe(200);

        return searchResponseSchema.parse(res.body);
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: foodDb().appUrl });
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it("⛔ does not return another caller's private authored food by its barcode", async () => {
        await foodWithBarcode({ name: 'grandma spice mix', userId: AUTHOR_ULID, barcode: AUTHORED_BARCODE });

        expect((await strangerSearch(AUTHORED_BARCODE)).results).toStrictEqual([]);
    });

    it("returns a catalog food by its barcode to any caller, at the crosswalk's score", async () => {
        const id = await foodWithBarcode({ name: 'cereal bar', userId: null, barcode: CATALOG_BARCODE });

        expect((await strangerSearch(CATALOG_BARCODE)).results).toStrictEqual([{ id, name: 'cereal bar', score: 1 }]);
    });

    // The authored row is written first, so it is the first row the index holds for the barcode.
    it('returns the catalog food when an authored food carries the same barcode', async () => {
        await foodWithBarcode({ name: 'grandma spice mix', userId: AUTHOR_ULID, barcode: CATALOG_BARCODE });
        const id = await foodWithBarcode({ name: 'cereal bar', userId: null, barcode: CATALOG_BARCODE });

        expect((await strangerSearch(CATALOG_BARCODE)).results).toStrictEqual([{ id, name: 'cereal bar', score: 1 }]);
    });
});
