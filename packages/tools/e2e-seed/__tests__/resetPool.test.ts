/**
 * `resetPool` — the test-principal self-purge (ADR-0040 §5) every leasing tier runs before its tests and again,
 * `always()`, after.
 *
 * The properties asserted are the ones a CI step leans on without being able to see: which slots a tier resets
 * (never a consumable one, never another tier's), that the purge is REQUESTED and WAITED ON rather than fired and
 * forgotten, that a failed, stuck, refused or empty-handed purge fails its slot, that one slot's failure never
 * abandons the others, and that a stored session is reused before a throttled sign-in is spent.
 *
 * ⚠️ These tests were rewritten, not extended, when the reset moved from the Phase-1 soft delete to the purge: the
 * old ones asserted the soft deletes, which a purge in flight answers with `423`, so they described a reset that
 * can no longer be correct.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { SessionCredential, SessionHandle } from '@kitchensink/e2e-fixtures';
import { consumableSlots, k6VuSlots, slotFor, slotForShard } from '@kitchensink/e2e-fixtures/testPool';
import { NotFoundError, UnexpectedResponseError, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { describe, expect, it, vi } from 'vitest';

import { describeOutcomes, parseResetArgs, resetSlots, resetTargets, sessionSource } from '../src/resetPool.js';

const handleFor = (email: string): SessionHandle => ({
    sessionId: `sess_${email}`,
    devJwt: 'dev',
    fapi: 'https://x.clerk.accounts.dev/v1',
    origin: 'https://pr-91.sandbox.commise.app',
    email,
});

describe('parseResetArgs', () => {
    it.each([
        [['--tier', 'web', '--shard', '3'], { tier: 'web', shard: 3 }],
        [['--tier', 'maestro'], { tier: 'maestro' }],
        [['--tier', 'k6', '--vus', '10'], { tier: 'k6', vus: 10 }],
        [['--tier', 'linkage'], { tier: 'linkage' }],
    ])('reads %j', (argv, expected) => {
        expect(parseResetArgs(argv)).toEqual(expected);
    });

    it.each([
        [[], /--tier/u],
        [['--tier', 'webStub', '--shard', '1'], /--tier/u],
        [['--tier', 'nope'], /--tier/u],
        [['--tier', 'web'], /--shard/u],
        [['--tier', 'web', '--shard', 'x'], /--shard/u],
        [['--tier', 'k6'], /--vus/u],
        [['--tier', 'k6', '--vus', '0'], /--vus/u],
    ])('refuses %j', (argv, message) => {
        expect(() => parseResetArgs(argv)).toThrow(message);
    });
});

describe('resetTargets', () => {
    it('resets exactly the shard’s own web slot', () => {
        expect(resetTargets({ tier: 'web', shard: 3 })).toEqual([slotForShard('web', 3)]);
    });

    it('resets the maestro signer and co-author and NEVER an erasure subject', () => {
        const targets = resetTargets({ tier: 'maestro' });

        expect(targets.map((slot) => slot.id)).toEqual(['signer', 'coauthor']);
        expect(targets.some((slot) => consumableSlots('maestro').includes(slot))).toBe(false);
    });

    it('resets the k6 VUs the run used plus the admin', () => {
        expect(resetTargets({ tier: 'k6', vus: 4 })).toEqual([...k6VuSlots(4), slotFor('k6', 'admin')]);
    });

    it('resets the linkage slot', () => {
        expect(resetTargets({ tier: 'linkage' })).toEqual([slotFor('linkage', 'linkage')]);
    });
});

/** How one fake stage answers the self-purge door for one slot. */
interface DoorScript {
    /** Each POST's answer in turn, the last repeating: `'accept'` or an error to throw. */
    readonly posts?: readonly PostAnswer[];
    /** Each status poll's answer in turn, the last repeating: a status or an error to throw. */
    readonly polls?: readonly PollAnswer[];
    /** When true, a completed purge leaves the library as it was — a purge that reported success and removed nothing. */
    readonly purgeLeavesRows?: boolean;
    readonly failList?: boolean;
    /** Told of every door call as it happens (`POST`, or `GET <status>`), so a test can assert the ORDER of calls. */
    readonly onEvent?: (event: string) => void;
    /** When present, decides every poll's answer at the moment it is asked, instead of `polls`. */
    readonly pollNow?: () => PollAnswer;
}

type PostAnswer = 'accept' | Error;
type PollAnswer = 'queued' | 'running' | 'completed' | 'failed' | Error;

/**
 * A client over an in-memory library: the two paged reads, the self-purge door, and the soft deletes a reset must
 * no longer issue (a purge in flight answers every mutation `423`, so a delete there is a failed reset, not a
 * belt-and-braces one).
 */
function fakeLibrary(recipes: readonly string[], collections: readonly string[], script: DoorScript = {}) {
    const state = {
        recipes: [...recipes],
        collections: [...collections],
        deleted: [] as string[],
        posts: 0,
        polls: 0,
    };
    const page = <T>(data: readonly T[]) => ({ data, total: data.length, page: 1, pageSize: 100, hasMore: false });
    const nth = <T>(answers: readonly T[], index: number): T => answers[Math.min(index, answers.length - 1)]!;
    const client = {
        listRecipes: vi.fn(async () => {
            if (script.failList === true) {
                throw new Error('503 from the stage');
            }

            return page(state.recipes.map((id) => ({ id, title: id })));
        }),
        listCollections: vi.fn(async () => page(state.collections.map((id) => ({ id })))),
        deleteRecipe: vi.fn(async (id: string) => {
            state.deleted.push(`recipe ${id}`);
        }),
        deleteCollection: vi.fn(async (id: string) => {
            state.deleted.push(`collection ${id}`);
        }),
        requestTestReset: vi.fn(async () => {
            const answer = nth<PostAnswer>(script.posts ?? ['accept'], state.posts);

            state.posts += 1;
            script.onEvent?.('POST');

            if (answer instanceof Error) {
                throw answer;
            }

            return { jobId: JOB_ID, status: 'queued' as const };
        }),
        getTestReset: vi.fn(async (jobId: string) => {
            const answer = script.pollNow?.() ?? nth<PollAnswer>(script.polls ?? ['completed'], state.polls);

            state.polls += 1;
            script.onEvent?.(`GET ${answer instanceof Error ? answer.message : answer}`);

            if (answer instanceof Error) {
                throw answer;
            }

            if (answer === 'completed' && script.purgeLeavesRows !== true) {
                state.recipes = [];
                state.collections = [];
            }

            return {
                jobId,
                status: answer,
                createdAt: '2026-09-14T00:00:00.000Z',
                updatedAt: '2026-09-14T00:00:00.000Z',
            };
        }),
    };

    return { state, client: client as unknown as RecipeServiceClient };
}

const JOB_ID = '0b9f7c1e-4a5d-4c7e-9f1a-2b3c4d5e6f70';

/** No real waiting: poll every millisecond, give up after a fraction of a second. */
const fastPurge = { intervalMs: 1, deadlineMs: 200 };

describe('resetSlots', () => {
    const [alfa, bravo] = k6VuSlots(2);

    it('purges every slot through its OWN session and confirms the library is empty afterwards', async () => {
        const libraries = new Map([
            [alfa?.email, fakeLibrary(['r1', 'r2'], ['c1'], { polls: ['queued', 'running', 'completed'] })],
            [bravo?.email, fakeLibrary(['r3'], [])],
        ]);

        const outcomes = await resetSlots([alfa!, bravo!], {
            session: async (slot) => handleFor(slot.email),
            client: (handle) => libraries.get(handle.email)!.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcomes).toEqual([
            {
                slot: alfa,
                ok: true,
                jobId: JOB_ID,
                deletedRecipes: 2,
                deletedCollections: 1,
                authoredFoods: 'notPurged',
            },
            {
                slot: bravo,
                ok: true,
                jobId: JOB_ID,
                deletedRecipes: 1,
                deletedCollections: 0,
                authoredFoods: 'notPurged',
            },
        ]);
        expect(libraries.get(alfa?.email)?.state).toMatchObject({ posts: 1, polls: 3, recipes: [], collections: [] });
        expect(libraries.get(bravo?.email)?.state).toMatchObject({ posts: 1, recipes: [], collections: [] });
    });

    it('⛔ issues NO soft delete — the purge owns the whole reset, and a delete during it would answer 423', async () => {
        const library = fakeLibrary(['r1'], ['c1']);

        await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => library.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(library.state.deleted).toEqual([]);
    });

    it('keeps waiting on a purge while the NEXT slot is requested, so the step takes the slowest purge, not the sum', async () => {
        let bravoRequested = false;
        // alfa's job cannot finish until bravo's purge has been requested: a reset that awaited alfa to the end
        // before moving on would run alfa into its deadline and fail it.
        const alfaLibrary = fakeLibrary(['r1'], [], { pollNow: () => (bravoRequested ? 'completed' : 'running') });

        const libraries = new Map([
            [alfa?.email, alfaLibrary],
            [
                bravo?.email,
                fakeLibrary(['r2'], [], {
                    onEvent: (event) => {
                        if (event === 'POST') {
                            bravoRequested = true;
                        }
                    },
                }),
            ],
        ]);

        const outcomes = await resetSlots([alfa!, bravo!], {
            session: async (slot) => {
                // The second sign-in is slow, as a throttled lease is; alfa's wait must already be running.
                if (slot === bravo) {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }

                return handleFor(slot.email);
            },
            client: (handle) => libraries.get(handle.email)!.client,
            purge: { intervalMs: 1, deadlineMs: 400 },
            authoredFoods: undefined,
        });

        expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true]);
        expect(alfaLibrary.state.polls).toBeGreaterThan(1);
    });

    it('⛔ a FAILED purge job fails the slot, naming the job, and never abandons the slots after it', async () => {
        const failing = fakeLibrary(['r1'], [], { polls: ['running', 'failed'] });
        const healthy = fakeLibrary(['r9'], []);

        const outcomes = await resetSlots([alfa!, bravo!], {
            session: async (slot) => handleFor(slot.email),
            client: (handle) => (handle.email === alfa?.email ? failing.client : healthy.client),
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcomes[0]).toMatchObject({ slot: alfa, ok: false, reason: expect.stringMatching(/failed/u) });
        expect(outcomes[0]).toMatchObject({ reason: expect.stringContaining(JOB_ID) });
        expect(outcomes[1]).toMatchObject({ slot: bravo, ok: true, deletedRecipes: 1 });
    });

    it('⛔ a purge that never finishes inside the deadline fails the slot rather than waiting forever', async () => {
        const stuck = fakeLibrary(['r1'], [], { polls: ['running'] });

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => stuck.client,
            purge: { intervalMs: 1, deadlineMs: 30 },
            authoredFoods: undefined,
        });

        expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/did not complete within/u) });
        expect(outcome).toMatchObject({ reason: expect.stringMatching(/running/u) });
    });

    it('⛔ a purge that reports completed while the library still lists rows fails the slot', async () => {
        const lying = fakeLibrary(['r1', 'r2'], ['c1'], { purgeLeavesRows: true });

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => lying.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/2 recipes and 1 collections/u) });
    });

    it('retries the door ONCE on a 404 — the service registers a test principal on its next authenticated request', async () => {
        const racing = fakeLibrary(['r1'], [], { posts: [new NotFoundError('Not found.'), 'accept'] });

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => racing.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcome).toMatchObject({ ok: true });
        expect(racing.state.posts).toBe(2);
    });

    it('⛔ a door that keeps answering 404 fails the slot and says why a green reset would have been a lie', async () => {
        const absent = fakeLibrary(['r1'], [], { posts: [new NotFoundError('Not found.')] });

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => absent.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/test principal/u) });
        expect(absent.state.posts).toBe(2);
        expect(absent.state.polls).toBe(0);
    });

    it('rides out a transient 5xx while polling — the purge is still running server-side', async () => {
        const blip = fakeLibrary(['r1'], [], {
            polls: [new UnexpectedResponseError(503), 'running', 'completed'],
        });

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => blip.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcome).toMatchObject({ ok: true });
    });

    it('does not retry a poll the service REFUSED (404) — only a pending job or a transient failure waits', async () => {
        const refused = fakeLibrary(['r1'], [], { polls: [new NotFoundError('Not found.'), 'completed'] });

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => refused.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcome).toMatchObject({ ok: false });
        expect(refused.state.polls).toBe(1);
    });

    it('⛔ a failing session is REPORTED and never abandons the slots after it', async () => {
        const healthy = fakeLibrary(['r9'], []);

        const outcomes = await resetSlots([alfa!, bravo!], {
            session: async (slot) => {
                if (slot === alfa) {
                    throw new Error('Clerk refused the sign-in create');
                }

                return handleFor(slot.email);
            },
            client: () => healthy.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcomes[0]).toEqual({ slot: alfa, ok: false, reason: 'Clerk refused the sign-in create' });
        expect(outcomes[1]).toMatchObject({ slot: bravo, ok: true, deletedRecipes: 1 });
    });

    it('purges each slot’s AUTHORED foods through its own session, only once its recipe purge has completed', async () => {
        const events: string[] = [];
        const libraries = new Map([
            [
                alfa?.email,
                fakeLibrary(['r1'], [], {
                    polls: ['running', 'completed'],
                    onEvent: (event) => events.push(`alfa ${event}`),
                }),
            ],
            [bravo?.email, fakeLibrary(['r2'], [])],
        ]);

        const outcomes = await resetSlots([alfa!, bravo!], {
            session: async (slot) => handleFor(slot.email),
            client: (handle) => libraries.get(handle.email)!.client,
            purge: fastPurge,
            authoredFoods: {
                purgeOwn: async (handle) => {
                    events.push(`foods ${handle.email}`);

                    return handle.email === alfa?.email ? 3 : 0;
                },
            },
        });

        expect(outcomes[0]).toMatchObject({ ok: true, authoredFoods: 3 });
        expect(outcomes[1]).toMatchObject({ ok: true, authoredFoods: 0 });
        expect(events.indexOf('alfa GET completed')).toBeGreaterThan(-1);
        expect(events.indexOf(`foods ${alfa?.email}`)).toBeGreaterThan(events.indexOf('alfa GET completed'));
    });

    it('⛔ an authored-food purge that fails fails the slot, saying which half failed', async () => {
        const library = fakeLibrary(['r1'], []);

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => library.client,
            purge: fastPurge,
            authoredFoods: {
                purgeOwn: async () => {
                    throw new Error('food-service answered 503');
                },
            },
        });

        expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/authored foods.*503/u) });
    });

    it('never purges authored foods for a slot whose recipe purge failed', async () => {
        const library = fakeLibrary(['r1'], [], { polls: ['failed'] });
        const purgeOwn = vi.fn(async () => 0);

        await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => library.client,
            purge: fastPurge,
            authoredFoods: { purgeOwn },
        });

        expect(purgeOwn).not.toHaveBeenCalled();
    });

    it('⛔ the CLI wires the food-service adapter — a reset that skipped authored foods would say so on every line, but must not', () => {
        // `main()` is the Facade and reads the environment, so it is checked at its source: the port must be the
        // food-service adapter, never `undefined`. The adapter itself is exercised over a real wire in
        // `tests/resetPool.integration.test.ts`.
        const cli = readFileSync(fileURLToPath(new URL('../src/resetPool.ts', import.meta.url)), 'utf8');
        const main = cli.slice(cli.indexOf('async function main'));

        expect(main).toMatch(/authoredFoods: authoredFoodPurgeVia\(/u);
        expect(main).not.toMatch(/authoredFoods: undefined/u);
    });

    it('reports a slot whose library cannot be read as failed, having requested no purge', async () => {
        const broken = fakeLibrary(['r1'], [], { failList: true });

        const [outcome] = await resetSlots([alfa!], {
            session: async (slot) => handleFor(slot.email),
            client: () => broken.client,
            purge: fastPurge,
            authoredFoods: undefined,
        });

        expect(outcome).toMatchObject({ ok: false, reason: expect.stringMatching(/503/u) });
        expect(broken.state.posts).toBe(0);
    });
});

describe('sessionSource', () => {
    const [alfa] = k6VuSlots(1);
    const credential: SessionCredential = { token: 't', azp: 'a', sub: 's' };

    it('reuses a stored handle that still re-mints, without signing in', async () => {
        const stored = handleFor(alfa!.email);
        const lease = vi.fn();
        const source = sessionSource({
            handles: { [alfa!.id]: stored },
            remint: vi.fn().mockResolvedValue(credential),
            lease,
            log: () => undefined,
        });

        await expect(source(alfa!)).resolves.toBe(stored);
        expect(lease).not.toHaveBeenCalled();
    });

    it('leases a fresh session when the stored handle no longer re-mints, and says so', async () => {
        const fresh = handleFor('fresh');
        const log = vi.fn();
        const source = sessionSource({
            handles: { [alfa!.id]: handleFor(alfa!.email) },
            remint: vi.fn().mockRejectedValue(new Error('session gone')),
            lease: vi.fn().mockResolvedValue(fresh),
            log,
        });

        await expect(source(alfa!)).resolves.toBe(fresh);
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/session gone/u));
    });

    it('leases when no handle is stored for the slot', async () => {
        const fresh = handleFor('fresh');
        const lease = vi.fn().mockResolvedValue(fresh);
        const source = sessionSource({ handles: {}, remint: vi.fn(), lease, log: () => undefined });

        await expect(source(alfa!)).resolves.toBe(fresh);
        expect(lease).toHaveBeenCalledWith(alfa);
    });
});

describe('describeOutcomes', () => {
    const [alfa, bravo] = k6VuSlots(2);

    it('names each slot and ends in the verdict the CLI exits on', () => {
        const lines = describeOutcomes([
            { slot: alfa!, ok: true, jobId: 'job-1', deletedRecipes: 2, deletedCollections: 0, authoredFoods: 4 },
            { slot: bravo!, ok: false, reason: 'boom' },
        ]);

        expect(lines).toEqual([
            'reset k6/alfa: purged by job job-1, -2 recipes, -0 collections, -4 authored foods',
            'FAILED k6/bravo: boom',
            '1 of 2 slots could NOT be reset',
        ]);
    });

    it('⛔ says in every line that authored foods were NOT purged when no door is wired — a green reset claims only what it did', () => {
        const [line] = describeOutcomes([
            {
                slot: alfa!,
                ok: true,
                jobId: 'job-1',
                deletedRecipes: 0,
                deletedCollections: 0,
                authoredFoods: 'notPurged',
            },
        ]);

        expect(line).toMatch(/authored foods NOT purged/u);
    });

    it('reports success only when every slot reset', () => {
        expect(
            describeOutcomes([
                { slot: alfa!, ok: true, jobId: 'job-1', deletedRecipes: 0, deletedCollections: 0, authoredFoods: 0 },
            ]).at(-1),
        ).toBe('all 1 slots reset');
    });
});
