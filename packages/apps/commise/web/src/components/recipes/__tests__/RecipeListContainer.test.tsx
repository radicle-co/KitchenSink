// @vitest-environment jsdom
/**
 * The web My recipes container (`docs/design/uiOverhaul/buildSpec.md` §4.3) over a real client whose `listRecipes`
 * pages like the endpoint: it reads the WHOLE library (the A11 fix — a facet held only by recipes past the first page is
 * offered and counted), narrows it, forwards the sort to the server, reads and saves the list/grid choice as an ACCOUNT
 * setting (ADR-0059; no cookie), hides the search on the first run, and routes the Collections segment.
 */
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRecipeClient } from '@commise/test-utils';
import type { Recipe } from '@kitchensink/recipe-core';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { ProfileServiceClient } from '@commise/features-account';
import { SETTINGS_DEFAULTS, type UserSettings } from '@kitchensink/schema-identity';

const { pushMock, identity } = vi.hoisted(() => ({
    pushMock: vi.fn(),
    identity: { client: undefined as unknown },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isSignedIn: true }) }));
// The identity client the settings hook builds; each test owns the instance and spies its two settings methods.
vi.mock('@/hooks/useProfileServiceClient', () => ({ useProfileServiceClient: () => identity.client }));

import { RecipeListContainer } from '../RecipeListContainer';

if (typeof Element !== 'undefined') {
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

afterEach(cleanup);
beforeEach(() => {
    pushMock.mockReset();
});

const base = (index: number, over: Partial<Recipe> = {}): Recipe => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    ownerId: 'usr_1',
    title: `Recipe ${index}`,
    description: 'd',
    prepTimeMinutes: 10,
    cookTimeMinutes: 40,
    totalTimeMinutes: 50,
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
    cuisine: 'Thai',
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-19T09:30:00.000Z',
    ...over,
});

/** A client whose `listRecipes` serves `library` in pages, as the endpoint does. */
function clientOver(library: readonly Recipe[]): {
    client: RecipeServiceClient;
    listRecipes: ReturnType<typeof vi.fn>;
} {
    const client = createFakeRecipeServiceClient();
    const listRecipes = vi.spyOn(client, 'listRecipes').mockImplementation(async ({ page = 1, pageSize = 20 } = {}) => {
        const start = (page - 1) * pageSize;
        const data = library.slice(start, start + pageSize);

        return { data, total: library.length, page, pageSize, hasMore: start + data.length < library.length };
    });
    vi.spyOn(client, 'getRecipeNutrition').mockResolvedValue({ nutrition: {} });

    return { client, listRecipes: listRecipes as unknown as ReturnType<typeof vi.fn> };
}

/** An identity client whose settings read answers `server`; both settings methods are spies. */
function identityOver(server: UserSettings) {
    const client = new ProfileServiceClient({ baseUrl: 'https://identity.example.test', token: 'tok_1' });
    const getSettings = vi.spyOn(client, 'getSettings').mockResolvedValue(server);
    const patchSettings = vi.spyOn(client, 'patchSettings');

    identity.client = client;

    return { getSettings, patchSettings };
}

async function renderContainer(library: readonly Recipe[], server: UserSettings = SETTINGS_DEFAULTS) {
    const fake = clientOver(library);
    const settings = identityOver(server);

    await act(async () => {
        renderWithRecipeClient(<RecipeListContainer locale="en" />, fake.client);
    });

    return { ...fake, ...settings };
}

describe('RecipeListContainer (web)', () => {
    it('⛔ offers and counts a facet held only past the first page of the library (A11)', async () => {
        const library = [
            ...Array.from({ length: 120 }, (_unused, index) => base(index)),
            base(120, { cuisine: 'Peruvian' }),
            base(121, { cuisine: 'Peruvian' }),
        ];
        await renderContainer(library);

        expect(screen.getByText('122 recipes')).toBeTruthy();
        expect(
            within(screen.getByRole('group', { name: 'Quick filters' })).getByRole('button', { name: 'Peruvian 2' }),
        ).toBeTruthy();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Peruvian 2' }));
        });

        expect(screen.getByText('2 recipes')).toBeTruthy();
    });

    it('narrows by the search, and a no-match search clears back', async () => {
        await renderContainer([base(1, { title: 'Lamb Tagine' }), base(2, { title: 'Pasta' })]);

        await act(async () => {
            fireEvent.change(screen.getByRole('searchbox', { name: 'Search your recipes' }), {
                target: { value: 'zzz' },
            });
        });

        expect(screen.getByText('Nothing matches “zzz”.')).toBeTruthy();

        await act(async () => {
            // The no-match body's own Clear search (the field's clear control shares the name).
            const noMatch = screen.getByText('Nothing matches “zzz”.').closest('[role="status"]') as HTMLElement;
            fireEvent.click(within(noMatch).getByRole('button', { name: 'Clear search' }));
        });

        expect(screen.getByText('2 recipes')).toBeTruthy();
    });

    describe('the list/grid choice is an account setting', () => {
        const card = () => screen.getByRole('article', { name: 'Recipe 1' }).getAttribute('data-card-variant');

        it.each([
            ['list', 'row'],
            ['grid', 'grid'],
        ] as const)('CHOSEN: draws the %s the account holds', async (recipeViewMode, variant) => {
            await renderContainer([base(1)], { ...SETTINGS_DEFAULTS, recipeViewMode });

            await vi.waitFor(() => expect(card()).toBe(variant));
        });

        it('DEFAULT: with nothing chosen the width picks, and nothing is written', async () => {
            const { patchSettings } = await renderContainer([base(1)], {
                ...SETTINGS_DEFAULTS,
                recipeViewMode: 'auto',
            });

            // jsdom has no layout, so the container class is the one the hook measures from a zero-width <main>.
            expect(['row', 'grid']).toContain(card());
            expect(patchSettings).not.toHaveBeenCalled();
        });

        it('SAVING: shows the new view at once, sends only the view, and writes no cookie', async () => {
            const { patchSettings } = await renderContainer([base(1)], {
                ...SETTINGS_DEFAULTS,
                recipeViewMode: 'list',
            });
            await vi.waitFor(() => expect(card()).toBe('row'));
            patchSettings.mockReturnValue(new Promise<UserSettings>(() => undefined));

            await act(async () => {
                fireEvent.click(screen.getByRole('radio', { name: 'Grid view' }));
            });

            expect(card()).toBe('grid');
            expect(patchSettings).toHaveBeenCalledWith({ recipeViewMode: 'grid' });
            expect(screen.queryByRole('alert')).toBeNull();
            expect(document.cookie).not.toContain('recipes.viewMode');
        });

        it('FAILED: the view goes back, and a localized alert says the choice was not saved', async () => {
            const { patchSettings } = await renderContainer([base(1)], {
                ...SETTINGS_DEFAULTS,
                recipeViewMode: 'list',
            });
            await vi.waitFor(() => expect(card()).toBe('row'));
            patchSettings.mockRejectedValue(new Error('503'));

            await act(async () => {
                fireEvent.click(screen.getByRole('radio', { name: 'Grid view' }));
            });

            expect((await screen.findByRole('alert')).textContent).toBe(
                'We couldn’t save your view. Try choosing it again.',
            );
            expect(card()).toBe('row');
        });
    });

    it('forwards a new sort to the server', async () => {
        const { listRecipes } = await renderContainer([base(1)]);
        const user = (await import('@testing-library/user-event')).default.setup();

        screen.getByRole('button', { name: 'Sort: Recently edited' }).focus();
        await user.keyboard('{Enter}');
        await user.click(await screen.findByRole('menuitemradio', { name: 'A–Z' }));

        expect(listRecipes.mock.calls.some(([params]) => params?.sortBy === 'title')).toBe(true);
        expect(await screen.findByRole('button', { name: 'Sort: A–Z' })).toBeTruthy();
    });

    it('hides the search on the first run, and keeps the segments', async () => {
        await renderContainer([]);

        expect(screen.getByRole('heading', { level: 2, name: 'Your recipe box is empty' })).toBeTruthy();
        expect(screen.queryByRole('searchbox')).toBeNull();
        expect(screen.getByRole('navigation', { name: 'Recipes' })).toBeTruthy();
    });

    it('routes the Collections segment, and a card to its recipe', async () => {
        await renderContainer([base(7)]);

        fireEvent.click(screen.getByRole('link', { name: 'Collections' }), { button: 0 });
        fireEvent.click(screen.getByRole('link', { name: 'Recipe 7' }), { button: 0 });

        expect(pushMock).toHaveBeenNthCalledWith(1, '/en/collections');
        expect(pushMock).toHaveBeenNthCalledWith(2, `/en/recipes/${base(7).id}`);
        expect(screen.getByRole('link', { name: 'Recipe 7' }).getAttribute('href')).toBe(`/en/recipes/${base(7).id}`);
    });
});
