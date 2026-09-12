/**
 * LOCAL e2e — `POST /api/v1/foods/refs/resolve` against a REAL Postgres (curated plan U8, roots slice). Boots the
 * real app as `food_app` (ADR-0039) behind the REAL `FoodAuthGuard` over genuinely-signed RS256 tokens, and seeds
 * `food` rows directly. Target: LOCAL (`docs/CODING_STANDARDS.md` §7.1a) — it proves the code and the schema,
 * never a deploy.
 *
 * | Requirement | Pinned here |
 * | --- | --- |
 * | "own private food is found" | the author's entry carries name, status and `visibility: private` |
 * | "a stranger's private food and an unknown id give BYTE-EQUAL entries" | same ref, row present then deleted, raw bodies compared |
 * | "withdrawn is found" | `WITHDRAWN`, with its name, to the author |
 * | "`DELETING` is absent" | even to the author |
 * | "a variant is absent" | a variant ref whose id IS a real root id |
 * | "`private, no-store` is set" | the header on a real response |
 * | the real `readRefFacts` statement against the migrated schema | a mixed batch, first-appearance order, duplicates collapsed |
 * | the published client reads the real wire | `FoodServiceClient.resolveRefs` round trip |
 * | S5 variant arm | a seeded live variant is found under its root, with its parts |
 * | S5 forwarded arm | a retired root answers as its forward's live end, naming it in `forwardedTo` |
 * | S5 bounded forwards | a cycle answers the unknown-id bytes, never a 500 |
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { resolveFoodRefsResponseSchema as publishedResponseSchema } from '@kitchensink/schema-food';
import pg from 'pg';
import { ulid } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Hermetic: the source seam is never dialled by this route, and stubbing it means it cannot be.
vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { makeCatalogFood, makeSeededRoot } from '../__fixtures__/catalogFood.js';
import { foodE2eDb, hasTestDatabase } from '../support/roleDb.js';
import { bootFoodApp, callFoodApi, type FoodApiResponse } from './harness.js';

const APP_AZP = 'https://app.example.com';
const M2M_AZP = 'svc-refs-client';
const AUTHOR_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AB';
const STRANGER_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1AC';

const keypair = generateClerkKeypair();
const authorToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_refs_author',
    externalId: AUTHOR_ULID,
    azp: APP_AZP,
});
const strangerToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_refs_stranger',
    externalId: STRANGER_ULID,
    azp: APP_AZP,
});
const serviceToken = mintToken(keypair.privateKeyPem, { sub: 'svc_refs_e2e', azp: M2M_AZP });

const PATH = '/api/v1/foods/refs/resolve';

describe.skipIf(!hasTestDatabase)('POST /api/v1/foods/refs/resolve — LOCAL e2e (booted app + real Postgres)', () => {
    let booted: BootedServiceApp;
    let pool: pg.Pool;

    /** Resolve `refs` as the holder of `token`. */
    function resolve(token: string, refs: readonly { kind: string; id: string }[]): Promise<FoodApiResponse> {
        return callFoodApi(booted.baseUrl, 'POST', PATH, { token, body: { refs } });
    }

    /** Forward a retired root to a live target, as the seed would (written as the owner). */
    async function forward(sourceId: string, target: { foodId: string } | { variantId: string }): Promise<void> {
        await foodE2eDb().asOwner((client) =>
            client.query(
                `INSERT INTO food_forward (source_id, source_kind, target_food_id, target_variant_id)
                 VALUES ($1, 'root', $2, $3)`,
                [sourceId, 'foodId' in target ? target.foodId : null, 'variantId' in target ? target.variantId : null],
            ),
        );
    }

    /**
     * Seed one `food` row as `food_app` — DML only, as a deployed task writes. `userId` null is a catalog row; the
     * 0013 CHECK then requires `public`.
     */
    async function seedFood(options: {
        name: string;
        status?: string;
        userId?: string | null;
        visibility?: 'public' | 'private' | 'promoted';
    }): Promise<string> {
        const { id } = await makeCatalogFood(pool, {
            id: ulid(),
            name: options.name,
            normalizedName: options.name.toLowerCase(),
            status: options.status ?? 'RESOLVED',
            userId: options.userId ?? null,
            visibility: options.visibility ?? 'public',
        });

        return id;
    }

    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: foodE2eDb().appUrl });
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP, M2M_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
        await pool?.end();
    });

    beforeEach(async () => {
        await foodE2eDb().truncate();
    });

    it('answers 200 with Cache-Control: private, no-store, in the PUBLISHED shape', async () => {
        const id = await seedFood({ name: 'Broccoli, raw' });

        const res = await resolve(strangerToken, [{ kind: 'root', id }]);

        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(publishedResponseSchema.parse(res.body)).toStrictEqual({
            entries: [{ outcome: 'found', ref: { kind: 'root', id }, name: 'Broccoli, raw', status: 'RESOLVED' }],
        });
    });

    it('the author finds their own private food — name, status, and the private marker', async () => {
        const id = await seedFood({ name: 'Grandma’s spice mix', userId: AUTHOR_ULID, visibility: 'private' });

        const res = await resolve(authorToken, [{ kind: 'root', id }]);

        expect(res.body).toStrictEqual({
            entries: [
                {
                    outcome: 'found',
                    ref: { kind: 'root', id },
                    name: 'Grandma’s spice mix',
                    status: 'RESOLVED',
                    visibility: 'private',
                },
            ],
        });
    });

    it('⛔ a stranger’s view of a private food is BYTE-EQUAL to the same id once the row is gone', async () => {
        const id = await seedFood({ name: 'Grandma’s spice mix', userId: AUTHOR_ULID, visibility: 'private' });

        const concealed = await resolve(strangerToken, [{ kind: 'root', id }]);
        await pool.query('DELETE FROM food WHERE id = $1', [id]);
        const unknown = await resolve(strangerToken, [{ kind: 'root', id }]);

        expect(concealed.status).toBe(200);
        expect(unknown.status).toBe(200);
        expect(concealed.text).toBe(unknown.text);
        expect(concealed.body).toStrictEqual({ entries: [{ outcome: 'absent', ref: { kind: 'root', id } }] });
    });

    it('⛔ a service principal is a stranger to a private food', async () => {
        const id = await seedFood({ name: 'Grandma’s spice mix', userId: AUTHOR_ULID, visibility: 'private' });

        const res = await resolve(serviceToken, [{ kind: 'root', id }]);

        expect(res.body).toStrictEqual({ entries: [{ outcome: 'absent', ref: { kind: 'root', id } }] });
    });

    it('a WITHDRAWN private food is found by its author, with its name', async () => {
        const id = await seedFood({
            name: 'Old rub',
            status: 'WITHDRAWN',
            userId: AUTHOR_ULID,
            visibility: 'private',
        });

        const res = await resolve(authorToken, [{ kind: 'root', id }]);

        expect(res.body).toMatchObject({ entries: [{ outcome: 'found', name: 'Old rub', status: 'WITHDRAWN' }] });
    });

    it('a food mid-erasure (DELETING) is absent, even to its author', async () => {
        const id = await seedFood({ name: 'Going', status: 'DELETING', userId: AUTHOR_ULID, visibility: 'private' });

        const res = await resolve(authorToken, [{ kind: 'root', id }]);

        expect(res.body).toStrictEqual({ entries: [{ outcome: 'absent', ref: { kind: 'root', id } }] });
    });

    it('a VARIANT ref is absent, even when its id names a real root food', async () => {
        const id = await seedFood({ name: 'Broccoli, raw' });

        const res = await resolve(authorToken, [{ kind: 'variant', id }]);

        expect(res.body).toStrictEqual({ entries: [{ outcome: 'absent', ref: { kind: 'variant', id } }] });
    });

    it('answers a mixed batch from ONE real read: first-appearance order, duplicates collapsed', async () => {
        const catalog = await seedFood({ name: 'Broccoli, raw' });
        const own = await seedFood({ name: 'Grandma’s spice mix', userId: AUTHOR_ULID, visibility: 'private' });
        const theirs = await seedFood({ name: 'Secret sauce', userId: STRANGER_ULID, visibility: 'private' });
        const missing = ulid();

        const res = await resolve(authorToken, [
            { kind: 'root', id: theirs },
            { kind: 'root', id: catalog },
            { kind: 'root', id: missing },
            { kind: 'root', id: own },
            { kind: 'root', id: catalog },
        ]);

        expect(res.body).toStrictEqual({
            entries: [
                { outcome: 'absent', ref: { kind: 'root', id: theirs } },
                { outcome: 'found', ref: { kind: 'root', id: catalog }, name: 'Broccoli, raw', status: 'RESOLVED' },
                { outcome: 'absent', ref: { kind: 'root', id: missing } },
                {
                    outcome: 'found',
                    ref: { kind: 'root', id: own },
                    name: 'Grandma’s spice mix',
                    status: 'RESOLVED',
                    visibility: 'private',
                },
            ],
        });
    });

    it('the published client reads the real wire', async () => {
        const id = await seedFood({ name: 'Broccoli, raw' });
        const client = new FoodServiceClient({
            baseUrl: booted.baseUrl,
            token: strangerToken,
            onContractSkew: () => undefined,
        });

        await expect(client.resolveRefs([{ kind: 'root', id }])).resolves.toStrictEqual({
            entries: [{ outcome: 'found', ref: { kind: 'root', id }, name: 'Broccoli, raw', status: 'RESOLVED' }],
        });
    });

    it('refuses an anonymous caller with 401 before any work', async () => {
        expect(
            (await callFoodApi(booted.baseUrl, 'POST', PATH, { body: { refs: [{ kind: 'root', id: 'x' }] } })).status,
        ).toBe(401);
    });

    describe('curated U8 S5 — the variant and forwarded arms, over seeded roots', () => {
        it('a live variant is found under its root, with its parts, in the PUBLISHED shape', async () => {
            const brisket = await makeSeededRoot(foodE2eDb(), {
                name: 'beef brisket',
                variants: [{ parts: [{ attribute: 'cut', text: 'flat' }] }],
            });
            const ref = { kind: 'variant', id: brisket.variants[0]!.id };

            const res = await resolve(strangerToken, [ref]);

            expect(res.status).toBe(200);
            expect(publishedResponseSchema.parse(res.body)).toStrictEqual({
                entries: [
                    {
                        outcome: 'found',
                        ref,
                        name: 'beef brisket',
                        status: 'RESOLVED',
                        variant: { rootId: brisket.id, parts: [{ attribute: 'cut', text: 'flat' }] },
                    },
                ],
            });
        });

        it('a retired root is found as the live variant its forward ends at, naming it', async () => {
            const old = await makeSeededRoot(foodE2eDb(), { name: 'Beef, brisket, whole', retired: true });
            const brisket = await makeSeededRoot(foodE2eDb(), {
                name: 'beef brisket',
                variants: [{ parts: [{ attribute: 'cut', text: 'flat' }] }],
            });
            const flat = brisket.variants[0]!.id;
            await forward(old.id, { variantId: flat });

            const res = await resolve(strangerToken, [{ kind: 'root', id: old.id }]);

            expect(publishedResponseSchema.parse(res.body).entries).toStrictEqual([
                {
                    outcome: 'found',
                    ref: { kind: 'root', id: old.id },
                    name: 'beef brisket',
                    status: 'RESOLVED',
                    variant: { rootId: brisket.id, parts: [{ attribute: 'cut', text: 'flat' }] },
                    forwardedTo: { kind: 'variant', id: flat },
                },
            ]);
        });

        it('⛔ a forward cycle answers the SAME bytes an unknown id answers — never a 500', async () => {
            const a = await makeSeededRoot(foodE2eDb(), { name: 'cycle a', retired: true });
            const b = await makeSeededRoot(foodE2eDb(), { name: 'cycle b', retired: true });
            await forward(a.id, { foodId: b.id });
            await forward(b.id, { foodId: a.id });

            const cycle = await resolve(strangerToken, [{ kind: 'root', id: a.id }]);
            await foodE2eDb().truncate();
            const unknown = await resolve(strangerToken, [{ kind: 'root', id: a.id }]);

            expect(cycle.status).toBe(200);
            expect(cycle.text).toBe(unknown.text);
        });
    });
});
