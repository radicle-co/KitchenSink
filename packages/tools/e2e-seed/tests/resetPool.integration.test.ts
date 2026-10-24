/**
 * `resetSlots` over a REAL HTTP wire, with the SHIPPED `RecipeServiceClient` parsing every answer — the reads, the
 * self-purge request and its status query (ADR-0040 §5).
 *
 * ⛔ What the unit tier cannot prove: that a reset issued as ONE slot purges only that slot (the bearer is what scopes
 * it, and a mock never carries a bearer anywhere), that the shipped client's parsing accepts the `202` and the
 * status bodies the purge depends on — against the zod the service publishes — and that a failed, stuck or refused
 * purge is reported without the next slot being skipped.
 *
 * ⚠️ The server below is an HTTP-level FAKE of the recipe service, not the service: it answers the published
 * contract's shapes and scopes by bearer because the contract says the service does. It does NOT prove that a
 * DEPLOYED recipe service purges what it claims, or that its worker runs — only a deployed run proves that, and the
 * reset's own post-purge read is the check that run carries.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { SessionHandle } from '@kitchensink/e2e-fixtures';
import { sessionSweepVia, SESSION_PAGE_SIZE, type SessionSweepClerk } from '@kitchensink/e2e-fixtures/lease';
import { k6VuSlots } from '@kitchensink/e2e-fixtures/testPool';
import { FoodServiceClient } from '@kitchensink/food-service-client';
import type { CollectionListItem } from '@kitchensink/schema-recipe';
import { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { authoredFoodPurgeVia, resetSlots } from '../src/resetPool.js';
import { settingsResetVia } from '../src/settingsReset.js';

/** Each bearer's library. A bearer the map does not hold answers 401, as the service would. */
let libraries: Map<string, { recipes: string[]; collections: string[] }>;
/** Bearers whose stage answers 503 to a list. */
let unavailable: Set<string>;
/**
 * How each bearer's purge job answers its status polls, in turn (the last repeats). Absent means `completed` at
 * once. A `completed` answer is when the fake purges the library — never at the request.
 */
let jobScripts: Map<string, ('queued' | 'running' | 'completed' | 'failed')[]>;
/** How many times the door answers 404 before it recognises each bearer (the registration race). */
let unregisteredPosts: Map<string, number>;
/** Bearers the door never recognises — not a registered test principal. */
let notTestPrincipals: Set<string>;
/** Each bearer's live job: its id and how many polls it has answered. */
let jobs: Map<string, { id: string; polls: number }>;
/** Each bearer's private authored foods on the fake food service. A bearer absent here is not a test principal. */
let authoredFoods: Map<string, string[]>;
/** Per bearer, the catalog roots its picks created (ADR-0040 food half; owner ruling 2026-10-16). */
let pickedRoots: Map<string, number>;
/** How many food-purge calls answer 503 before the door answers, per bearer (a cold food-service task). */
let coldFoodCalls: Map<string, number>;
/** Each bearer's chosen `recipeViewMode` on the fake identity service; absent means "never chosen" (no row). */
let chosenViews: Map<string, 'grid' | 'list'>;
/** When true the fake identity predates `DELETE /users/me/settings` and answers it 404, as an undeployed server does. */
let identityPredatesRoute: boolean;
/** `bearer METHOD path` for every request, so a test asserts on the traffic, not only the outcome. */
let traffic: string[];

let server: Server;
let baseUrl: string;

const recipeRow = (id: string) => ({
    id,
    ownerId: '01J0K6000000000000000000K6',
    title: `Load Test Recipe ${id}`,
    prepTimeMinutes: 1,
    cookTimeMinutes: 1,
    totalTimeMinutes: 2,
    servings: 2,
    visibility: 'private',
    status: 'published',
    sourceType: 'user_created',
    hasSubstantiveEdit: false,
    dietaryFlags: [],
    tags: [],
    currentVersion: 1,
    ratingCount: 0,
    usesPremiumCapability: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
});

/**
 * A collection LIST row, minimal against `collectionListItemSchema`, which REQUIRES `recipeCount` and
 * `coverPhotoUrls` — a row without them fails the client's parse, and the reset reports the slot as failed.
 */
const collectionRow = (id: string): CollectionListItem => ({
    id,
    ownerId: '01J0K6000000000000000000K6',
    name: `Pull load source ${id}`,
    visibility: 'private',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    recipeCount: 0,
    coverPhotoUrls: [],
});

const page = <T>(all: readonly T[], number: number, size: number) => ({
    data: all.slice((number - 1) * size, number * size),
    total: all.length,
    page: number,
    pageSize: size,
    hasMore: number * size < all.length,
});

beforeAll(async () => {
    server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const bearer = (req.headers.authorization ?? '').replace(/^Bearer /u, '');
        const library = libraries.get(bearer);

        const send = (status: number, body?: unknown): void => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(body === undefined ? '' : JSON.stringify(body));
        };

        traffic.push(`${bearer} ${req.method ?? ''} ${url.pathname}`);

        if (library === undefined) {
            send(401, { code: 'UNAUTHORIZED', message: 'no such bearer' });

            return;
        }

        const number = Number(url.searchParams.get('page') ?? '1');
        const size = Number(url.searchParams.get('pageSize') ?? '20');

        if (req.method === 'GET' && unavailable.has(bearer)) {
            send(503, { code: 'SERVICE_UNAVAILABLE', message: 'the stage is waking' });

            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/v1/recipes') {
            send(200, page(library.recipes.map(recipeRow), number, size));

            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/v1/collections') {
            send(200, page(library.collections.map(collectionRow), number, size));

            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/v1/foods/authored/test-purge') {
            const foods = authoredFoods.get(bearer);
            const cold = coldFoodCalls.get(bearer) ?? 0;

            if (cold > 0) {
                coldFoodCalls.set(bearer, cold - 1);
                send(503, { code: 'SERVICE_UNAVAILABLE', message: 'the task is starting' });

                return;
            }

            if (foods === undefined) {
                send(404, { code: 'NOT_FOUND', message: `Cannot POST ${url.pathname}` });

                return;
            }

            const deleted = foods.length;
            const roots = pickedRoots.get(bearer) ?? 0;

            foods.length = 0;
            pickedRoots.set(bearer, 0);
            send(200, { deletedAuthoredFoods: deleted, retainedPromotedFoods: 0, deletedPickedRoots: roots });

            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/v1/account/test-reset') {
            const pending = unregisteredPosts.get(bearer) ?? 0;

            if (notTestPrincipals.has(bearer) || pending > 0) {
                unregisteredPosts.set(bearer, pending - 1);
                send(404, { code: 'NOT_FOUND', message: 'Not found.' });

                return;
            }

            const job = jobs.get(bearer) ?? {
                id: `0b9f7c1e-4a5d-4c7e-9f1a-${String(jobs.size).padStart(12, '0')}`,
                polls: 0,
            };

            jobs.set(bearer, job);
            send(202, { jobId: job.id, status: 'queued' });

            return;
        }

        if (req.method === 'GET' && url.pathname.startsWith('/api/v1/account/test-reset/')) {
            const job = jobs.get(bearer);

            // Another principal's job, or none: the door's one answer.
            if (job === undefined || url.pathname.split('/').at(-1) !== job.id) {
                send(404, { code: 'NOT_FOUND', message: 'Not found.' });

                return;
            }

            const script = jobScripts.get(bearer) ?? ['completed'];
            const status = script[Math.min(job.polls, script.length - 1)] ?? 'completed';

            job.polls += 1;

            if (status === 'completed') {
                library.recipes.length = 0;
                library.collections.length = 0;
            }

            send(200, {
                jobId: job.id,
                status,
                createdAt: '2026-09-14T00:00:00.000Z',
                updatedAt: '2026-09-14T00:00:01.000Z',
            });

            return;
        }

        if (req.method === 'DELETE' && url.pathname === '/api/v1/users/me/settings') {
            if (identityPredatesRoute) {
                send(404, { code: 'NOT_FOUND', message: `Cannot DELETE ${url.pathname}` });

                return;
            }

            // Scoped to the bearer, as the route is: it names no one else's row, and no row is still a 204.
            chosenViews.delete(bearer);
            send(204);

            return;
        }

        if (req.method === 'DELETE') {
            const id = url.pathname.split('/').at(-1) ?? '';
            const owned = url.pathname.startsWith('/api/v1/recipes/') ? library.recipes : library.collections;

            // Owner-scoped, as the service is: another bearer's id is a 404, never a delete.
            if (!owned.includes(id)) {
                send(404, { code: 'NOT_FOUND', message: id });

                return;
            }

            owned.splice(owned.indexOf(id), 1);
            send(204);

            return;
        }

        send(404, { code: 'NOT_FOUND', message: url.pathname });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
    libraries = new Map();
    unavailable = new Set();
    traffic = [];
    jobScripts = new Map();
    unregisteredPosts = new Map();
    notTestPrincipals = new Set();
    jobs = new Map();
    authoredFoods = new Map();
    pickedRoots = new Map();
    coldFoodCalls = new Map();
    chosenViews = new Map();
    identityPredatesRoute = false;
});

const handle = (bearer: string): SessionHandle => ({
    sessionId: bearer,
    devJwt: 'dev',
    fapi: 'https://x.clerk.accounts.dev/v1',
    origin: 'https://pr-91.sandbox.commise.app',
    email: bearer,
});

/** The shipped client, authenticating with the handle's session id as its bearer. */
const client = (session: SessionHandle): RecipeServiceClient =>
    new RecipeServiceClient({ baseUrl, token: session.sessionId, timeoutMs: 10_000 });

/** Poll every few milliseconds and give up in well under a second: the fake answers instantly. */
const fastPurge = { intervalMs: 5, deadlineMs: 500 };

describe('resetSlots over a real wire', () => {
    const [alfa, bravo, charlie] = k6VuSlots(3);

    it('purges each slot’s OWN library, waits for the job, and leaves a library nobody leased untouched', async () => {
        libraries.set('alfa', { recipes: ['a1', 'a2'], collections: ['ac1'] });
        libraries.set('bravo', { recipes: Array.from({ length: 130 }, (_, i) => `b${i}`), collections: [] });
        libraries.set('realUser', { recipes: ['keep'], collections: ['keepToo'] });
        jobScripts.set('alfa', ['queued', 'running', 'completed']);

        const outcomes = await resetSlots([alfa!, bravo!], {
            session: async (slot) => handle(slot.id),
            client,
            purge: fastPurge,
            authoredFoods: undefined,
            settings: undefined,
        });

        expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true]);
        // Counted over every page — a reset that read one page would report thirty rows short.
        expect(outcomes[1]).toMatchObject({ deletedRecipes: 130, deletedCollections: 0 });
        expect(libraries.get('alfa')).toEqual({ recipes: [], collections: [] });
        expect(libraries.get('bravo')).toEqual({ recipes: [], collections: [] });
        expect(libraries.get('realUser')).toEqual({ recipes: ['keep'], collections: ['keepToo'] });
        expect(traffic.some((line) => line.startsWith('realUser'))).toBe(false);
        // Polled to completion, not fired and forgotten: three status answers for alfa's scripted job.
        expect(traffic.filter((line) => /^alfa GET \/api\/v1\/account\/test-reset\//u.test(line))).toHaveLength(3);
        // The purge is the reset: no soft delete, which a purge in flight would answer 423.
        expect(traffic.filter((line) => line.includes('DELETE'))).toEqual([]);
    });

    it('fails a slot whose purge job FAILS, naming the job, and still purges the slot after it', async () => {
        libraries.set('alfa', { recipes: ['a1'], collections: [] });
        libraries.set('bravo', { recipes: ['b1'], collections: [] });
        jobScripts.set('alfa', ['running', 'failed']);

        const outcomes = await resetSlots([alfa!, bravo!], {
            session: async (slot) => handle(slot.id),
            client,
            purge: fastPurge,
            authoredFoods: undefined,
            settings: undefined,
        });

        expect(outcomes[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/failed on the worker/u) });
        expect(outcomes[1]).toMatchObject({ ok: true, deletedRecipes: 1 });
        expect(libraries.get('bravo')).toEqual({ recipes: [], collections: [] });
    });

    it('fails a slot whose purge is still running at the deadline', async () => {
        libraries.set('alfa', { recipes: ['a1'], collections: [] });
        jobScripts.set('alfa', ['running']);

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handle(slot.id),
            client,
            purge: { intervalMs: 5, deadlineMs: 60 },
            authoredFoods: undefined,
            settings: undefined,
        });

        expect(outcome).toMatchObject({
            ok: false,
            reason: expect.stringMatching(/did not complete within .*running/u),
        });
        expect(libraries.get('alfa')).toEqual({ recipes: ['a1'], collections: [] });
    });

    it('rides out the registration race: a 404 then a 202 is a reset, over the real client', async () => {
        libraries.set('alfa', { recipes: ['a1'], collections: [] });
        unregisteredPosts.set('alfa', 1);

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handle(slot.id),
            client,
            purge: fastPurge,
            authoredFoods: undefined,
            settings: undefined,
        });

        expect(outcome).toMatchObject({ ok: true, deletedRecipes: 1 });
        expect(traffic.filter((line) => line === 'alfa POST /api/v1/account/test-reset')).toHaveLength(2);
    });

    it('fails a slot the door never recognises (404 twice), having polled nothing', async () => {
        libraries.set('alfa', { recipes: ['a1'], collections: [] });
        notTestPrincipals.add('alfa');

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handle(slot.id),
            client,
            purge: fastPurge,
            authoredFoods: undefined,
            settings: undefined,
        });

        expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/registered test principal/u) });
        expect(traffic.filter((line) => line.startsWith('alfa GET /api/v1/account/test-reset/'))).toEqual([]);
        expect(libraries.get('alfa')).toEqual({ recipes: ['a1'], collections: [] });
    });

    describe('the authored-food half, through the SHIPPED FoodServiceClient', () => {
        /** The shipped food client, authenticating with the handle's session id as its bearer. */
        const foods = authoredFoodPurgeVia((session) => new FoodServiceClient({ baseUrl, token: session.sessionId }), {
            retries: 2,
            intervalMs: 5,
        });

        it('purges each slot’s own authored foods after its recipe purge, and reports the count', async () => {
            libraries.set('alfa', { recipes: ['a1'], collections: [] });
            libraries.set('bravo', { recipes: [], collections: [] });
            libraries.set('realUser', { recipes: [], collections: [] });
            authoredFoods.set('alfa', ['f1', 'f2']);
            authoredFoods.set('bravo', []);
            authoredFoods.set('realUser', ['keep']);
            pickedRoots.set('alfa', 2);
            pickedRoots.set('realUser', 5);

            const outcomes = await resetSlots([alfa!, bravo!], {
                session: async (slot) => handle(slot.id),
                client,
                purge: fastPurge,
                authoredFoods: foods,
                settings: undefined,
            });

            expect(outcomes).toMatchObject([
                { ok: true, authoredFoods: 2, pickedRoots: 2 },
                { ok: true, authoredFoods: 0, pickedRoots: 0 },
            ]);
            // The purge is the slot's own: another principal's picked roots are not touched.
            expect(pickedRoots.get('realUser')).toBe(5);
            expect(authoredFoods.get('alfa')).toEqual([]);
            expect(authoredFoods.get('realUser')).toEqual(['keep']);
            const order = traffic.filter((line) => line.startsWith('alfa '));
            const lastPoll = order.map((line) => line.includes('/account/test-reset/')).lastIndexOf(true);

            expect(lastPoll).toBeGreaterThan(-1);
            expect(order.findIndex((line) => line.includes('/foods/authored/test-purge'))).toBeGreaterThan(lastPoll);
        });

        it('rides out a cold food-service task (503, 503, then 200) — the recipe half tolerates the same', async () => {
            libraries.set('alfa', { recipes: [], collections: [] });
            authoredFoods.set('alfa', ['f1']);
            coldFoodCalls.set('alfa', 2);

            const [outcome] = await resetSlots([alfa!], {
                session: async (slot) => handle(slot.id),
                client,
                purge: fastPurge,
                authoredFoods: foods,
                settings: undefined,
            });

            expect(outcome).toMatchObject({ ok: true, authoredFoods: 1 });
        });

        it('⛔ fails a slot whose food-service never recovers inside the retry bound, naming the food half', async () => {
            libraries.set('alfa', { recipes: [], collections: [] });
            authoredFoods.set('alfa', ['f1']);
            coldFoodCalls.set('alfa', 99);

            const [outcome] = await resetSlots([alfa!], {
                session: async (slot) => handle(slot.id),
                client,
                purge: fastPurge,
                authoredFoods: foods,
                settings: undefined,
            });

            expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/authored foods were not/u) });
            expect(traffic.filter((line) => line === 'alfa POST /api/v1/foods/authored/test-purge')).toHaveLength(3);
        });

        it('never retries a food-door 404 — a refusal is not a cold start', async () => {
            libraries.set('alfa', { recipes: [], collections: [] });

            await resetSlots([alfa!], {
                session: async (slot) => handle(slot.id),
                client,
                purge: fastPurge,
                authoredFoods: foods,
                settings: undefined,
            });

            expect(traffic.filter((line) => line === 'alfa POST /api/v1/foods/authored/test-purge')).toHaveLength(1);
        });

        it('⛔ fails a slot the food door refuses (404), naming the food half — never a green reset over it', async () => {
            libraries.set('alfa', { recipes: ['a1'], collections: [] });

            const [outcome] = await resetSlots([alfa!], {
                session: async (slot) => handle(slot.id),
                client,
                purge: fastPurge,
                authoredFoods: foods,
                settings: undefined,
            });

            expect(outcome).toMatchObject({
                ok: false,
                reason: expect.stringMatching(/authored foods were not.*test principal/u),
            });
        });
    });

    describe('the settings half, through the SHIPPED identity adapter (ADR-0059)', () => {
        // The shipped adapter, authenticating with the handle's session id as its bearer. Built per test because
        // `baseUrl` is assigned in `beforeAll`.
        const adapter = () =>
            settingsResetVia(baseUrl, {
                token: (session) => async () => session.sessionId,
                retry: { retries: 2, intervalMs: 5, attemptDeadlineMs: 2_000 },
            });

        it("restores each slot to never chosen AFTER its purge, and leaves another user's choice alone", async () => {
            libraries.set('alfa', { recipes: ['a1'], collections: [] });
            libraries.set('bravo', { recipes: [], collections: [] });
            libraries.set('realUser', { recipes: [], collections: [] });
            chosenViews.set('alfa', 'grid');
            chosenViews.set('realUser', 'list');

            const outcomes = await resetSlots([alfa!, bravo!], {
                session: async (slot) => handle(slot.id),
                client,
                purge: fastPurge,
                authoredFoods: undefined,
                settings: adapter(),
            });

            expect(outcomes).toMatchObject([
                { ok: true, settings: 'reset' },
                { ok: true, settings: 'reset' },
            ]);
            expect(chosenViews.has('alfa')).toBe(false);
            expect(chosenViews.get('realUser')).toBe('list');
            const order = traffic.filter((line) => line.startsWith('alfa '));
            const lastPoll = order.map((line) => line.includes('/account/test-reset/')).lastIndexOf(true);

            expect(order.findIndex((line) => line === 'alfa DELETE /api/v1/users/me/settings')).toBeGreaterThan(
                lastPoll,
            );
        });

        it('⛔ fails a slot when identity predates the route (404), naming the settings half — never a green over a stale view', async () => {
            libraries.set('alfa', { recipes: [], collections: [] });
            chosenViews.set('alfa', 'grid');
            identityPredatesRoute = true;

            const [outcome] = await resetSlots([alfa!], {
                session: async (slot) => handle(slot.id),
                client,
                purge: fastPurge,
                authoredFoods: undefined,
                settings: adapter(),
            });

            expect(outcome).toMatchObject({
                ok: false,
                reason: expect.stringMatching(/settings were not reset.*answered 404/u),
            });
            expect(chosenViews.get('alfa')).toBe('grid');
            // A refusal is final: asked once, not retried.
            expect(traffic.filter((line) => line === 'alfa DELETE /api/v1/users/me/settings')).toHaveLength(1);
        });

        it('is idempotent: a slot that never chose anything is reset to the same state', async () => {
            libraries.set('alfa', { recipes: [], collections: [] });

            const [outcome] = await resetSlots([alfa!], {
                session: async (slot) => handle(slot.id),
                client,
                purge: fastPurge,
                authoredFoods: undefined,
                settings: adapter(),
            });

            expect(outcome).toMatchObject({ ok: true, settings: 'reset' });
        });
    });

    describe('the session sweep, through the SHIPPED Clerk adapter over a fake Clerk client', () => {
        /** A Clerk fake holding `count` active sessions for one user, the first of which is the held one. */
        const fakeClerk = (count: number, heldId: string) => {
            const live = new Set<string>([heldId, ...Array.from({ length: count - 1 }, (_, index) => `sess_${index}`)]);
            const revoked: string[] = [];
            const clerk: SessionSweepClerk = {
                users: { getUserList: async () => ({ data: [{ id: 'user_alfa' }] }) },
                sessions: {
                    getSessionList: async ({ status, limit, offset }) => ({
                        data: [...live]
                            .slice(offset, offset + limit)
                            .map((id) => ({ id, status: status === 'active' ? 'active' : 'ended' })),
                    }),
                    revokeSession: async (id) => {
                        live.delete(id);
                        revoked.push(id);
                    },
                },
            };

            return { clerk, live, revoked };
        };

        it('ends every stray session of the slot over several pages after its purge, and keeps the held one', async () => {
            libraries.set('alfa', { recipes: ['a1'], collections: [] });
            const held = { ...handle('alfa'), email: alfa!.email };
            const total = SESSION_PAGE_SIZE * 2 + 7;
            const fake = fakeClerk(total, 'alfa');

            const [outcome] = await resetSlots([alfa!], {
                session: async () => held,
                client,
                purge: fastPurge,
                authoredFoods: undefined,
                settings: undefined,
                sessions: sessionSweepVia(fake.clerk),
            });

            expect(outcome).toMatchObject({ ok: true, sessionsEnded: total - 1 });
            expect([...fake.live]).toEqual(['alfa']);
            expect(fake.revoked).not.toContain('alfa');
            expect(traffic.some((line) => line.includes('POST /api/v1/account/test-reset'))).toBe(true);
        });

        it('ends nothing when the purge failed', async () => {
            libraries.set('alfa', { recipes: ['a1'], collections: [] });
            jobScripts.set('alfa', ['failed']);
            const held = { ...handle('alfa'), email: alfa!.email };
            const fake = fakeClerk(5, 'alfa');

            const [outcome] = await resetSlots([alfa!], {
                session: async () => held,
                client,
                purge: fastPurge,
                authoredFoods: undefined,
                settings: undefined,
                sessions: sessionSweepVia(fake.clerk),
            });

            expect(outcome).toMatchObject({ ok: false });
            expect(fake.revoked).toEqual([]);
        });
    });

    it('reports a slot whose stage answers 503, and still resets the slot after it', async () => {
        libraries.set('alfa', { recipes: ['a1'], collections: [] });
        libraries.set('bravo', { recipes: ['b1'], collections: [] });
        libraries.set('charlie', { recipes: ['c1'], collections: [] });
        unavailable.add('bravo');

        const outcomes = await resetSlots([alfa!, bravo!, charlie!], {
            session: async (slot) => handle(slot.id),
            client,
            purge: fastPurge,
            authoredFoods: undefined,
            settings: undefined,
        });

        expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false, true]);
        expect(libraries.get('bravo')).toEqual({ recipes: ['b1'], collections: [] });
        expect(libraries.get('charlie')).toEqual({ recipes: [], collections: [] });
    });

    it('reports a slot whose session the stage refuses (401) as failed, having requested no purge', async () => {
        const outcomes = await resetSlots([alfa!], {
            session: async () => handle('revoked'),
            client,
            purge: fastPurge,
            authoredFoods: undefined,
            settings: undefined,
        });

        expect(outcomes[0]?.ok).toBe(false);
        expect(traffic.filter((line) => line.includes('POST'))).toEqual([]);
    });
});
