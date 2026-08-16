import { describe, expect, it, vi } from 'vitest';

import type { CookingSession, CookingTimer } from '../types.js';
import {
    PERSISTED_SESSION_SCHEMA_VERSION,
    SESSION_RESUME_WINDOW_MS,
    clearSession,
    deserializeSession,
    isCorruptSessionError,
    isInvalidTimestampError,
    persistSession,
    restoreSession,
    serializeSession,
    type CookingSessionStore,
} from '../sessionPersistence.js';

/**
 * T-013 unit suite — session persistence and the 24h resume window (FR-033 / REQ-013).
 *
 * The assertions here are written to fail if the logic is subtly wrong rather than merely to execute
 * it. Three properties are load-bearing and are each asserted directly:
 *
 *  1. **Arrays stay arrays.** `JSON.stringify(new Set([1,2]))` is `{}`; a regression to a `Set` would
 *     silently erase every completed step and every checked ingredient on resume. The deserializer is
 *     asserted to REJECT the `{}` shape, so the defect can never reach a cook mid-recipe.
 *  2. **The 24h boundary is exact.** Tested at `window - 1ms`, exactly `window`, and `window + 1ms` —
 *     an off-by-one or a flipped comparison fails at least one of the three.
 *  3. **Expiry anchors on the pause time when there is one.** A session started 30h ago but paused 1h
 *     ago is resumable; anchoring on `startedAt` alone would throw that cook's progress away.
 */

const RECIPE_ID = 'rec_01HZY000000000000000000000';
const NOW = '2026-08-08T18:00:00.000Z';

/** Builds a timer fixture; overrides win. */
function makeTimer(overrides: Partial<CookingTimer> = {}): CookingTimer {
    return {
        id: 'timer-1',
        label: 'Marinate chicken',
        stepNumber: 3,
        durationMs: 180_000,
        startedAt: '2026-08-08T17:55:00.000Z',
        isPaused: false,
        ...overrides,
    };
}

/** Builds a session fixture that already carries non-default state; overrides win. */
function makeSession(overrides: Partial<CookingSession> = {}): CookingSession {
    return {
        recipeId: RECIPE_ID,
        startedAt: '2026-08-08T17:30:00.000Z',
        currentStepIndex: 4,
        completedSteps: [0, 1, 2, 3],
        checkedIngredientIds: ['ing-a', 'ing-b'],
        scaleFactor: 2,
        activeTimers: [makeTimer()],
        ...overrides,
    };
}

/** An ISO timestamp `offsetMs` before {@link NOW}. */
function isoBefore(offsetMs: number): string {
    return new Date(Date.parse(NOW) - offsetMs).toISOString();
}

/** A spying in-memory {@link CookingSessionStore} plus the backing map, for call-level assertions. */
function makeStore(seed: ReadonlyMap<string, string> = new Map()) {
    const device = new Map<string, string>(seed);

    return {
        device,
        read: vi.fn((recipeId: string): Promise<string | null> => Promise.resolve(device.get(recipeId) ?? null)),
        write: vi.fn((recipeId: string, serialized: string): Promise<void> => {
            device.set(recipeId, serialized);

            return Promise.resolve();
        }),
        remove: vi.fn((recipeId: string): Promise<void> => {
            device.delete(recipeId);

            return Promise.resolve();
        }),
    } satisfies CookingSessionStore & { device: Map<string, string> };
}

/**
 * Serializes `session`, then corrupts the persisted session object through `mutate`.
 *
 * The envelope shape is deliberately visible to this test: the `version` tag is part of the persisted
 * contract, and a silent change to it must break a test rather than a user's device.
 */
function corrupt(session: CookingSession, mutate: (persisted: Record<string, unknown>) => void): string {
    const envelope = JSON.parse(serializeSession(session)) as { version: number; session: Record<string, unknown> };
    mutate(envelope.session);

    return JSON.stringify(envelope);
}

describe('serializeSession / deserializeSession — round trip', () => {
    it('restores a session carrying checked ingredients and a non-default scale factor deep-equal', () => {
        const session = makeSession({
            checkedIngredientIds: ['ing-a', 'ing-b', 'ing-c'],
            scaleFactor: 0.5,
            pausedAt: '2026-08-08T17:59:00.000Z',
            activeTimers: [makeTimer(), makeTimer({ id: 'timer-2', isPaused: true, pausedRemainingMs: 42_000 })],
        });

        expect(deserializeSession(serializeSession(session))).toEqual(session);
    });

    it('keeps the collections as JSON arrays on the wire (the Set-serialization guard)', () => {
        const raw = serializeSession(makeSession());
        const envelope = JSON.parse(raw) as { version: number; session: Record<string, unknown> };

        // A `Set` would have serialized to `{}` here, losing every entry with no error anywhere.
        expect(Array.isArray(envelope.session['completedSteps'])).toBe(true);
        expect(Array.isArray(envelope.session['checkedIngredientIds'])).toBe(true);
        expect(envelope.session['completedSteps']).toEqual([0, 1, 2, 3]);
        expect(envelope.version).toBe(PERSISTED_SESSION_SCHEMA_VERSION);
    });

    it('omits an absent pausedAt rather than persisting an undefined key', () => {
        const envelope = JSON.parse(serializeSession(makeSession())) as { session: Record<string, unknown> };

        expect('pausedAt' in envelope.session).toBe(false);
    });

    it('drops unknown keys instead of carrying them into the restored session', () => {
        const raw = corrupt(makeSession(), (persisted) => {
            persisted['injectedByAnOlderBuild'] = 'nope';
        });

        expect(deserializeSession(raw)).toEqual(makeSession());
    });

    it('rejects a session whose collections arrived as `{}` (a Set that went through JSON)', () => {
        const raw = corrupt(makeSession(), (persisted) => {
            persisted['completedSteps'] = {};
        });

        let thrown: unknown;

        try {
            deserializeSession(raw);
        } catch (error: unknown) {
            thrown = error;
        }

        expect(isCorruptSessionError(thrown)).toBe(true);
        expect(thrown).toBeInstanceOf(Error);
    });

    it.each([
        { label: 'not json at all', raw: 'definitely-not-json' },
        { label: 'a truncated payload', raw: '{"version":1,"session":{' },
        { label: 'an empty string', raw: '' },
        { label: 'a JSON array', raw: '[]' },
        { label: 'a bare null', raw: 'null' },
        { label: 'an envelope with no session', raw: '{"version":1}' },
    ])('rejects $label with CorruptSessionError', ({ raw }: { label: string; raw: string }) => {
        let thrown: unknown;

        try {
            deserializeSession(raw);
        } catch (error: unknown) {
            thrown = error;
        }

        expect(isCorruptSessionError(thrown)).toBe(true);
    });

    it.each([
        {
            label: 'a missing required field',
            mutate: (p: Record<string, unknown>): void => {
                delete p['checkedIngredientIds'];
            },
        },
        {
            label: 'a scale factor outside the allowed set',
            mutate: (p: Record<string, unknown>): void => {
                p['scaleFactor'] = 1.5;
            },
        },
        {
            label: 'a negative step index',
            mutate: (p: Record<string, unknown>): void => {
                p['currentStepIndex'] = -1;
            },
        },
        {
            label: 'a fractional step index',
            mutate: (p: Record<string, unknown>): void => {
                p['currentStepIndex'] = 1.5;
            },
        },
        {
            label: 'a non-ISO startedAt',
            mutate: (p: Record<string, unknown>): void => {
                p['startedAt'] = '08/08/2026';
            },
        },
        {
            label: 'an epoch-millis startedAt',
            mutate: (p: Record<string, unknown>): void => {
                p['startedAt'] = 1_754_676_000_000;
            },
        },
        {
            label: 'a non-array timer list',
            mutate: (p: Record<string, unknown>): void => {
                p['activeTimers'] = {};
            },
        },
        {
            label: 'a timer missing its duration',
            mutate: (p: Record<string, unknown>): void => {
                p['activeTimers'] = [{ id: 't', label: 'l', stepNumber: 1, startedAt: NOW, isPaused: false }];
            },
        },
        {
            label: 'a non-string ingredient id',
            mutate: (p: Record<string, unknown>): void => {
                p['checkedIngredientIds'] = [7];
            },
        },
        {
            label: 'an empty recipe id',
            mutate: (p: Record<string, unknown>): void => {
                p['recipeId'] = '';
            },
        },
    ])(
        'rejects $label with CorruptSessionError',
        ({ mutate }: { label: string; mutate: (p: Record<string, unknown>) => void }) => {
            let thrown: unknown;

            try {
                deserializeSession(corrupt(makeSession(), mutate));
            } catch (error: unknown) {
                thrown = error;
            }

            expect(isCorruptSessionError(thrown)).toBe(true);
        },
    );

    it('rejects a payload written by a future schema version', () => {
        const envelope = JSON.parse(serializeSession(makeSession())) as Record<string, unknown>;
        envelope['version'] = PERSISTED_SESSION_SCHEMA_VERSION + 1;

        let thrown: unknown;

        try {
            deserializeSession(JSON.stringify(envelope));
        } catch (error: unknown) {
            thrown = error;
        }

        expect(isCorruptSessionError(thrown)).toBe(true);
    });

    it('refuses to persist a session that could not be read back (symmetric validation)', () => {
        const unreadable = { ...makeSession(), completedSteps: new Set([1, 2]) } as unknown as CookingSession;

        let thrown: unknown;

        try {
            serializeSession(unreadable);
        } catch (error: unknown) {
            thrown = error;
        }

        expect(isCorruptSessionError(thrown)).toBe(true);
    });
});

describe('persistSession', () => {
    it('writes the serialized session under its own recipe id', async () => {
        const store = makeStore();
        const session = makeSession();

        await persistSession(store, session);

        expect(store.write).toHaveBeenCalledTimes(1);
        expect(store.write).toHaveBeenCalledWith(RECIPE_ID, serializeSession(session));
        expect(deserializeSession(store.device.get(RECIPE_ID) ?? '')).toEqual(session);
    });

    it('propagates a storage failure instead of reporting a false success', async () => {
        const store = makeStore();
        store.write.mockRejectedValueOnce(new Error('quota exceeded'));

        await expect(persistSession(store, makeSession())).rejects.toThrow('quota exceeded');
    });
});

describe('restoreSession — the 24h resume window', () => {
    it('resumes a session paused 1ms inside the window', async () => {
        const session = makeSession({ pausedAt: isoBefore(SESSION_RESUME_WINDOW_MS - 1) });
        const store = makeStore(new Map([[RECIPE_ID, serializeSession(session)]]));

        const outcome = await restoreSession(store, RECIPE_ID, NOW);

        expect(outcome).toEqual({ status: 'resumable', session });
        expect(store.remove).not.toHaveBeenCalled();
    });

    it('resumes a session paused exactly at the window edge (older THAN 24h is the discard rule)', async () => {
        const session = makeSession({ pausedAt: isoBefore(SESSION_RESUME_WINDOW_MS) });
        const store = makeStore(new Map([[RECIPE_ID, serializeSession(session)]]));

        const outcome = await restoreSession(store, RECIPE_ID, NOW);

        expect(outcome).toEqual({ status: 'resumable', session });
    });

    it('discards a session paused 1ms outside the window and clears it from the device', async () => {
        const session = makeSession({ pausedAt: isoBefore(SESSION_RESUME_WINDOW_MS + 1) });
        const store = makeStore(new Map([[RECIPE_ID, serializeSession(session)]]));

        const outcome = await restoreSession(store, RECIPE_ID, NOW);

        expect(outcome).toEqual({ status: 'start-fresh', reason: 'expired' });
        expect(store.remove).toHaveBeenCalledWith(RECIPE_ID);
        expect(store.device.has(RECIPE_ID)).toBe(false);
    });

    it('measures age from pausedAt when present, not from startedAt', async () => {
        // Started 30h ago (well outside the window) but paused 1h ago — this cook is still resumable.
        const session = makeSession({
            startedAt: isoBefore(30 * 60 * 60 * 1000),
            pausedAt: isoBefore(60 * 60 * 1000),
        });
        const store = makeStore(new Map([[RECIPE_ID, serializeSession(session)]]));

        await expect(restoreSession(store, RECIPE_ID, NOW)).resolves.toEqual({ status: 'resumable', session });
    });

    it('falls back to startedAt when the session was never paused', async () => {
        const fresh = makeSession({ startedAt: isoBefore(60 * 60 * 1000) });
        const stale = makeSession({ startedAt: isoBefore(SESSION_RESUME_WINDOW_MS + 1) });

        const freshStore = makeStore(new Map([[RECIPE_ID, serializeSession(fresh)]]));
        const staleStore = makeStore(new Map([[RECIPE_ID, serializeSession(stale)]]));

        await expect(restoreSession(freshStore, RECIPE_ID, NOW)).resolves.toEqual({
            status: 'resumable',
            session: fresh,
        });
        await expect(restoreSession(staleStore, RECIPE_ID, NOW)).resolves.toEqual({
            status: 'start-fresh',
            reason: 'expired',
        });
    });

    it('resumes a session whose timestamp is slightly in the future (clock skew never expires early)', async () => {
        const session = makeSession({ pausedAt: isoBefore(-60_000) });
        const store = makeStore(new Map([[RECIPE_ID, serializeSession(session)]]));

        await expect(restoreSession(store, RECIPE_ID, NOW)).resolves.toEqual({ status: 'resumable', session });
    });
});

describe('restoreSession — nothing to resume', () => {
    it('reports `absent` and touches nothing when the device holds no session', async () => {
        const store = makeStore();

        const outcome = await restoreSession(store, RECIPE_ID, NOW);

        expect(outcome).toEqual({ status: 'start-fresh', reason: 'absent' });
        expect(store.remove).not.toHaveBeenCalled();
    });

    it('self-heals an unreadable entry: reports `unreadable` and evicts it', async () => {
        const store = makeStore(new Map([[RECIPE_ID, '{"version":1,"session":"garbage"}']]));

        const outcome = await restoreSession(store, RECIPE_ID, NOW);

        expect(outcome).toEqual({ status: 'start-fresh', reason: 'unreadable' });
        expect(store.remove).toHaveBeenCalledWith(RECIPE_ID);
        expect(store.device.has(RECIPE_ID)).toBe(false);
    });

    it('refuses a payload stored under one recipe id that describes another', async () => {
        const foreign = makeSession({ recipeId: 'rec_01HZY999999999999999999999' });
        const store = makeStore(new Map([[RECIPE_ID, serializeSession(foreign)]]));

        const outcome = await restoreSession(store, RECIPE_ID, NOW);

        expect(outcome).toEqual({ status: 'start-fresh', reason: 'unreadable' });
        expect(store.remove).toHaveBeenCalledWith(RECIPE_ID);
    });

    it('propagates a storage read failure rather than pretending no session exists', async () => {
        const store = makeStore();
        store.read.mockRejectedValueOnce(new Error('storage unavailable'));

        await expect(restoreSession(store, RECIPE_ID, NOW)).rejects.toThrow('storage unavailable');
        expect(store.remove).not.toHaveBeenCalled();
    });

    it('rejects an unparseable `nowIso` instead of silently treating the session as fresh', async () => {
        const session = makeSession({ pausedAt: isoBefore(SESSION_RESUME_WINDOW_MS + 1) });
        const store = makeStore(new Map([[RECIPE_ID, serializeSession(session)]]));

        let thrown: unknown;

        try {
            await restoreSession(store, RECIPE_ID, 'yesterday');
        } catch (error: unknown) {
            thrown = error;
        }

        expect(isInvalidTimestampError(thrown)).toBe(true);
        expect(store.device.has(RECIPE_ID)).toBe(true);
    });
});

describe('clearSession', () => {
    it('removes the stored session for the start-fresh path', async () => {
        const store = makeStore(new Map([[RECIPE_ID, serializeSession(makeSession())]]));

        await clearSession(store, RECIPE_ID);

        expect(store.remove).toHaveBeenCalledWith(RECIPE_ID);
        expect(store.device.has(RECIPE_ID)).toBe(false);
        await expect(restoreSession(store, RECIPE_ID, NOW)).resolves.toEqual({
            status: 'start-fresh',
            reason: 'absent',
        });
    });

    it('is idempotent when there is nothing to clear', async () => {
        const store = makeStore();

        await expect(clearSession(store, RECIPE_ID)).resolves.toBeUndefined();
    });
});
