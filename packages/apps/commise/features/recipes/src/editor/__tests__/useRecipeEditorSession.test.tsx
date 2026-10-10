/**
 * {@link useRecipeEditorSession} — the editor session both containers mount (finding 12 of the 2026-10-09 review: about
 * 150 lines of it were copied into the web container and the native screen). It binds the editor's lifecycle to its
 * ports: the hand-offs to a NAVIGATION PORT each platform maps to its own router, the visibility follow-up, a leave the
 * platform hears by another route, and Paste a list, whose gate and whose hold on the create the editor decides.
 *
 * Real hooks over the type-checked fake client; the write port is the fake outbox the lifecycle suite uses.
 */
import { makeQuietFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { makeFakeEditorWritePort } from '../../__fixtures__/editorWritePort.js';
import { makeRecipeDetail } from '../../__fixtures__/index.js';
import { toRecipeFormValues } from '../../form/wire.js';
import type { EditorSeed, EditorWritePort } from '../../hooks/useRecipeEditor.js';
import type { DraftStore } from '../draftStore.js';
import { useRecipeEditorSession, type EditorNavigation } from '../useRecipeEditorSession.js';

const NO_DRAFTS: DraftStore = {
    load: async () => undefined,
    save: async () => undefined,
    discard: async () => undefined,
    adopt: async () => undefined,
    clear: async () => undefined,
};

function navigation() {
    return {
        finished: vi.fn<EditorNavigation['finished']>(),
        leftForRecipe: vi.fn<EditorNavigation['leftForRecipe']>(),
        discarded: vi.fn<EditorNavigation['discarded']>(),
        subscribeToLeave: vi.fn<NonNullable<EditorNavigation['subscribeToLeave']>>(),
    };
}

function mount(seed: EditorSeed = {}, client: RecipeServiceClient = createFakeRecipeServiceClient()) {
    const port = makeFakeEditorWritePort();
    const nav = navigation();
    let leave: (() => void) | undefined;
    nav.subscribeToLeave.mockImplementation((listener: () => void) => {
        leave = listener;

        return () => undefined;
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <RecipeServiceProvider client={client}>
                <FoodServiceProvider client={makeQuietFoodClient()} subject="user_cook">
                    {children}
                </FoodServiceProvider>
            </RecipeServiceProvider>
        </QueryClientProvider>
    );
    const view = renderHook(
        () =>
            useRecipeEditorSession({
                seed,
                locale: 'en',
                keep: 'disk',
                port: port as unknown as EditorWritePort,
                drafts: NO_DRAFTS,
                navigation: nav,
                openPaste: false,
            }),
        { wrapper },
    );

    return { ...view, port, nav, client, leave: () => leave?.() };
}

/** Let promise callbacks and effects run. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 3; turn += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

const complete = (over: Partial<RecipeDetail> = {}) =>
    makeRecipeDetail({ id: 'rec_9', currentVersion: 1, status: RecipeStatus.DRAFT, ...over });

describe('useRecipeEditorSession — the hand-offs, through the navigation port', () => {
    it('a first publish shows the recipe, after making it private when the answer is public', async () => {
        const client = createFakeRecipeServiceClient();
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility');
        const { result, port, nav } = mount({}, client);

        act(() => {
            result.current.editor.setValues({
                ...toRecipeFormValues(complete()),
                visibility: RecipeVisibility.PRIVATE,
                photos: [],
            });
        });
        act(() => {
            result.current.editor.publish('');
        });
        await settle();
        act(() => {
            port.sync(
                port.lastSeq(),
                complete({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PUBLIC }),
            );
        });
        await settle();

        expect(nav.finished).toHaveBeenCalledWith('rec_9');
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_9', RecipeVisibility.PRIVATE));
    });

    it('a discarded never-published recipe goes to My recipes; a published one`s discarded changes, to the recipe', async () => {
        const fresh = mount();

        act(() => {
            fresh.result.current.editor.discard();
        });
        expect(fresh.nav.discarded).toHaveBeenCalledTimes(1);

        const stored = mount({ recipe: complete({ status: RecipeStatus.PUBLISHED }) });

        act(() => {
            stored.result.current.editor.discard();
        });
        expect(stored.nav.leftForRecipe).toHaveBeenCalledWith('rec_9');
    });

    it('a leave heard by another route than × runs the exit checkpoint: a titled new recipe is created', async () => {
        const { result, port, leave } = mount();

        act(() => {
            result.current.editor.setField('title', 'Soup');
        });
        act(() => {
            leave();
        });
        await settle();

        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create']);
    });
});

describe('useRecipeEditorSession — Paste a list (owner D10 as amended 2026-10-09)', () => {
    it('is offered on a stored draft never published, and not on a published recipe', () => {
        // The stored draft has lines, so its heading offers it.
        expect(mount({ recipe: complete() }).result.current.paste.inHeading).toBe(true);
        expect(mount({ recipe: complete({ status: RecipeStatus.PUBLISHED }) }).result.current.paste.inHeading).toBe(
            false,
        );
        expect(mount({ recipe: complete({ status: RecipeStatus.PUBLISHED }) }).result.current.paste.view.onOpen).toBe(
            undefined,
        );
    });

    it('⛔ holds the create while a paste is on its way, so no pasted line joins a draft whose create went out', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'createParseJob').mockReturnValue(new Promise(() => undefined));
        const { result, port } = mount({}, client);

        act(() => {
            result.current.editor.setField('title', 'Soup');
        });
        act(() => {
            result.current.paste.sheet.setOpen(true);
        });
        act(() => {
            result.current.paste.sheet.setText('2 cups flour');
        });
        act(() => {
            result.current.paste.sheet.add();
        });
        await settle();
        expect(result.current.paste.pending).toBe(true);

        act(() => {
            result.current.editor.checkpoint('sectionChange');
        });
        await settle();

        expect(port.submitExclusive).not.toHaveBeenCalled();
    });
});
