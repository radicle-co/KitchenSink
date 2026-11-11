/**
 * {@link useRecipeEditorSession} — the editor session both containers mount (finding 12 of the 2026-10-09 review: about
 * 150 lines of it were copied into the web container and the native screen). It binds the editor's lifecycle to its
 * ports: the hand-offs to a NAVIGATION PORT each platform maps to its own router, the visibility follow-up, a leave the
 * platform hears by another route, and Paste a list, whose gate and whose hold on the create the editor decides.
 *
 * Real hooks over the type-checked fake client; the write port is the fake outbox the lifecycle suite uses.
 */
import type { PrivateRefusal } from '../../actions/privateGate.js';
import { makeQuietFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeStatus, RecipeVisibility, type RecipeDetail } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { recipeQueries, recipeServiceKeys, type RecipeServiceClient } from '@kitchensink/recipe-service-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { makeFakeEditorWritePort } from '../../__fixtures__/editorWritePort.js';
import { makeRecipeDetail as makeBaseRecipeDetail } from '../../__fixtures__/index.js';

/**
 * A recipe as the editor meets one: with a cuisine, which Publish needs since 2026-10-13. The shared Object Mother states
 * none, and every Publish case here is about the editor's machinery, not the cuisine rule (`validate.test.ts` owns it).
 */
const makeRecipeDetail = (...[overrides]: Parameters<typeof makeBaseRecipeDetail>) =>
    makeBaseRecipeDetail({ cuisine: 'Italian', ...overrides });

import { toRecipeFormValues } from '../../form/wire.js';
import type { EditorSeed } from '../../hooks/useRecipeEditor.js';
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

function mount(
    seed: EditorSeed = {},
    client: RecipeServiceClient = createFakeRecipeServiceClient(),
    options: {
        readonly strict?: boolean;
        readonly drafts?: DraftStore;
        readonly onRecipeRef?: (ref: string) => void;
        /** Why the server is KNOWN to refuse a change to private (`useRecipePrivate`); undefined = nothing known. */
        readonly privateRefusal?: PrivateRefusal | undefined;
    } = {},
) {
    const port = makeFakeEditorWritePort();
    const nav = navigation();
    let leave: (() => void) | undefined;
    nav.subscribeToLeave.mockImplementation((listener: () => void) => {
        leave = listener;

        return () => undefined;
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
    const providers = ({ children }: { readonly children: ReactNode }) => (
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
                port,
                drafts: options.drafts ?? NO_DRAFTS,
                navigation: nav,
                reportError: vi.fn(),
                openPaste: false,
                privateRefusal: options.privateRefusal,
                ...(options.onRecipeRef === undefined ? {} : { onRecipeRef: options.onRecipeRef }),
            }),
        // ⚠️ `reactStrictMode`, not a `<StrictMode>` inside the wrapper: React replays effects only for a StrictMode the
        // ROOT renders, so a wrapper-level one ran no replay and the StrictMode tests here proved nothing.
        { wrapper: providers, reactStrictMode: options.strict === true },
    );

    return { ...view, port, nav, client, queryClient, leave: () => leave?.() };
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

        // E8: the hand-off names how the editor finished, for the snackbar the next page shows.
        expect(nav.finished).toHaveBeenCalledWith('rec_9', { outcome: 'firstPublish', privateRefused: undefined });
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_9', RecipeVisibility.PRIVATE));
    });

    /**
     * ADDED for the owner rule "nothing may turn a private recipe public on its own": a stored draft the server holds as
     * Public, marked Private, has the visibility written through the real mutation BEFORE the publish update is queued.
     */
    it('⛔ a stored public draft marked Private has its visibility written before the publish is queued', async () => {
        const client = createFakeRecipeServiceClient();
        const stored = complete({ visibility: RecipeVisibility.PUBLIC });
        const setVisibility = vi
            .spyOn(client, 'setRecipeVisibility')
            .mockResolvedValue({ ...stored, visibility: RecipeVisibility.PRIVATE });
        const { result, port } = mount({ recipe: stored }, client);

        act(() => {
            result.current.editor.setField('visibility', RecipeVisibility.PRIVATE);
        });
        act(() => {
            result.current.editor.publish('');
        });

        expect(port.submitted).toHaveLength(0);
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_9', RecipeVisibility.PRIVATE));
        await waitFor(() => expect(port.submitted).toHaveLength(1));
        expect(port.submitted[0]).toMatchObject({ intentKind: 'update', payload: { input: { status: 'published' } } });
    });

    it('Save changes on a published recipe finishes as changesSaved', async () => {
        const stored = complete({ status: RecipeStatus.PUBLISHED });
        const { result, port, nav } = mount({ recipe: stored });

        act(() => {
            result.current.editor.setField('description', 'Creamier.');
        });
        act(() => {
            result.current.editor.saveChanges('');
        });
        await settle();
        act(() => {
            port.sync(port.lastSeq(), { ...stored, currentVersion: 2 });
        });
        await settle();

        expect(nav.finished).toHaveBeenCalledExactlyOnceWith('rec_9', {
            outcome: 'changesSaved',
            privateRefused: undefined,
        });
    });

    /**
     * The stuck-save defect, at the hand-off: the editor opened on a private recipe that was made public elsewhere (a
     * stale seed), so its draft still says Private when the save's answer says public. For a cook the server refuses
     * Private, nothing is sent — it would be refused after the editor had gone — and the finish says why.
     */
    it.each([
        ['final', 'final'],
        ['premium', 'premium'],
        ['every private slot used', 'slots'],
    ] as const)('⛔ with %s known, a refused Private is not sent, and the finish says so', async (_why, refusal) => {
        const client = createFakeRecipeServiceClient();
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility');
        const stored = complete({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PRIVATE });
        const { result, port, nav } = mount({ recipe: stored }, client, { privateRefusal: refusal });

        act(() => {
            result.current.editor.setField('description', 'Creamier.');
        });
        act(() => {
            result.current.editor.saveChanges('');
        });
        await settle();
        act(() => {
            port.sync(port.lastSeq(), { ...stored, currentVersion: 2, visibility: RecipeVisibility.PUBLIC });
        });
        await settle();

        expect(nav.finished).toHaveBeenCalledExactlyOnceWith('rec_9', {
            outcome: 'changesSaved',
            privateRefused: refusal,
        });
        expect(setVisibility).not.toHaveBeenCalled();
    });

    // Review B1: a profile read still pending OR failed is UNKNOWN, never a refusal — the display's `hidden` for a failed
    // read must not decide a write, or an entitled cook's Private is withheld and the recipe published. ADR-0073 adds the
    // slot count: a standing still loading or failed is unknown too, and the server decides under its lock.
    it('⛔ while no refusal is KNOWN (paid features or slot count loading or failed), the Private is sent and the server decides', async () => {
        const client = createFakeRecipeServiceClient();
        const setVisibility = vi.spyOn(client, 'setRecipeVisibility');
        const stored = complete({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PRIVATE });
        const { result, port, nav } = mount({ recipe: stored }, client, { privateRefusal: undefined });

        act(() => {
            result.current.editor.setField('description', 'Creamier.');
        });
        act(() => {
            result.current.editor.saveChanges('');
        });
        await settle();
        act(() => {
            port.sync(port.lastSeq(), { ...stored, currentVersion: 2, visibility: RecipeVisibility.PUBLIC });
        });
        await settle();

        expect(nav.finished).toHaveBeenCalledExactlyOnceWith('rec_9', {
            outcome: 'changesSaved',
            privateRefused: undefined,
        });
        await waitFor(() => expect(setVisibility).toHaveBeenCalledWith('rec_9', RecipeVisibility.PRIVATE));
    });

    it('⛔ a new recipe`s create never carries a Private the server refuses: it goes out public', async () => {
        const { result, port } = mount({}, createFakeRecipeServiceClient(), { privateRefusal: 'final' });

        act(() => {
            result.current.editor.setValues({
                ...toRecipeFormValues(complete()),
                visibility: RecipeVisibility.PRIVATE,
            });
        });
        act(() => {
            result.current.editor.publish('');
        });
        await settle();

        expect(port.submitted.at(-1)?.payload).toMatchObject({ input: { visibility: RecipeVisibility.PUBLIC } });
    });

    // Review S1: the preview shows what will be sent, as the field does - one answer (`effectiveVisibility`).
    // REWRITTEN for the owner ruling of 2026-10-26 (ADR-0073 section 12): a draft holds no slot, so the slots refusal no
    // longer turns a DRAFT's Private into Public; `final` and `premium` still do, and a PUBLISHED recipe still meets `slots`.
    it('⛔ the preview shows a draft Private as Public only under a refusal that applies to drafts', () => {
        const values = { ...toRecipeFormValues(complete()), visibility: RecipeVisibility.PRIVATE, photos: [] };
        const final = mount({}, createFakeRecipeServiceClient(), { privateRefusal: 'final' });
        const slots = mount({}, createFakeRecipeServiceClient(), { privateRefusal: 'slots' });
        const granted = mount({}, createFakeRecipeServiceClient(), { privateRefusal: undefined });

        act(() => {
            final.result.current.editor.setValues(values);
            slots.result.current.editor.setValues(values);
            granted.result.current.editor.setValues(values);
        });

        expect(final.result.current.preview.recipe.visibility).toBe(RecipeVisibility.PUBLIC);
        expect(slots.result.current.preview.recipe.visibility).toBe(RecipeVisibility.PRIVATE);
        expect(granted.result.current.preview.recipe.visibility).toBe(RecipeVisibility.PRIVATE);
    });

    it('a PUBLISHED recipe asked for Private with every slot used previews as Public (a published move needs the slot)', () => {
        const published = complete({ status: RecipeStatus.PUBLISHED, visibility: RecipeVisibility.PUBLIC });
        const view = mount({ recipe: published }, createFakeRecipeServiceClient(), { privateRefusal: 'slots' });

        act(() => {
            view.result.current.editor.setValues({
                ...toRecipeFormValues(published),
                visibility: RecipeVisibility.PRIVATE,
            });
        });

        expect(view.result.current.preview.recipe.visibility).toBe(RecipeVisibility.PUBLIC);
    });

    // ADDED after review (ADR-0073 section 12). A Publish the client could not see coming (the slot read had failed or was
    // stale) parks when the server refuses the update for want of a slot. Try again asks the gate with the standing as it is
    // then, so the standing is re-read the moment the Publish parks - not whenever the tab next happens to refocus.
    it('⛔ re-reads the private-slot standing when a Publish parks, so Try again judges it afresh', async () => {
        const { result, port, queryClient } = mount({}, createFakeRecipeServiceClient(), { privateRefusal: undefined });
        const key = recipeServiceKeys.recipePrivateSlots;
        queryClient.setQueryData(key, { kind: 'limited', used: 3, limit: 50 });

        act(() => {
            result.current.editor.setValues({
                ...toRecipeFormValues(complete()),
                visibility: RecipeVisibility.PRIVATE,
            });
        });
        act(() => {
            result.current.editor.publish('');
        });
        await settle();
        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

        act(() => {
            port.park(port.lastSeq());
        });
        await settle();

        expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
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

    /**
     * ⛔ THE COOK SEES WHICH OUTCOME HAPPENED. A published recipe's parked save may have landed, and the recipe page would
     * otherwise show the copy cached for up to its 30 s `staleTime`. Leaving for the recipe marks its read stale, so the
     * page asks the server (the designer's ask for the published Discard).
     */
    it('⛔ leaving for the recipe marks its cached read stale, so the page shows the server`s copy', async () => {
        const stored = complete({ status: RecipeStatus.PUBLISHED });
        const client = createFakeRecipeServiceClient();
        const view = mount({ recipe: stored }, client);
        const key = recipeQueries(client).detail('rec_9').queryKey;

        view.queryClient.setQueryData(key, stored);
        expect(view.queryClient.getQueryState(key)?.isInvalidated).toBe(false);

        act(() => {
            view.result.current.editor.discard();
        });

        expect(view.nav.leftForRecipe).toHaveBeenCalledWith('rec_9');
        expect(view.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
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

    /**
     * ⛔ THE WEB HAS NO `beforeRemove` (staff-architect, 2026-10-09 review, Blocking). Browser Back or a shell link
     * unmounts the editor with no checkpoint, so a titled new recipe was never created and its draft was stranded under
     * a local ref the URL no longer named. Leaving by unmounting is a leave like any other.
     */
    it('⛔ an unmount is a leave: a titled new recipe is created', async () => {
        const { result, port, unmount } = mount();

        act(() => {
            result.current.editor.setField('title', 'Soup');
        });
        unmount();
        await settle();

        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['create']);
    });

    /**
     * ⛔ A LEAVE THE ROUTE GUARD HOLDS IS NOT A LEAVE YET (PR #180 follow-up). On native, Back and the edge swipe reach
     * `beforeRemove` before `PreventLeave` asks about a photo not uploaded yet. If the cook answers Stay, nothing may have
     * run the exit checkpoint: it marks the editor as leaving and releases a waiting paste early. The unmount runs the exit
     * for a leave that does go ahead.
     */
    it('⛔ a leave heard while a photo is at risk writes nothing; the unmount that follows a real leave does', async () => {
        vi.stubGlobal('fetch', () => new Promise<never>(() => undefined));
        const { result, port, leave, unmount } = mount({ recipe: complete() });

        act(() => {
            result.current.photos.manager.enqueuePicked(
                [
                    {
                        blob: new Blob(['x'], { type: 'image/png' }),
                        fileName: 'a.png',
                        contentType: 'image/png',
                        fileSize: 1,
                    },
                ],
                'add',
            );
        });
        // A change after the pick: the exit checkpoint would write it, so a write is how a premature exit shows.
        act(() => {
            result.current.editor.setField('description', 'Creamier.');
        });
        expect(result.current.photos.atRisk).toBe(true);

        act(() => {
            leave();
        });
        await settle();
        expect(port.submitted).toHaveLength(0);

        unmount();
        await settle();
        expect(port.submitted.map((intent) => intent.intentKind)).toEqual(['update']);
        vi.unstubAllGlobals();
    });

    /** Native hears `beforeRemove`, then unmounts: the second exit meets the first one's write on the wire and does nothing. */
    it('a leave and then the unmount send one write, not two', async () => {
        const { result, port, leave, unmount } = mount();

        act(() => {
            result.current.editor.setField('title', 'Soup');
        });
        act(() => {
            leave();
        });
        await settle();
        port.claim(port.lastSeq());
        unmount();
        await settle();

        expect(port.submitted).toHaveLength(1);
    });

    it('an unmount after the hand-off writes nothing: Discard closed the editor', async () => {
        const { result, port, unmount } = mount();

        act(() => {
            result.current.editor.setField('title', 'Soup');
        });
        act(() => {
            result.current.editor.discard();
        });
        unmount();
        await settle();

        expect(port.submitted).toEqual([]);
    });

    /**
     * React's StrictMode replays every effect once at mount in development, so the unmount's checkpoint runs there too.
     * It must be harmless: an untouched new editor writes nothing to the device or the server.
     */
    it('a StrictMode replay at mount writes nothing for an untouched new editor', async () => {
        const save = vi.fn(async () => undefined);
        const { port } = mount({}, createFakeRecipeServiceClient(), { strict: true, drafts: { ...NO_DRAFTS, save } });
        await settle();

        expect(port.submitted).toEqual([]);
        expect(save).not.toHaveBeenCalled();
    });
});

/**
 * E3 at the session: the exit checkpoint stops the address following the recipe. StrictMode's development replay runs
 * the unmount cleanup at mount, so the leave must be taken back when the effects run again, or the URL would never
 * follow a new recipe in development.
 */
describe('useRecipeEditorSession — the address after a leave (E3)', () => {
    it('stops following the created recipe once the leave began', async () => {
        const onRecipeRef = vi.fn<(ref: string) => void>();
        const { result, port, leave } = mount({}, createFakeRecipeServiceClient(), { onRecipeRef });

        act(() => {
            result.current.editor.setField('title', 'Soup');
        });
        act(() => {
            leave();
        });
        await settle();
        port.claim(port.lastSeq());
        onRecipeRef.mockClear();
        act(() => {
            port.sync(port.lastSeq(), complete());
        });
        await settle();

        expect(onRecipeRef).not.toHaveBeenCalled();
    });

    it('⛔ under the StrictMode replay the address still follows the created recipe', async () => {
        const onRecipeRef = vi.fn<(ref: string) => void>();
        const { result, port } = mount({}, createFakeRecipeServiceClient(), { strict: true, onRecipeRef });

        act(() => {
            result.current.editor.setField('title', 'Soup');
        });
        act(() => {
            result.current.editor.checkpoint('sectionChange');
        });
        await settle();
        act(() => {
            port.sync(port.lastSeq(), complete());
        });
        await settle();

        expect(onRecipeRef).toHaveBeenLastCalledWith('rec_9');
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
