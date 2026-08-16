/**
 * Component tests for the mobile {@link CookingModeScreen} container (rendered through react-native-web
 * under jsdom — see `vitest.native.config.ts`).
 *
 * **Scope, deliberately narrow.** `@commise/features-cooking` already owns an exhaustive suite for the
 * cooking SURFACE itself (step navigation, timers, checkoff, scaling, resume, wake-lock balance). Repeating
 * it here would be duplicated knowledge that rots. What only THIS layer can get wrong — and what is
 * therefore what these tests are built to falsify — is the WIRING:
 *
 *  - the mapping from the `useRecipe` query's state to the feature's `CookingRecipeState` union, including
 *    the retry-in-flight case that a naive `isError → error` mapping gets wrong;
 *  - that the retry affordance drives the query's own `refetch`, so the error state is escapable;
 *  - that the REAL AsyncStorage adapter is the one injected, agreeing with itself on the key across a
 *    write and a later read (a session written under one key and read under another resumes nothing);
 *  - that exit and finish stay DISTINCT outcomes reported to distinct callbacks — the one mistake that
 *    would either resurrect a finished cook or discard a resumable session;
 *  - that mounting the screen actually acquires the platform wake lock (FR-035).
 *
 * The recipe query is mocked (the fetch layer is not under test here); `AsyncStorage` is an in-memory
 * double because the native KV module has no jsdom runtime, and `expo-keep-awake` is the recording stub the
 * native config aliases in. Everything BELOW the container is the real thing — the real feature screen, the
 * real session hook, the real `nativeCookingSessionStore` — which is the point: a container that composed
 * them wrongly must fail here.
 */
import { serializeSession, type CookingSession } from '@kitchensink/cooking-core';
import { useRecipe } from '@kitchensink/recipe-service-client/hooks';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookingModeScreen } from '../../src/screens/CookingModeScreen.js';
import { COOKING_SESSION_KEY_PREFIX } from '../../src/storage/cookingSessionStore.js';
import { makeRecipeDetail, makeIngredientView, makeStepView } from '../__fixtures__/recipes.js';
import { getKeepAwakeCalls, resetKeepAwakeCalls } from '../stubs/expoKeepAwake.js';

// An in-memory `AsyncStorage` double: the real native module has no runtime under jsdom, and what matters
// here is that the screen drives the app's OWN adapter over it — not the native KV store's own behaviour.
const { asyncStorageMock } = vi.hoisted(() => ({ asyncStorageMock: { store: new Map<string, string>() } }));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: async (key: string) => asyncStorageMock.store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
            asyncStorageMock.store.set(key, value);
        },
        removeItem: async (key: string) => {
            asyncStorageMock.store.delete(key);
        },
    },
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipe: vi.fn(),
}));

const useRecipeMock = vi.mocked(useRecipe);

const RECIPE_ID = '01JQ0000000000000000000001';
const ONION_ID = '01JQ00000000000000000000I1';

/** The three steps every ready-state case cooks; the second declares a one-minute timer. */
const steps = [
    makeStepView({ stepNumber: 1, instruction: 'Chop the onion' }),
    makeStepView({ stepNumber: 2, instruction: 'Sweat the onion', timerSeconds: 60 }),
    makeStepView({ stepNumber: 3, instruction: 'Serve' }),
];

const ingredients = [makeIngredientView({ ingredientId: ONION_ID, name: 'Onion', quantity: 2, unit: undefined })];

/**
 * A `useRecipe` double exposing only the fields the container reads.
 *
 * @param overrides - Query fields to state for this case.
 * @returns A `useRecipe` return value.
 */
function query(overrides: Record<string, unknown> = {}): ReturnType<typeof useRecipe> {
    // `Record<string, unknown>` rather than `Partial<UseQueryResult>`: TanStack's result type is a UNION of
    // per-status shapes whose discriminants are literal types, so `Partial<…>` rejects any spread that states
    // a discriminant. Same idiom as `RecipesScreen.native.test.tsx`.
    return {
        isLoading: false,
        isError: false,
        isFetching: false,
        data: undefined,
        refetch: vi.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useRecipe>;
}

/** The resolved query for the three-step recipe above. */
function readyQuery(): ReturnType<typeof useRecipe> {
    return query({ data: makeRecipeDetail({ id: RECIPE_ID, steps, ingredients }) });
}

/** The storage key the adapter is expected to use for this recipe. */
const sessionKey = `${COOKING_SESSION_KEY_PREFIX}${RECIPE_ID}`;

/**
 * Flushes the async restore chain (device read → session → persist) and every effect it schedules.
 *
 * @sideEffect Drains microtasks inside `act`.
 */
async function settle(): Promise<void> {
    await act(async () => {
        for (let turn = 0; turn < 10; turn += 1) {
            await Promise.resolve();
        }
    });
}

/**
 * A cooking session as device storage would hold it.
 *
 * @param overrides - Session fields to state for this case.
 * @returns A complete session.
 */
function makeSession(overrides: Partial<CookingSession> = {}): CookingSession {
    return {
        recipeId: RECIPE_ID,
        // Well inside the 24h resume window, so a restore case is testing the WIRING and not the boundary
        // (which `@kitchensink/cooking-core` pins from both sides).
        startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        currentStepIndex: 0,
        completedSteps: [],
        checkedIngredientIds: [],
        scaleFactor: 1,
        activeTimers: [],
        ...overrides,
    };
}

/**
 * Renders the container with stub navigation callbacks.
 *
 * @param overrides - Callbacks to observe.
 * @returns The two callbacks, so a case can assert which one fired.
 */
function renderScreen(overrides: { onExit?: () => void; onFinish?: () => void } = {}) {
    const onExit = overrides.onExit ?? vi.fn();
    const onFinish = overrides.onFinish ?? vi.fn();

    render(<CookingModeScreen recipeId={RECIPE_ID} onExit={onExit} onFinish={onFinish} />);

    return { onExit, onFinish };
}

afterEach(cleanup);

beforeEach(() => {
    useRecipeMock.mockReset();
    useRecipeMock.mockReturnValue(readyQuery());
    asyncStorageMock.store.clear();
    resetKeepAwakeCalls();
});

describe('CookingModeScreen (mobile) — query state maps to the cooking surface', () => {
    it('shows the loading surface while the recipe query is loading', async () => {
        useRecipeMock.mockReturnValue(query({ isLoading: true, isFetching: true }));

        renderScreen();
        await settle();

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
    });

    it('shows the loading surface while a RETRY is in flight, not the failure it is retrying', async () => {
        // TanStack keeps `status: 'error'` until a refetch resolves. A mapping that read `isError` alone
        // would leave the failed surface on screen after the cook tapped "Try again", so the control would
        // read as dead. Fails against `isError ? error : …`.
        useRecipeMock.mockReturnValue(query({ isError: true, isFetching: true }));

        renderScreen();
        await settle();

        expect(screen.getByRole('status', { name: 'Loading recipe' })).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('shows the error surface when the recipe query failed and nothing is in flight', async () => {
        useRecipeMock.mockReturnValue(query({ isError: true }));

        renderScreen();
        await settle();

        expect(screen.getByRole('alert').textContent).toContain("We couldn't load this recipe.");
    });

    it('treats a settled query with no recipe as an error rather than an endless spinner', async () => {
        // Structurally unreachable through the real client today, which is exactly why it must not be a
        // hang: a resolved-but-empty query would otherwise sit on the loading surface forever.
        useRecipeMock.mockReturnValue(query({ data: undefined }));

        renderScreen();
        await settle();

        expect(screen.getByRole('alert')).toBeTruthy();
    });

    it('refetches the recipe when the error surface retry is pressed', async () => {
        const refetch = vi.fn();
        useRecipeMock.mockReturnValue(query({ isError: true, refetch }));

        renderScreen();
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('renders the recipe`s FIRST step, its steps and its ingredients once the query resolves', async () => {
        renderScreen();
        await settle();

        expect(screen.getByLabelText('Cooking mode')).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Step 1 of 3' })).toBeTruthy();
        expect(screen.getByLabelText('Current step instruction').textContent).toContain('Chop the onion');

        // The ingredient panel proves the OTHER half of the recipe reached the surface: a container that
        // passed steps but dropped `ingredients` would still satisfy every assertion above.
        fireEvent.click(screen.getByRole('button', { name: 'Ingredients' }));

        expect(screen.getByText('Onion')).toBeTruthy();
    });

    it('shows the empty surface for a recipe with no steps, instead of hiding the entry point', async () => {
        useRecipeMock.mockReturnValue(query({ data: makeRecipeDetail({ id: RECIPE_ID, steps: [], ingredients }) }));

        renderScreen();
        await settle();

        expect(screen.getByRole('heading', { name: 'This recipe has no steps yet' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Exit cooking mode' })).toBeTruthy();
    });
});

describe('CookingModeScreen (mobile) — exit and finish are distinct outcomes', () => {
    it('reports EXIT and leaves a resumable session on the device', async () => {
        const { onExit, onFinish } = renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Exit cooking mode' }));
        await settle();

        expect(onExit).toHaveBeenCalledTimes(1);
        expect(onFinish).not.toHaveBeenCalled();
        // The session must SURVIVE an exit — that is the whole difference from finishing.
        expect(asyncStorageMock.store.has(sessionKey)).toBe(true);
    });

    it('reports FINISH and clears the stored session', async () => {
        const { onExit, onFinish } = renderScreen();
        await settle();

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Finish cooking' }));
        await settle();

        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(onExit).not.toHaveBeenCalled();
        // Collapsing finish onto the exit command would leave the session here and resurrect a finished cook.
        expect(asyncStorageMock.store.has(sessionKey)).toBe(false);
    });
});

describe('CookingModeScreen (mobile) — device wiring', () => {
    it('persists the session under the namespaced AsyncStorage key', async () => {
        renderScreen();
        await settle();

        expect([...asyncStorageMock.store.keys()]).toEqual([sessionKey]);
    });

    it('RESUMES a stored session at the step it was left on', async () => {
        // The falsifiable half of the key contract: a write-only assertion passes even if `read` and `write`
        // disagreed on the key. Seeding storage directly and resuming proves both sides agree, and proves the
        // container injected the real adapter rather than a store that only looks like one.
        asyncStorageMock.store.set(sessionKey, serializeSession(makeSession({ currentStepIndex: 2 })));

        renderScreen();
        await settle();

        expect(screen.getByRole('heading', { name: 'Step 3 of 3' })).toBeTruthy();
        expect(screen.getByLabelText('Current step instruction').textContent).toContain('Serve');
    });

    it('acquires the platform wake lock for the session (FR-035)', async () => {
        renderScreen();
        await settle();

        expect(getKeepAwakeCalls().filter((call) => call.kind === 'activate')).toHaveLength(1);
    });

    it('does not hold the wake lock for a recipe that never loaded', async () => {
        useRecipeMock.mockReturnValue(query({ isError: true }));

        renderScreen();
        await settle();

        expect(getKeepAwakeCalls()).toHaveLength(0);
    });
});
