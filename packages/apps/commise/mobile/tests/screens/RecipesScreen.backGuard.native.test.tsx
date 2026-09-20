/**
 * ⛔ THE DATA-LOSS REGRESSION GUARD FOR THE ANDROID SYSTEM BACK BUTTON.
 *
 * `RecipesScreen`'s hardware-back handler used to call `nav.back()` UNCONDITIONALLY whenever the stack had
 * anything to pop. The recipe wizard's own header back arrow routes through `Wizard`'s discard guard and asks
 * before losing unsaved work; the system back button bypassed it entirely and popped the surface. Reproduced
 * on a device: wizard on step 4 with eight ingredient lines against the seed's five,
 * `adb shell input keyevent KEYCODE_BACK`, straight to the detail screen, three lines gone, no dialog. It
 * affects CREATE as well as EDIT — a whole recipe typed from scratch went the same way.
 *
 * These tests drive the REAL navigator, so they prove the thing the defect was about: that the two entry
 * points (the header arrow and the system button) reach the SAME guard and the SAME dialog. The `Wizard`'s own
 * interceptor contract — including `mode="edit"` — is covered one layer down in
 * `@commise/features-recipes`'s `Wizard.native.test.tsx`; this file is the navigator integration.
 *
 * ## Why `BackHandler` is faked rather than mocked away
 *
 * `react-native` is aliased to `react-native-web` here (see `vitest.native.config.ts`), whose `BackHandler` is
 * an inert stub that logs and returns a no-op subscription — so nothing registered through it can ever be
 * invoked. `installHardwareBackHandler` (`@commise/ui/testing/hardware-back`) replaces it with a faithful stand-in for the RN semantics that
 * actually matter: subscriptions are invoked LAST-REGISTERED-FIRST, and the first one to return `true`
 * consumes the event. Modelling that ordering is the point — an interceptor registered by a pushed surface
 * must beat the navigator's own pop, and asserting the order is what stops a fix that merely happens to work
 * because only one handler exists today.
 *
 * ⚠️ WHAT THIS FILE CANNOT PROVE. On a device, an open RN `Modal` takes the back event itself
 * (`onRequestClose`) before any `BackHandler` subscription is reached, so back-while-the-dialog-is-open
 * dismisses the dialog. `react-native-web`'s `Modal` does not do that, so that layering is a Maestro concern
 * (`.maestro/recipes/systemBackGuard.yaml`). What IS asserted here is the property that must hold either way:
 * a second back press while the dialog is open never discards and never leaves the wizard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { installHardwareBackHandler, type HardwareBackHandle } from '@commise/ui/testing/hardware-back';

import { collectionQueries, recipeQueries, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import {
    useCloneRecipe,
    useCreateIngredient,
    useCreateRecipe,
    useDeleteRecipe,
    useDeleteRecipeRating,
    useInfiniteSearchRecipes,
    useSearchIngredients,
    useSetRecipeRating,
    useSetRecipeVisibility,
} from '@kitchensink/recipe-service-client/hooks';

import { useUserProfile } from '../../src/hooks/useUserProfile.js';
import { RecipesScreen } from '../../src/screens/RecipesScreen.js';
import {
    makeCollectionPage,
    makeRecipe,
    makeRecipeDetail,
    makeRecipePage,
    makeSearchResponse,
} from '../__fixtures__/recipes.js';

const { serviceClient } = vi.hoisted(() => ({
    serviceClient: {
        emitAnalyticsEvents: async () => undefined,
        listRecipes: () => new Promise(() => undefined),
        getRecipeById: () => new Promise(() => undefined),
        listCollections: () => new Promise(() => undefined),
    },
}));

vi.mock('@kitchensink/recipe-service-client/hooks', () => ({
    useRecipeServiceClient: () => serviceClient,
    useRecipePhotos: () => ({ data: [], isLoading: false, isError: false }),
    useCreatePhotoUploadUrl: () => ({ mutateAsync: async () => ({}), isPending: false, reset: () => undefined }),
    useConfirmPhotoUpload: () => ({ mutateAsync: async () => ({}), isPending: false, reset: () => undefined }),
    useDeleteRecipePhoto: () => ({ mutate: () => undefined, isPending: false, reset: () => undefined }),
    useReorderRecipePhotos: () => ({ mutate: () => undefined, isPending: false, reset: () => undefined }),
    useCreateParseJob: () => ({ mutate: () => undefined, isPending: false, isError: false, reset: () => undefined }),
    useParseJob: () => ({ data: undefined, error: undefined, fetchStatus: 'idle', isLoading: false }),
    useRetryParseJob: () => ({ mutate: () => undefined, isPending: false, error: undefined }),
    useEditParseJobLine: () => ({ mutate: () => undefined, isPending: false, error: undefined, variables: undefined }),
    useDeleteRecipe: vi.fn(),
    useSetRecipeVisibility: vi.fn(),
    useCloneRecipe: vi.fn(),
    useCreateRecipe: vi.fn(),
    useSetRecipeRating: vi.fn(),
    useDeleteRecipeRating: vi.fn(),
    useSearchIngredients: vi.fn(),
    useCreateIngredient: vi.fn(),
    useInfiniteSearchRecipes: vi.fn(),
}));

vi.mock('../../src/hooks/useUserProfile.js', () => ({ useUserProfile: vi.fn() }));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }: { readonly children?: unknown }) => children,
}));

vi.mock('@commise/features-recipes/hooks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@commise/features-recipes/hooks')>()),
    useRecipeNutritionBatches: () => () => null,
}));

let queryClient: QueryClient;
const client = serviceClient as unknown as RecipeServiceClient;

function renderScreen(ui: ReactElement) {
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function query<T>(overrides: Record<string, unknown> = {}): T {
    return { isLoading: false, isError: false, data: undefined, refetch: vi.fn(), ...overrides } as unknown as T;
}

function mutation<T>(overrides: Record<string, unknown> = {}): T {
    return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides } as unknown as T;
}

/** Walk the list's create dial into the create wizard's step 1. */
function openCreateWizard(): void {
    fireEvent.click(screen.getByRole('button', { name: 'New recipe' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create from Scratch' }));
}

/** Installed per test; the helper replaces `BackHandler.addEventListener`, so restoring it is explicit. */
let back: HardwareBackHandle;

afterEach(() => {
    cleanup();
    back.restore();
    vi.restoreAllMocks();
});

beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    queryClient.setQueryData(
        recipeQueries(client).list().queryKey,
        makeRecipePage([makeRecipe({ id: 'rec_2', title: 'Fish Tacos' })]),
    );
    queryClient.setQueryData(
        recipeQueries(client).detail('rec_2').queryKey,
        makeRecipeDetail({ id: 'rec_2', title: 'Fish Tacos', description: 'Bright and zesty.' }),
    );
    queryClient.setQueryData(collectionQueries(client).listInfinite().queryKey, {
        pages: [makeCollectionPage([])],
        pageParams: [1],
    });
    vi.mocked(useDeleteRecipe).mockReturnValue(mutation<ReturnType<typeof useDeleteRecipe>>());
    vi.mocked(useSetRecipeVisibility).mockReturnValue(mutation<ReturnType<typeof useSetRecipeVisibility>>());
    vi.mocked(useCloneRecipe).mockReturnValue(mutation<ReturnType<typeof useCloneRecipe>>());
    vi.mocked(useCreateRecipe).mockReturnValue(mutation<ReturnType<typeof useCreateRecipe>>());
    vi.mocked(useSetRecipeRating).mockReturnValue(mutation<ReturnType<typeof useSetRecipeRating>>());
    vi.mocked(useDeleteRecipeRating).mockReturnValue(mutation<ReturnType<typeof useDeleteRecipeRating>>());
    vi.mocked(useSearchIngredients).mockReturnValue(query<ReturnType<typeof useSearchIngredients>>({ data: [] }));
    vi.mocked(useCreateIngredient).mockReturnValue(mutation<ReturnType<typeof useCreateIngredient>>());
    vi.mocked(useInfiniteSearchRecipes).mockReturnValue(
        query<ReturnType<typeof useInfiniteSearchRecipes>>({
            data: { pages: [makeSearchResponse([])] },
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
        }),
    );
    vi.mocked(useUserProfile).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useUserProfile>);
});

describe('RecipesScreen — the system back button and the create wizard', () => {
    it('⛔ asks before discarding: a dirty create draft survives a system back press', () => {
        back = installHardwareBackHandler();
        renderScreen(<RecipesScreen />);
        openCreateWizard();

        // The draft goes dirty AFTER the interceptor is registered. That ordering is the whole test: an
        // interceptor that captured `isDirty` by value at registration reports clean here and discards.
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Midnight Ragu' } });

        expect(back.press()).toBe(true);

        expect(screen.getByLabelText('Discard unsaved changes?')).toBeTruthy();
        // Still in the wizard — nothing was popped behind the dialog.
        expect(screen.getByLabelText('Title')).toBeTruthy();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Midnight Ragu');
    });

    it('discards and leaves the wizard only once the cook confirms', () => {
        back = installHardwareBackHandler();
        renderScreen(<RecipesScreen />);
        openCreateWizard();
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Midnight Ragu' } });

        back.press();
        fireEvent.click(screen.getByLabelText('Discard changes'));

        expect(screen.queryByLabelText('Title')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
    });

    it('"Keep editing" dismisses the dialog and leaves the draft exactly where it was', () => {
        back = installHardwareBackHandler();
        renderScreen(<RecipesScreen />);
        openCreateWizard();
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Midnight Ragu' } });

        back.press();
        fireEvent.click(screen.getByLabelText('Keep editing'));

        expect(screen.queryByLabelText('Discard unsaved changes?')).toBeNull();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Midnight Ragu');
    });

    it('a CLEAN create wizard pops straight back to the list, with no dialog to dismiss', () => {
        back = installHardwareBackHandler();
        renderScreen(<RecipesScreen />);
        openCreateWizard();

        expect(back.press()).toBe(true);

        expect(screen.queryByLabelText('Discard unsaved changes?')).toBeNull();
        expect(screen.queryByLabelText('Title')).toBeNull();
        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
    });

    it('a second back press while the dialog is open never discards and never leaves the wizard', () => {
        back = installHardwareBackHandler();
        renderScreen(<RecipesScreen />);
        openCreateWizard();
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Midnight Ragu' } });

        back.press();
        back.press();

        expect(screen.getAllByLabelText('Discard unsaved changes?')).toHaveLength(1);
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Midnight Ragu');
    });
});

describe('RecipesScreen — the system back button everywhere else (unchanged behaviour)', () => {
    it('pops a pushed surface that has nothing to lose', () => {
        back = installHardwareBackHandler();
        renderScreen(<RecipesScreen />);

        fireEvent.click(screen.getByRole('button', { name: 'Fish Tacos' }));
        expect(screen.getByText('Bright and zesty.')).toBeTruthy();

        expect(back.press()).toBe(true);

        expect(screen.getByRole('heading', { name: 'Recipes' })).toBeTruthy();
    });

    it('declines the event at the root so the OS default (leave the app) still applies', () => {
        back = installHardwareBackHandler();
        renderScreen(<RecipesScreen />);

        expect(back.press()).toBe(false);
    });
});
