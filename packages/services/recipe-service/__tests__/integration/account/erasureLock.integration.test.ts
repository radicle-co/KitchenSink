/**
 * HAZ-052 — the erasure write-lock (`ErasureLockGuard`) against the REAL stack (booted Nest app + Docker
 * Postgres). Proves what the unit tier (`src/account/__tests__/erasureLock.guard.test.ts`) cannot: that
 * the guard is actually wired as a global `APP_GUARD` and genuinely rejects real HTTP mutations with a
 * real `423`, that `@SkipErasureLock()` metadata is actually readable at runtime (not just mocked), and
 * that the lock is scoped by the REAL authenticated principal rather than a hand-built execution context.
 *
 * Requirement → test map:
 *
 *   - **The gap HAZ-052 closes, proven closed** — `POST /api/v1/recipes` and `POST /api/v1/collections` return
 *     `423 ERASURE_IN_PROGRESS` (not 201) while the owner has a `queued`/`running` erasure job, and no
 *     row is written.
 *     → `describe('mutations are locked while an erasure job is in flight')`
 *   - **Reads stay unblocked** — `GET /api/v1/recipes` still `200`s for the same locked owner.
 *     → `describe('reads are never locked')`
 *   - **Per-owner isolation** — a DIFFERENT owner's mutation is unaffected by the first owner's lock.
 *     → `describe('the lock is scoped to the owner, not global')`
 *   - **Terminal jobs do not lock** — once the job is `completed`/`failed`, mutations are allowed again.
 *     → `describe('a terminal job does not lock')`
 *   - **The erasure-request endpoint itself is exempt** — `POST /api/v1/account/erasure` still answers its
 *     own C-007 idempotent `202` (not `423`) while a job is in flight.
 *     → `describe('POST /api/v1/account/erasure is exempt from its own lock')`
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { DrizzleProvider } from '../../../src/database/database.module.js';
import type { RecipeDrizzle } from '../../../src/database/client.js';
import { accountErasureJobs, type ErasureJobStatus } from '../../../src/database/schema/account.js';
import { recipes } from '../../../src/database/schema/recipes.js';
import { collections } from '../../../src/database/schema/collections.js';
import { ACCOUNT_ERASURE_CONFIRMATION_PHRASE } from '../../../src/account/dto/erasure.dto.js';

/** The primary dev-bypass owner ULID this suite locks. */
const OWNER = '01JERASURELOCKOWNERAAAAAAA';
/** A second owner used to prove the lock does not leak across accounts. */
const OTHER_OWNER = '01JERASURELOCKOWNERBBBBBBB';

/** A minimal, valid `CreateRecipeRequest` body — the seeded flour ingredient keeps it self-contained. */
const RECIPE_PAYLOAD = {
    title: 'Erasure Lock Probe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: [],
    dietaryFlags: [],
    ingredients: [
        {
            ingredientId: '00000000-0000-4000-8000-0000000000aa',
            name: 'Flour',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
        },
    ],
    steps: [{ instruction: 'Mix.' }],
};

/** The wire error envelope `ApiExceptionFilter` produces for a thrown `RecipeDomainError`. */
interface ErrorBody {
    code: string;
    message: string;
}

describe.skipIf(!hasDatabaseUrl)('ErasureLockGuard over the wire (HAZ-052 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;
    let db: RecipeDrizzle;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
        db = booted.app.get<RecipeDrizzle>(DrizzleProvider);
    });

    afterEach(async () => {
        await db.delete(accountErasureJobs).where(inArray(accountErasureJobs.ownerId, [OWNER, OTHER_OWNER]));
        await db.delete(recipes).where(inArray(recipes.ownerId, [OWNER, OTHER_OWNER]));
        await db.delete(collections).where(inArray(collections.ownerId, [OWNER, OTHER_OWNER]));
        // cloneVisibility.integration.test.ts documents why: the dev-auth bypass reads a
        // PROCESS-GLOBAL env var per request, so a test that authenticates as OTHER_OWNER must restore
        // the suite's primary identity afterward or leak into the next test.
        process.env['RECIPE_DEV_AUTH_USER_ID'] = OWNER;
    });

    afterAll(async () => {
        await booted?.close();
    });

    /** Insert a non-terminal (`queued`/`running`) or terminal erasure job row for the given owner. */
    async function seedJob(ownerId: string, status: ErasureJobStatus): Promise<void> {
        await db.insert(accountErasureJobs).values({ ownerId, status });
    }

    const postRecipe = (): Promise<Response> =>
        fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(RECIPE_PAYLOAD),
        });

    const postCollection = (): Promise<Response> =>
        fetch(`${baseUrl}/api/v1/collections`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Erasure Lock Probe' }),
        });

    describe('mutations are locked while an erasure job is in flight', () => {
        it.each<ErasureJobStatus>(['queued', 'running'])(
            'rejects POST /api/v1/recipes with 423 ERASURE_IN_PROGRESS while the job is %s, and writes nothing',
            async (status) => {
                await seedJob(OWNER, status);

                const response = await postRecipe();

                expect(response.status).toBe(423);
                const body = (await response.json()) as ErrorBody;
                expect(body.code).toBe('ERASURE_IN_PROGRESS');

                const rows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.ownerId, OWNER));
                expect(rows).toHaveLength(0);
            },
        );

        it('rejects POST /api/v1/collections with 423 while an erasure job is queued, and writes nothing', async () => {
            await seedJob(OWNER, 'queued');

            const response = await postCollection();

            expect(response.status).toBe(423);
            const body = (await response.json()) as ErrorBody;
            expect(body.code).toBe('ERASURE_IN_PROGRESS');

            const rows = await db
                .select({ id: collections.id })
                .from(collections)
                .where(eq(collections.ownerId, OWNER));
            expect(rows).toHaveLength(0);
        });
    });

    describe('reads are never locked', () => {
        it('still answers GET /api/v1/recipes with 200 while the owner has a queued erasure job', async () => {
            await seedJob(OWNER, 'queued');

            const response = await fetch(`${baseUrl}/api/v1/recipes`);

            expect(response.status).toBe(200);
        });
    });

    describe('the lock is scoped to the owner, not global', () => {
        it("does not block a DIFFERENT owner's mutation", async () => {
            await seedJob(OWNER, 'queued');

            process.env['RECIPE_DEV_AUTH_USER_ID'] = OTHER_OWNER;
            const response = await postRecipe();

            expect(response.status).toBe(201);

            const rows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.ownerId, OTHER_OWNER));
            expect(rows).toHaveLength(1);
        });
    });

    describe('a terminal job does not lock', () => {
        it.each<ErasureJobStatus>(['completed', 'failed'])(
            'allows POST /api/v1/recipes once the owner’s only job is %s',
            async (status) => {
                await seedJob(OWNER, status);

                const response = await postRecipe();

                expect(response.status).toBe(201);
            },
        );
    });

    describe('POST /api/v1/account/erasure is exempt from its own lock', () => {
        it('still answers 202 with the C-007 idempotent outcome — never 423 — while a job is in flight', async () => {
            await seedJob(OWNER, 'queued');

            const response = await fetch(`${baseUrl}/api/v1/account/erasure`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ confirmationPhrase: ACCOUNT_ERASURE_CONFIRMATION_PHRASE }),
            });

            expect(response.status).toBe(202);
        });
    });
});
