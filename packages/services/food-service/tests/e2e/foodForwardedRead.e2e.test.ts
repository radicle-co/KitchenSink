/**
 * LOCAL e2e — `GET /api/v1/foods/{id}` and `/status` for a RETIRED root, against a REAL Postgres (ADR-0050 §4; curated
 * plan U8 S6). Boots the real app as `food_app` (ADR-0039) behind the REAL `FoodAuthGuard` over genuinely-signed RS256
 * tokens and seeds roots, variants and forwards as the seed writes them. Target: LOCAL (`docs/CODING_STANDARDS.md`
 * §7.1a) — it proves the code and the schema, never a deploy.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | a root forwarded to a live root serves that root's numbers under the REQUESTED id, naming it | `200`, `id`, `nutrients`, `forwardedTo` on both routes |
 * | a root forwarded to a live variant serves the VARIANT's own numbers and cites them | the variant's amount, not its root's, with the register source |
 * | a root retired with NO successor still answers as itself (R29) | its own numbers, no `forwardedTo` |
 * | a forward cycle answers the unknown id's bytes, never a 500 and never the retired row's empty record | raw bodies compared |
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { foodResponseSchema, statusResponseSchema } from '@kitchensink/schema-food';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic: the source seam is never dialled by these routes, and stubbing it means it cannot be.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { makeSeededRoot } from '../__fixtures__/catalogFood.js';
import { foodDb } from '../support/roleDb.js';
import { bootFoodApp, callFoodApi } from './harness.js';

const APP_AZP = 'https://app.example.com';
const STRANGER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AC';

const keypair = generateClerkKeypair();
const strangerToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_forwarded_stranger',
    externalId: STRANGER_ULID,
    azp: APP_AZP,
});

describe('GET /{id} and /{id}/status for a retired root — LOCAL e2e (booted app + real Postgres)', () => {
    let booted: BootedServiceApp;

    /** Forward a retired root to a live target, as the seed would (written as the owner). */
    async function forward(sourceId: string, target: { foodId: string } | { variantId: string }): Promise<void> {
        await foodDb().asOwner((client) =>
            client.query(
                `INSERT INTO food_forward (source_id, source_kind, target_food_id, target_variant_id)
                 VALUES ($1, 'root', $2, $3)`,
                [sourceId, 'foodId' in target ? target.foodId : null, 'variantId' in target ? target.variantId : null],
            ),
        );
    }

    /** The kcal amount a response carries. */
    const kcalOf = (nutrients: readonly { unit: string; amount: number }[]): number | undefined =>
        nutrients.find((nutrient) => nutrient.unit === 'kcal')?.amount;

    const get = (path: string) => callFoodApi(booted.baseUrl, 'GET', path, { token: strangerToken });

    beforeAll(async () => {
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('serves a root forwarded to a live root under the requested id, on both routes, naming the live root', async () => {
        const old = await makeSeededRoot(foodDb(), { name: 'Broccoli', retired: true });
        const live = await makeSeededRoot(foodDb(), {
            name: 'Broccoli, raw',
            values: [{ key: 'energyKcal', amount: 34 }],
        });
        await forward(old.id, { foodId: live.id });

        const direct = await get(`/api/v1/foods/${old.id}`);
        const status = await get(`/api/v1/foods/${old.id}/status`);

        expect(direct.status).toBe(200);
        const food = foodResponseSchema.parse(direct.body);
        expect(food).toMatchObject({ id: old.id, name: 'Broccoli, raw', forwardedTo: { kind: 'root', id: live.id } });
        expect(kcalOf(food.nutrients)).toBe(34);

        expect(status.status).toBe(200);
        const polled = statusResponseSchema.parse(status.body);
        expect(polled).toMatchObject({ id: old.id, status: 'RESOLVED' });
        expect(polled.food).toMatchObject({ id: old.id, forwardedTo: { kind: 'root', id: live.id } });
        expect(kcalOf(polled.food?.nutrients ?? [])).toBe(34);
    });

    it("serves a root forwarded to a live variant with the variant's OWN numbers, cited", async () => {
        const old = await makeSeededRoot(foodDb(), { name: 'Beef, brisket, whole', retired: true });
        const brisket = await makeSeededRoot(foodDb(), {
            name: 'Beef, brisket',
            values: [{ key: 'energyKcal', amount: 250 }],
            variants: [{ parts: [{ attribute: 'cut', text: 'flat' }], values: [{ key: 'energyKcal', amount: 155 }] }],
        });
        const flat = brisket.variants[0]!.id;
        await forward(old.id, { variantId: flat });

        const direct = await get(`/api/v1/foods/${old.id}`);

        expect(direct.status).toBe(200);
        const food = foodResponseSchema.parse(direct.body);
        expect(food).toMatchObject({
            id: old.id,
            name: 'Beef, brisket',
            variants: [],
            forwardedTo: { kind: 'variant', id: flat },
        });
        expect(kcalOf(food.nutrients)).toBe(155);
        expect(food.nutrients.every((nutrient) => nutrient.source !== 'author')).toBe(true);
    });

    it('⛔ a root the seed retired with NO successor answers as itself (R29), with no forwardedTo', async () => {
        const old = await makeSeededRoot(foodDb(), {
            name: 'Beef, brisket, whole',
            retired: true,
            values: [{ key: 'energyKcal', amount: 170 }],
        });

        const direct = await get(`/api/v1/foods/${old.id}`);

        expect(direct.status).toBe(200);
        const food = foodResponseSchema.parse(direct.body);
        expect(food.id).toBe(old.id);
        expect(food.forwardedTo).toBeUndefined();
        expect(kcalOf(food.nutrients)).toBe(170);
    });

    it('⛔ a forward cycle answers the unknown id’s bytes — never a 500, never the retired empty record', async () => {
        const a = await makeSeededRoot(foodDb(), { name: 'cycle a', retired: true });
        const b = await makeSeededRoot(foodDb(), { name: 'cycle b', retired: true });
        await forward(a.id, { foodId: b.id });
        await forward(b.id, { foodId: a.id });

        const cyclic = await get(`/api/v1/foods/${a.id}`);
        const cyclicStatus = await get(`/api/v1/foods/${a.id}/status`);
        const unknown = await get(`/api/v1/foods/${'01J'.padEnd(26, 'X')}`);

        expect(cyclic.status).toBe(404);
        expect(cyclicStatus.status).toBe(404);
        expect(unknown.status).toBe(404);
        expect(JSON.parse(cyclic.text)).toMatchObject({ code: 'FOOD_NOT_FOUND' });
    });
});
