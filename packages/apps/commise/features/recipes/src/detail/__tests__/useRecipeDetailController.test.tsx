/**
 * {@link useRecipeDetailController} — the recipe page's decisions, run over the REAL recipe-service hooks and a
 * network-guarded fake client. These are the logic-level cases, written once for both apps. (The render cases are in
 * `web/tests/components/recipes/RecipeDetailContainer.test.tsx` and
 * `mobile/tests/screens/RecipeDetailScreen.native.test.tsx`, which still drive the whole page through this hook.)
 *
 * The viewer is the session claim's `external_id`, else the profile's `user.id` (owner ruling 2026-10-16).
 */
import { RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksProvider } from '../CookMarksProvider.js';
import { memoryCookMarksBackend } from '../cookMarksStore.js';
import { useCookMarks, type CookMarksBinding } from '../useCookMarks.js';
import {
    useRecipeDetailController,
    type RecipeDetailNav,
    type RecipeDetailProfile,
} from '../useRecipeDetailController.js';

afterEach(cleanup);

const OWNER = 'usr_owner';

/** A settled profile read for `userId`, with the given paid-feature state. */
const settledProfile = (
    userId: string | undefined,
    paidFeatures: 'granted' | 'upsell' | 'hidden' = 'upsell',
): RecipeDetailProfile => ({
    status: 'success',
    isLoading: false,
    data: userId === undefined ? undefined : ({ user: { id: userId }, account: { paidFeatures } } as never),
});

const profileInFlight: RecipeDetailProfile = { status: 'pending', isLoading: true, data: undefined };

interface Mounted {
    readonly result: { readonly current: ReturnType<typeof useRecipeDetailController> };
    readonly nav: { [K in keyof RecipeDetailNav]: ReturnType<typeof vi.fn> };
    readonly client: ReturnType<typeof createFakeRecipeServiceClient>;
    /** The cook's marks on the recipe, read through a second binding on the same provider. */
    readonly marks: { readonly current: CookMarksBinding | undefined };
}

function mount(
    over: {
        readonly recipe?: Partial<RecipeDetail>;
        readonly sessionClaims?: unknown;
        readonly profile?: RecipeDetailProfile;
        readonly finishRefused?: boolean;
        readonly refusalArrived?: boolean;
        readonly onFinishRefusalSeen?: () => void;
    } = {},
): Mounted {
    const client = createFakeRecipeServiceClient();
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const backend = memoryCookMarksBackend();
    const marks: { current: CookMarksBinding | undefined } = { current: undefined };
    const nav = { onVersions: vi.fn(), onCloned: vi.fn(), onDeleted: vi.fn() };
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <CookMarksProvider subject="user_test" backend={backend}>
                    {children}
                </CookMarksProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
    const { result } = renderHook(
        () => {
            marks.current = useCookMarks('rec_1');

            return useRecipeDetailController({
                id: 'rec_1',
                recipe: makeRecipeDetail({
                    id: 'rec_1',
                    ownerId: OWNER,
                    visibility: RecipeVisibility.PUBLIC,
                    ...over.recipe,
                }),
                sessionClaims: over.sessionClaims,
                profile: over.profile ?? settledProfile(undefined),
                finishRefused: over.finishRefused ?? false,
                ...(over.refusalArrived === undefined ? {} : { refusalArrived: over.refusalArrived }),
                ...(over.onFinishRefusalSeen === undefined ? {} : { onFinishRefusalSeen: over.onFinishRefusalSeen }),
                nav,
            });
        },
        { wrapper },
    );

    return { result, nav, client, marks };
}

describe('useRecipeDetailController — who the viewer is', () => {
    it('reads the viewer from the session claim', () => {
        const { result } = mount({ sessionClaims: { external_id: OWNER }, profile: settledProfile('usr_other') });

        expect(result.current.viewerIsOwner).toBe(true);
    });

    it('falls back to the profile when the claim is absent', () => {
        const { result } = mount({ sessionClaims: {}, profile: settledProfile(OWNER) });

        expect(result.current.viewerIsOwner).toBe(true);
    });

    it('treats a viewer nothing names as a non-owner, ready once the profile has settled', () => {
        const { result } = mount({ profile: settledProfile(undefined) });

        expect(result.current.viewerIsOwner).toBe(false);
        expect(result.current.ready).toBe(true);
    });

    it('is not ready while nothing names the viewer and the profile is in flight', () => {
        expect(mount({ profile: profileInFlight }).result.current.ready).toBe(false);
    });

    it('is ready at once when the claim names the viewer, though the profile is in flight', () => {
        const { result } = mount({ sessionClaims: { external_id: OWNER }, profile: profileInFlight });

        expect(result.current.ready).toBe(true);
        expect(result.current.viewerIsOwner).toBe(true);
    });
});

describe('useRecipeDetailController — the action row and the ⋯ menu', () => {
    it('offers the owner Edit, and Version history then Delete in the menu', () => {
        const { result } = mount({ sessionClaims: { external_id: OWNER } });

        expect(result.current.primary).toBe('edit');
        expect(result.current.menu?.items.map((item) => item.id)).toEqual(['versions']);
        expect(result.current.menu?.destructiveItem?.id).toBe('delete');
    });

    it('offers another cook Save a copy of a public recipe, and no menu while they have no marks', () => {
        const { result } = mount({ sessionClaims: { external_id: 'usr_other' } });

        expect(result.current.primary).toBe('saveCopy');
        expect(result.current.menu).toBeUndefined();
    });

    it('offers another cook nothing to copy on a private recipe', () => {
        const { result } = mount({
            sessionClaims: { external_id: 'usr_other' },
            recipe: { visibility: RecipeVisibility.PRIVATE },
        });

        expect(result.current.primary).toBeUndefined();
    });

    it('offers Make public on a private recipe of the owner', () => {
        const { result } = mount({
            sessionClaims: { external_id: OWNER },
            recipe: { visibility: RecipeVisibility.PRIVATE },
        });

        expect(result.current.menu?.items.map((item) => item.id)).toEqual(['versions', 'makePublic']);
    });

    it.each([
        ['granted', true],
        ['upsell', true],
        ['hidden', false],
    ] as const)('offers Make private under %s: %s', (paid, offered) => {
        const { result } = mount({ sessionClaims: { external_id: OWNER }, profile: settledProfile(OWNER, paid) });

        expect(result.current.menu?.items.some((item) => item.id === 'makePrivate')).toBe(offered);
    });

    it('does not offer Make private while the profile is in flight: the paid features are the profile’s alone', () => {
        const { result } = mount({ sessionClaims: { external_id: OWNER }, profile: profileInFlight });

        expect(result.current.menu?.items.map((item) => item.id)).toEqual(['versions']);
    });

    it('offers Clear checks once the cook has marked something, and clears them', () => {
        const { result, marks } = mount({ sessionClaims: { external_id: 'usr_other' } });

        expect(result.current.menu).toBeUndefined();

        act(() => marks.current?.toggleLine('line_a'));

        expect(result.current.menu?.items.map((item) => item.id)).toEqual(['clearChecks']);

        act(() => result.current.menu?.items[0]?.onSelect());

        expect(result.current.menu).toBeUndefined();
    });

    it('sends the owner to Version history through the port', () => {
        const { result, nav } = mount({ sessionClaims: { external_id: OWNER } });

        act(() => result.current.menu?.items[0]?.onSelect());

        expect(nav.onVersions).toHaveBeenCalledTimes(1);
    });
});

describe('useRecipeDetailController — Save a copy and delete', () => {
    it('opens the copy through the port once the clone lands', async () => {
        const { result, nav, client } = mount({ sessionClaims: { external_id: 'usr_other' } });
        vi.spyOn(client, 'cloneRecipe').mockResolvedValue(makeRecipeDetail({ id: 'copy_1' }));

        act(() => result.current.clone.run());

        await waitFor(() => expect(nav.onCloned).toHaveBeenCalledWith('copy_1'));
    });

    it('reports the delete through the port, and only after it succeeded', async () => {
        const { result, nav, client } = mount({ sessionClaims: { external_id: OWNER } });
        const deleteRecipe = vi.spyOn(client, 'deleteRecipe').mockResolvedValue(undefined);

        act(() => result.current.menu?.destructiveItem?.onSelect());
        expect(result.current.dialogs.delete.open).toBe(true);
        expect(nav.onDeleted).not.toHaveBeenCalled();

        act(() => result.current.dialogs.delete.onConfirm());

        await waitFor(() => expect(nav.onDeleted).toHaveBeenCalledTimes(1));
        expect(deleteRecipe).toHaveBeenCalledWith('rec_1');
    });

    it('keeps the dialog up and says the delete failed when the write is refused', async () => {
        const { result, nav, client } = mount({ sessionClaims: { external_id: OWNER } });
        vi.spyOn(client, 'deleteRecipe').mockRejectedValue(new Error('network down'));

        act(() => result.current.menu?.destructiveItem?.onSelect());
        act(() => result.current.dialogs.delete.onConfirm());

        await waitFor(() => expect(result.current.dialogs.delete.error).toBe(true));
        expect(result.current.dialogs.delete.open).toBe(true);
        expect(nav.onDeleted).not.toHaveBeenCalled();
    });

    it('closes the delete dialog on cancel', () => {
        const { result } = mount({ sessionClaims: { external_id: OWNER } });

        act(() => result.current.menu?.destructiveItem?.onSelect());
        act(() => result.current.dialogs.delete.onCancel());

        expect(result.current.dialogs.delete.open).toBe(false);
    });

    it('shows the owner-only dialogs to the owner and no one else', () => {
        expect(mount({ sessionClaims: { external_id: OWNER } }).result.current.dialogs.viewerIsOwner).toBe(true);
        expect(mount({ sessionClaims: { external_id: 'usr_other' } }).result.current.dialogs.viewerIsOwner).toBe(false);
    });
});

describe('useRecipeDetailController — the rating block', () => {
    it('gives the owner the read-only aggregate (Sc8)', () => {
        expect(mount({ sessionClaims: { external_id: OWNER } }).result.current.rating.mode).toBe('own');
    });

    it('gives everyone else the input, pre-selected to their own rating', () => {
        const { result } = mount({ sessionClaims: { external_id: 'usr_other' }, recipe: { viewerRating: 4 } });

        expect(result.current.rating.mode).toBe('rate');
        expect(result.current.rating.selectedStars).toBe(4);
    });

    it('fails SAFE for a viewer nothing names: they are offered the input, never an inverted gate', () => {
        expect(mount().result.current.rating.mode).toBe('rate');
    });

    it('names a failed rating write "not available" for a 404 and generic otherwise', async () => {
        const { NotFoundError } = await import('@kitchensink/recipe-service-client');
        const { result, client } = mount({ sessionClaims: { external_id: 'usr_other' } });
        vi.spyOn(client, 'setRecipeRating').mockRejectedValue(new NotFoundError('gone'));

        act(() => result.current.rating.onRate(3));

        await waitFor(() => expect(result.current.rating.error).toBe('notAvailable'));
    });
});

describe('useRecipeDetailController — the visibility notice', () => {
    it('says a withheld Private only for the owner of a public recipe whose profile refuses it', () => {
        const refused = mount({
            sessionClaims: { external_id: OWNER },
            profile: settledProfile(OWNER, 'hidden'),
            finishRefused: true,
        });
        const forged = mount({
            sessionClaims: { external_id: 'usr_other' },
            profile: settledProfile('usr_other', 'hidden'),
            finishRefused: true,
        });

        expect(refused.result.current.visibilityNotice).toBeDefined();
        expect(forged.result.current.visibilityNotice).toBeUndefined();
    });
});

describe('useRecipeDetailController — the refusal claim seen once the body can mount', () => {
    it('reports an arrived claim once, when the claim made the page ready', () => {
        const onFinishRefusalSeen = vi.fn();

        mount({
            sessionClaims: { external_id: OWNER },
            profile: profileInFlight,
            refusalArrived: true,
            onFinishRefusalSeen,
        });

        expect(onFinishRefusalSeen).toHaveBeenCalledTimes(1);
    });

    it('does not report it while the page is not ready', () => {
        const onFinishRefusalSeen = vi.fn();

        mount({ profile: profileInFlight, refusalArrived: true, onFinishRefusalSeen });

        expect(onFinishRefusalSeen).not.toHaveBeenCalled();
    });

    it('does not report a claim that never arrived', () => {
        const onFinishRefusalSeen = vi.fn();

        mount({ sessionClaims: { external_id: OWNER }, onFinishRefusalSeen });

        expect(onFinishRefusalSeen).not.toHaveBeenCalled();
    });
});
