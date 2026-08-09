import { describe, expect, it } from 'vitest';

import type { CookingSession } from '../src/types.js';
import {
    SESSION_RESUME_WINDOW_MS,
    clearSession,
    persistSession,
    restoreSession,
    type CookingSessionStore,
} from '../src/sessionPersistence.js';

/**
 * T-021 — integration test for session persistence and the 24h resume window (FR-033 / REQ-013,
 * plan.md §8 "Session Resume").
 *
 * The unit suite exercises each function against spies. This tier exercises the whole US-007 journey
 * against a REAL store implementation over a device-shaped key/value substrate, across a **simulated
 * process restart**: the only thing that survives the restart is the serialized string in
 * {@link DeviceStorage}, exactly as on a device where the JS heap is gone and only IndexedDB /
 * AsyncStorage bytes remain. Every in-memory reference is therefore discarded, which is what makes
 * this able to catch a defect a spy-based unit test cannot — a session object that only "restores"
 * because the test handed the same object back.
 */

/** The bytes that survive a process restart — a stand-in for IndexedDB / AsyncStorage. */
type DeviceStorage = Map<string, string>;

/**
 * A real {@link CookingSessionStore} over a device-shaped string key/value substrate.
 *
 * Deliberately a class, and deliberately holding ONLY the shared backing map: a new instance models a
 * cold app start, and it can see nothing of the previous instance except the persisted strings.
 */
class InMemoryCookingSessionStore implements CookingSessionStore {
    private static readonly KEY_PREFIX = 'cooking_session_';

    public constructor(private readonly device: DeviceStorage) {}

    /**
     * Reads the serialized session for a recipe.
     *
     * @param recipeId - Recipe whose session to read.
     * @returns The serialized session, or `null` when the device holds none.
     * @sideEffect Reads from the backing device storage.
     */
    public read(recipeId: string): Promise<string | null> {
        return Promise.resolve(this.device.get(InMemoryCookingSessionStore.KEY_PREFIX + recipeId) ?? null);
    }

    /**
     * Writes the serialized session for a recipe.
     *
     * @param recipeId - Recipe whose session to write.
     * @param serialized - The serialized session payload.
     * @sideEffect Writes to the backing device storage.
     */
    public write(recipeId: string, serialized: string): Promise<void> {
        this.device.set(InMemoryCookingSessionStore.KEY_PREFIX + recipeId, serialized);

        return Promise.resolve();
    }

    /**
     * Removes any stored session for a recipe.
     *
     * @param recipeId - Recipe whose session to remove.
     * @sideEffect Deletes from the backing device storage.
     */
    public remove(recipeId: string): Promise<void> {
        this.device.delete(InMemoryCookingSessionStore.KEY_PREFIX + recipeId);

        return Promise.resolve();
    }
}

const RECIPE_ID = 'rec_01HZY000000000000000000000';
const OTHER_RECIPE_ID = 'rec_01HZY111111111111111111111';
const NOW = '2026-08-08T18:00:00.000Z';

/** An ISO timestamp `offsetMs` before {@link NOW}. */
function isoBefore(offsetMs: number): string {
    return new Date(Date.parse(NOW) - offsetMs).toISOString();
}

/** A mid-cook session: past the first steps, ingredients checked, halved yield, two timers running. */
function makeLiveSession(overrides: Partial<CookingSession> = {}): CookingSession {
    return {
        recipeId: RECIPE_ID,
        startedAt: isoBefore(45 * 60 * 1000),
        currentStepIndex: 5,
        completedSteps: [0, 1, 2, 3, 4],
        checkedIngredientIds: ['ing-flour', 'ing-butter', 'ing-egg'],
        scaleFactor: 0.5,
        activeTimers: [
            {
                id: 'timer-bake',
                label: 'Bake',
                stepNumber: 6,
                durationMs: 1_800_000,
                startedAt: isoBefore(10 * 60 * 1000),
                isPaused: false,
            },
            {
                id: 'timer-rest',
                label: 'Rest the dough',
                stepNumber: 4,
                durationMs: 600_000,
                startedAt: isoBefore(20 * 60 * 1000),
                isPaused: true,
                pausedRemainingMs: 90_000,
            },
        ],
        ...overrides,
    };
}

describe('session resume across a process restart', () => {
    it('restores step index, checked ingredients, scale factor and active timers intact', async () => {
        const device: DeviceStorage = new Map();
        const session = makeLiveSession({ pausedAt: isoBefore(30 * 60 * 1000) });

        // Cooking session #1: the user pauses and leaves.
        await persistSession(new InMemoryCookingSessionStore(device), session);

        // ---- process restart: every in-memory reference is gone, only the bytes remain ----
        expect([...device.values()].every((value) => typeof value === 'string')).toBe(true);

        const outcome = await restoreSession(new InMemoryCookingSessionStore(device), RECIPE_ID, NOW);

        expect(outcome.status).toBe('resumable');

        if (outcome.status !== 'resumable') {
            throw new Error('expected a resumable session');
        }

        const restored = outcome.session;
        expect(restored).toEqual(session);
        expect(restored).not.toBe(session);
        expect(restored.currentStepIndex).toBe(5);
        expect(restored.completedSteps).toEqual([0, 1, 2, 3, 4]);
        expect(restored.checkedIngredientIds).toEqual(['ing-flour', 'ing-butter', 'ing-egg']);
        expect(restored.scaleFactor).toBe(0.5);
        expect(restored.activeTimers).toHaveLength(2);
        expect(restored.activeTimers[1]?.pausedRemainingMs).toBe(90_000);

        // The collections must come back as real arrays: a `Set` would have crossed JSON as `{}` and
        // arrived as an empty (or rejected) collection, losing the cook's entire checkoff progress.
        expect(Array.isArray(restored.completedSteps)).toBe(true);
        expect(Array.isArray(restored.checkedIngredientIds)).toBe(true);
    });

    it('survives repeated pause/resume cycles without drift', async () => {
        const device: DeviceStorage = new Map();
        let session = makeLiveSession();

        for (const stepIndex of [6, 7, 8]) {
            session = {
                ...session,
                currentStepIndex: stepIndex,
                completedSteps: [...session.completedSteps, stepIndex - 1],
                pausedAt: isoBefore(5 * 60 * 1000),
            };
            await persistSession(new InMemoryCookingSessionStore(device), session);

            const outcome = await restoreSession(new InMemoryCookingSessionStore(device), RECIPE_ID, NOW);
            expect(outcome).toEqual({ status: 'resumable', session });
        }

        // One key per recipe — resuming must not accumulate an entry per pause.
        expect(device.size).toBe(1);
    });

    it('keeps each recipe’s session independent', async () => {
        const device: DeviceStorage = new Map();
        const store = new InMemoryCookingSessionStore(device);
        const first = makeLiveSession({ pausedAt: isoBefore(60_000) });
        const second = makeLiveSession({
            recipeId: OTHER_RECIPE_ID,
            currentStepIndex: 1,
            completedSteps: [0],
            checkedIngredientIds: [],
            scaleFactor: 3,
            activeTimers: [],
            pausedAt: isoBefore(60_000),
        });

        await persistSession(store, first);
        await persistSession(store, second);

        const restart = new InMemoryCookingSessionStore(device);
        await expect(restoreSession(restart, RECIPE_ID, NOW)).resolves.toEqual({ status: 'resumable', session: first });
        await expect(restoreSession(restart, OTHER_RECIPE_ID, NOW)).resolves.toEqual({
            status: 'resumable',
            session: second,
        });

        // Clearing one recipe's session must not disturb the other's.
        await clearSession(restart, RECIPE_ID);
        await expect(restoreSession(restart, RECIPE_ID, NOW)).resolves.toEqual({
            status: 'start-fresh',
            reason: 'absent',
        });
        await expect(restoreSession(restart, OTHER_RECIPE_ID, NOW)).resolves.toEqual({
            status: 'resumable',
            session: second,
        });
    });
});

describe('session resume beyond the 24h window', () => {
    it('discards a session older than 24h, offers start-fresh, and frees the device entry', async () => {
        const device: DeviceStorage = new Map();
        const stale = makeLiveSession({
            startedAt: isoBefore(SESSION_RESUME_WINDOW_MS + 60 * 60 * 1000),
            pausedAt: isoBefore(SESSION_RESUME_WINDOW_MS + 1),
        });

        await persistSession(new InMemoryCookingSessionStore(device), stale);
        expect(device.size).toBe(1);

        const outcome = await restoreSession(new InMemoryCookingSessionStore(device), RECIPE_ID, NOW);

        expect(outcome).toEqual({ status: 'start-fresh', reason: 'expired' });
        // Discarding is not a display decision: the stale bytes are evicted so the next cold start
        // does not re-evaluate them, and the device does not accumulate dead sessions.
        expect(device.size).toBe(0);

        const afterRestart = await restoreSession(new InMemoryCookingSessionStore(device), RECIPE_ID, NOW);
        expect(afterRestart).toEqual({ status: 'start-fresh', reason: 'absent' });
    });

    it('still resumes a session paused just inside the window after the same restart', async () => {
        const device: DeviceStorage = new Map();
        const session = makeLiveSession({
            startedAt: isoBefore(SESSION_RESUME_WINDOW_MS + 60 * 60 * 1000),
            pausedAt: isoBefore(SESSION_RESUME_WINDOW_MS - 1),
        });

        await persistSession(new InMemoryCookingSessionStore(device), session);

        await expect(restoreSession(new InMemoryCookingSessionStore(device), RECIPE_ID, NOW)).resolves.toEqual({
            status: 'resumable',
            session,
        });
        expect(device.size).toBe(1);
    });

    it('evicts a session whose stored payload was corrupted between runs', async () => {
        const device: DeviceStorage = new Map();
        await persistSession(new InMemoryCookingSessionStore(device), makeLiveSession({ pausedAt: isoBefore(60_000) }));

        // Simulate a half-written / externally mangled entry, which is what a killed write looks like.
        const [key] = [...device.keys()];
        device.set(key ?? '', (device.get(key ?? '') ?? '').slice(0, 40));

        const outcome = await restoreSession(new InMemoryCookingSessionStore(device), RECIPE_ID, NOW);

        expect(outcome).toEqual({ status: 'start-fresh', reason: 'unreadable' });
        expect(device.size).toBe(0);
    });
});
