/**
 * The web cook route's client adapter (`/[locale]/recipes/[id]/cook`, plan 0002 T3; decisions/0019, 0029).
 *
 * Over the REAL recipe-service hooks and a network-guarded fake client (`createFakeRecipeServiceClient`), with only the
 * router, the Clerk session and the profile read mocked, as RecipeDetailContainer's tests do. It pins:
 * - the failed-server-prefetch path every mocked Playwright run takes: the server HTML is the loading frame, never the
 *   route's error boundary, and after hydration the browser's own read draws the cooking screen (decisions/0019);
 * - the cook-link outcomes on that same client path: an owner's draft REPLACES to the editor and no recipe text is
 *   ever painted before it (po's condition, decisions/0029); another cook's draft and a 404 are S32; a failure is S29;
 * - no decision while the viewer is unknown.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { NotFoundError, recipeQueries } from '@kitchensink/recipe-service-client';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { renderWithRecipeClient } from '@commise/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookingRoute } from '@/app/[locale]/recipes/[id]/cook/CookingRoute';

import { makeRecipeDetail } from '../recipes/__fixtures__/recipeFixtures';

const { useAuthMock, useUserProfileMock, replaceMock, pushMock } = vi.hoisted(() => ({
    useAuthMock: vi.fn(),
    useUserProfileMock: vi.fn(),
    replaceMock: vi.fn(),
    pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
    useParams: () => ({ locale: 'en', id: 'rec_1' }),
    useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: useAuthMock }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: useUserProfileMock }));

/** The place line: the app writes a no-break space between its words, so a plain-space string never matches. */
const stepOf = (current: number, total: number): RegExp => new RegExp(`^Step\\s${current}\\sof\\s${total}$`, 'u');

const OWNER_ID = 'usr_1';
const STEP_TEXT = 'Heat 1.5 tbsp. oil.';
const STEPS = [
    { stepNumber: 1, instruction: `${STEP_TEXT} Add the onion.` },
    { stepNumber: 2, instruction: 'Roast for 40 min.' },
];
const settledProfile = { status: 'success', isLoading: false, data: { user: { id: 'usr_profile' } } };

/** Every text the container held while the test ran, so a flash of recipe text cannot hide between assertions. */
function recordTexts(): { readonly seen: string[]; readonly stop: () => void } {
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(document.body.textContent ?? ''));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return { seen, stop: () => observer.disconnect() };
}

beforeEach(() => {
    useAuthMock.mockReturnValue({ sessionClaims: { external_id: OWNER_ID } });
    useUserProfileMock.mockReturnValue(settledProfile);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('CookingRoute: a failed server prefetch falls through to the browser read (decisions/0019)', () => {
    function page(client: ReturnType<typeof createFakeRecipeServiceClient>, queryClient: QueryClient): ReactNode {
        return (
            <LocaleProvider locale="en">
                <QueryClientProvider client={queryClient}>
                    <RecipeServiceProvider client={client}>
                        <CookingRoute id="rec_1" />
                    </RecipeServiceProvider>
                </QueryClientProvider>
            </LocaleProvider>
        );
    }

    it('ships the cooking screen in the server HTML when the prefetch succeeded, without reading', () => {
        const client = createFakeRecipeServiceClient();
        const read = vi.spyOn(client, 'getRecipeById');
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        queryClient.setQueryData(
            recipeQueries(client).detail('rec_1').queryKey,
            makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, status: RecipeStatus.PUBLISHED, steps: STEPS }),
        );

        const html = renderToString(page(client, queryClient));

        expect(html).toMatch(/Step\s1\sof\s2/u);
        expect(html).not.toContain('Step –');
        expect(read).not.toHaveBeenCalled();
    });

    it('ships the loading frame, not the error, and reads nothing on the server', () => {
        const client = createFakeRecipeServiceClient();
        const read = vi.spyOn(client, 'getRecipeById');

        const html = renderToString(page(client, new QueryClient({ defaultOptions: { queries: { retry: false } } })));

        expect(html).toContain('Step –');
        expect(html).toContain('aria-busy="true"');
        expect(html).not.toContain('We couldn’t open this recipe');
        expect(read).not.toHaveBeenCalled();
    });

    it('draws the cooking screen from the browser read after hydration, with no recoverable error', async () => {
        const client = createFakeRecipeServiceClient();
        const read = vi
            .spyOn(client, 'getRecipeById')
            .mockResolvedValue(
                makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, status: RecipeStatus.PUBLISHED, steps: STEPS }),
            );
        const empty = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const container = document.createElement('div');
        container.innerHTML = renderToString(page(client, empty()));
        document.body.append(container);
        const onRecoverableError = vi.fn();

        let root: ReturnType<typeof hydrateRoot> | undefined;
        await act(async () => {
            root = hydrateRoot(container, page(client, empty()), { onRecoverableError });
        });

        await waitFor(() => expect(container.textContent).toMatch(/Step\s1\sof\s2/u));
        expect(container.textContent).toContain(STEP_TEXT);
        expect(read).toHaveBeenCalledTimes(1);
        expect(onRecoverableError).not.toHaveBeenCalled();
        await act(async () => root?.unmount());
        container.remove();
    });
});

describe('CookingRoute: where the link goes (R-2, decisions/0029)', () => {
    /** Mount the route on a recipe, returning the read so a test can wait for it. */
    function open(recipe: Parameters<typeof makeRecipeDetail>[0]) {
        const client = createFakeRecipeServiceClient();
        const read = vi
            .spyOn(client, 'getRecipeById')
            .mockResolvedValue(makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, ...recipe }));
        renderWithRecipeClient(<CookingRoute id="rec_1" />, client);

        return read;
    }

    it('cooks a published recipe', async () => {
        open({ status: RecipeStatus.PUBLISHED, steps: STEPS });

        expect(await screen.findByText(stepOf(1, 2))).toBeInTheDocument();
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it('replaces an owner’s draft link with the editor, painting no recipe text before it', async () => {
        const texts = recordTexts();
        open({ status: RecipeStatus.DRAFT, steps: STEPS, title: 'Secret draft' });

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/en/recipes/rec_1/edit'));
        texts.stop();

        expect(pushMock).not.toHaveBeenCalled();

        for (const text of [...texts.seen, document.body.textContent ?? '']) {
            expect(text).not.toContain(STEP_TEXT);
            expect(text).not.toContain('Secret draft');
        }
    });

    it('shows another cook’s draft as not available, and never why', async () => {
        useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });
        open({ status: RecipeStatus.DRAFT, steps: STEPS, visibility: RecipeVisibility.PUBLIC });

        expect(await screen.findByText('This recipe isn’t available any more')).toBeInTheDocument();
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it('shows a recipe with no steps as S30, with Edit recipe for its owner', async () => {
        open({ status: RecipeStatus.PUBLISHED, steps: [{ stepNumber: 1, instruction: ' ' }] });

        expect(await screen.findByText('This recipe has no steps yet')).toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('button', { name: 'Edit recipe' }));
        expect(replaceMock).toHaveBeenCalledWith('/en/recipes/rec_1/edit');
    });

    it('decides nothing while the viewer is unknown, and paints only the loading frame', async () => {
        useAuthMock.mockReturnValue({ sessionClaims: {} });
        useUserProfileMock.mockReturnValue({ status: 'pending', isLoading: true, data: undefined });
        const client = createFakeRecipeServiceClient();
        const read = vi.spyOn(client, 'getRecipeById');
        // The detail is SEEDED, so nothing suspends: the settled subtree is committed on the first render and the
        // viewer is the only thing left to wait for. An unseeded read would still be suspended when the asserts run.
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
        queryClient.setQueryData(
            recipeQueries(client).detail('rec_1').queryKey,
            makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, status: RecipeStatus.DRAFT, steps: STEPS }),
        );
        // A function, so the rerender passes a NEW element: React skips an identical one.
        const route = () => (
            <LocaleProvider locale="en">
                <QueryClientProvider client={queryClient}>
                    <RecipeServiceProvider client={client}>
                        <CookingRoute id="rec_1" />
                    </RecipeServiceProvider>
                </QueryClientProvider>
            </LocaleProvider>
        );
        const texts = recordTexts();
        const { rerender } = render(route());
        await act(async () => undefined);
        texts.stop();

        expect(read).not.toHaveBeenCalled();
        expect(replaceMock).not.toHaveBeenCalled();
        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        expect(screen.queryByText('This recipe isn’t available any more')).not.toBeInTheDocument();

        for (const text of texts.seen) {
            expect(text).not.toContain(STEP_TEXT);
        }

        // Positive control: once the viewer is known the same draft IS decided, so the asserts above are not vacuous.
        useAuthMock.mockReturnValue({ sessionClaims: { external_id: OWNER_ID } });
        useUserProfileMock.mockReturnValue(settledProfile);
        rerender(route());

        await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/en/recipes/rec_1/edit'));
    });

    it('shows a 404 as S32, with Go to Home', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError('Recipe not found'));
        renderWithRecipeClient(<CookingRoute id="rec_1" />, client);

        expect(await screen.findByText('This recipe isn’t available any more')).toBeInTheDocument();
        await userEvent.setup().click(screen.getByRole('button', { name: 'Go to Home' }));
        expect(replaceMock).toHaveBeenCalledWith('/en');
    });

    it('shows another failure as S29, whose Try again reads again', async () => {
        const client = createFakeRecipeServiceClient();
        const read = vi.spyOn(client, 'getRecipeById').mockRejectedValue(new Error('network down'));
        renderWithRecipeClient(<CookingRoute id="rec_1" />, client);

        expect(await screen.findByText('We couldn’t open this recipe')).toBeInTheDocument();
        read.mockResolvedValue(
            makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, status: RecipeStatus.PUBLISHED, steps: STEPS }),
        );
        await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

        expect(await screen.findByText(stepOf(1, 2))).toBeInTheDocument();
    });

    it('leaves to the recipe page by route, never by history', async () => {
        open({ status: RecipeStatus.PUBLISHED, steps: STEPS });

        await userEvent.setup().click(await screen.findByRole('button', { name: 'Exit cooking mode' }));

        expect(replaceMock).toHaveBeenCalledWith('/en/recipes/rec_1');
    });
});

/**
 * S20 and R-15 (qse item 11): a cook who is on a step stays on it. A focus or app-active refetch that returns a missing
 * recipe, a draft or blank steps changes nothing the cook sees, and a background fetch never draws the loading frame.
 * Only leaving and opening again, or another cook, reads the new answer.
 */
describe('CookingRoute: a cook on a step is not moved by a later read', () => {
    const FOUR = [
        { stepNumber: 1, instruction: 'Heat the oil.' },
        { stepNumber: 2, instruction: 'Add the onion.' },
        { stepNumber: 3, instruction: 'Roast for 40 min.' },
        { stepNumber: 4, instruction: 'Rest.' },
    ];
    const published = () =>
        makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, status: RecipeStatus.PUBLISHED, steps: FOUR });
    const nextStep = () => screen.getByRole('button', { name: /^(Next step|Start step|Finish)/u });

    /** Mount on a published recipe and walk to step 3, with the client and cache kept to refetch through. */
    async function cookingOnStepThree() {
        const user = userEvent.setup();
        const client = createFakeRecipeServiceClient();
        const read = vi.spyOn(client, 'getRecipeById').mockResolvedValue(published());
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const view = renderWithRecipeClient(<CookingRoute id="rec_1" />, client, { queryClient });
        await screen.findByText(stepOf(1, 4));
        await user.click(nextStep());
        await user.click(nextStep());
        expect(screen.getByText(stepOf(3, 4))).toBeInTheDocument();

        return { user, read, queryClient, rerender: view.rerender };
    }

    it.each([
        ['a 404', () => Promise.reject(new NotFoundError('Recipe not found'))],
        ['another failure', () => Promise.reject(new Error('network down'))],
        [
            'a draft',
            () =>
                Promise.resolve(
                    makeRecipeDetail({ id: 'rec_1', ownerId: OWNER_ID, status: RecipeStatus.DRAFT, steps: FOUR }),
                ),
        ],
        [
            'blank steps',
            () =>
                Promise.resolve(
                    makeRecipeDetail({
                        id: 'rec_1',
                        ownerId: OWNER_ID,
                        status: RecipeStatus.PUBLISHED,
                        steps: [{ stepNumber: 1, instruction: ' ' }],
                    }),
                ),
        ],
    ])(
        'stays on step 3 with no notice when a refetch returns %s, and Finish still reaches Done',
        async (_name, next) => {
            const { user, read, queryClient } = await cookingOnStepThree();
            read.mockImplementation(next);

            await act(async () => {
                await queryClient.refetchQueries();
            });

            expect(screen.getByText(stepOf(3, 4))).toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            expect(replaceMock).not.toHaveBeenCalled();

            await user.click(nextStep());
            await user.click(nextStep());
            expect(screen.getByRole('heading', { level: 1, name: 'All 4 steps done' })).toBeInTheDocument();
        },
    );

    it('never draws the loading frame while a background fetch is in flight', async () => {
        const { read, queryClient } = await cookingOnStepThree();
        let settle: (() => void) | undefined;
        read.mockImplementation(
            () =>
                new Promise((resolve) => {
                    settle = () => resolve(published());
                }),
        );

        const refetching = act(async () => {
            void queryClient.refetchQueries();
        });
        await refetching;

        expect(screen.getByRole('main').getAttribute('aria-busy')).not.toBe('true');
        expect(screen.getByText(stepOf(3, 4))).toBeInTheDocument();

        await act(async () => {
            settle?.();
        });
    });

    // Another cook is another session: the old cook's place is not carried over.
    it('ends the session when the cook changes', async () => {
        const { rerender } = await cookingOnStepThree();
        useAuthMock.mockReturnValue({ sessionClaims: { external_id: 'usr_other' } });

        rerender(<CookingRoute id="rec_1" />);

        expect(await screen.findByText(stepOf(1, 4))).toBeInTheDocument();
    });

    // B-1: with no claim the profile decides who is cooking, so a change of profile id is a change of cook too.
    it('ends the session when the profile id changes and there is no claim', async () => {
        useAuthMock.mockReturnValue({ sessionClaims: {} });
        useUserProfileMock.mockReturnValue({ status: 'success', isLoading: false, data: { user: { id: 'usr_1' } } });
        const { rerender } = await cookingOnStepThree();
        useUserProfileMock.mockReturnValue({ status: 'success', isLoading: false, data: { user: { id: 'usr_2' } } });

        rerender(<CookingRoute id="rec_1" />);

        expect(await screen.findByText(stepOf(1, 4))).toBeInTheDocument();
    });

    // B-1: a claim that arrives after the profile names the same cook, so a cook on a step stays on it.
    it('keeps the session when the claim arrives after the profile and names the same cook', async () => {
        useAuthMock.mockReturnValue({ sessionClaims: {} });
        useUserProfileMock.mockReturnValue({ status: 'success', isLoading: false, data: { user: { id: OWNER_ID } } });
        const { rerender } = await cookingOnStepThree();
        useAuthMock.mockReturnValue({ sessionClaims: { external_id: OWNER_ID } });

        rerender(<CookingRoute id="rec_1" />);

        expect(screen.getByText(stepOf(3, 4))).toBeInTheDocument();
    });

    it('opens again on a 404 as gone', async () => {
        const { read } = await cookingOnStepThree();
        cleanup();
        read.mockRejectedValue(new NotFoundError('Recipe not found'));
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockRejectedValue(new NotFoundError('Recipe not found'));
        renderWithRecipeClient(<CookingRoute id="rec_1" />, client);

        expect(await screen.findByText('This recipe isn’t available any more')).toBeInTheDocument();
    });

    it('opens again on blank steps as no steps', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getRecipeById').mockResolvedValue(
            makeRecipeDetail({
                id: 'rec_1',
                ownerId: OWNER_ID,
                status: RecipeStatus.PUBLISHED,
                steps: [{ stepNumber: 1, instruction: ' ' }],
            }),
        );
        renderWithRecipeClient(<CookingRoute id="rec_1" />, client);

        expect(await screen.findByText('This recipe has no steps yet')).toBeInTheDocument();
    });
});
