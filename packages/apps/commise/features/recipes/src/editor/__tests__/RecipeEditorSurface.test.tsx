// @vitest-environment jsdom
/**
 * {@link RecipeEditorSurface} — what both apps' editor screens mount over a session (UI audit 10: the web
 * `RecipeEditorContainer` and the native `RecipeEditorScreen` each built the same `sections` map, heading actions and
 * the three trailing sheets).
 *
 * What is pinned: the section map holds each section's real leaves; a pending ingredient line gets ONE status poller;
 * the photos section asks the app for its uploader from the first render, a new recipe included (owner ruling U33: a
 * pick waits in the editor's photo queue until the recipe has an id); a leave that would lose photos asks first; Private is offered from the viewer's paid
 * features alone (E1, plan 2026-10-14-009 D14); the app's close and "My recipes" hand-offs are the ones the view calls.
 * Real hooks over the type-checked fake client, as `useRecipeEditorSession.test.tsx` has them.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { makeQuietFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PaidFeatureState } from '@commise/features-account';

import { makeFakeEditorWritePort } from '../../__fixtures__/editorWritePort.js';
import {
    makeFilledRecipeFormValues,
    makeIngredientView,
    makeRecipeDetail,
    withLineKeys,
} from '../../__fixtures__/index.js';
import { recipeFormMessages } from '../../form/messages.js';
import type { EditorSeed, PublishBlocked, UseRecipeEditorResult } from '../../hooks/useRecipeEditor.js';
import type { DraftStore } from '../draftStore.js';
import type { EditorPhotos } from '../useEditorPhotos.js';
import type { IngredientsPaste } from '../useIngredientsPaste.js';
import { RecipeEditorSurface, type PhotoUploaderTarget } from '../RecipeEditorSurface.js';
import { useRecipePrivate } from '../../actions/useRecipePrivate.js';
import { useRecipeEditorSession } from '../useRecipeEditorSession.js';

afterEach(cleanup);

const NO_DRAFTS: DraftStore = {
    load: async () => undefined,
    save: async () => undefined,
    discard: async () => undefined,
    adopt: async () => undefined,
    clear: async () => undefined,
};

interface HarnessProps {
    readonly seed: EditorSeed;
    readonly paidFeatures: PaidFeatureState;
    readonly knownPaidFeatures: Exclude<PaidFeatureState, 'loading'> | undefined;
    readonly renderPhotos: (target: PhotoUploaderTarget) => ReactNode;
    readonly onClose: () => void;
    readonly onOpenMyRecipes: () => void;
    /** The paste's lines with no food yet, as the Facade would report them (R23). */
    readonly openChoices?: IngredientsPaste['openChoices'];
    /** The editor's standing publish-as-public ask, as `useRecipeEditor` would raise it (its own tests drive the raising). */
    readonly publishBlocked?: {
        readonly ask: PublishBlocked;
        readonly keepAsDraft: () => void;
        readonly publishAsPublic: () => void;
    };
    /** Fields of the editor result the session would otherwise compute (a parked write, the draft). */
    readonly editorOver?: Partial<UseRecipeEditorResult>;
    /** The app's way to open a food's page (private foods spec D6). */
    readonly onOpenFood?: (foodId: string) => void;
    /** The editor's photo session as a state the session itself would reach (its own tests drive the reaching). */
    readonly photosOver?: (photos: EditorPhotos) => EditorPhotos;
    /** Where the app asks before a leave that would lose photos: in the page (web), or by the navigator (native). */
    readonly leaveAsk?: 'inPage' | 'byNavigator';
}

/** The surface over a real session, as an app's container mounts it. */
function Harness(props: HarnessProps): ReactElement {
    const { seed, paidFeatures, knownPaidFeatures, renderPhotos, onClose, onOpenMyRecipes } = props;
    // What the app's container does: the rule, the slot standing and the known refusal, from one hook.
    const recipePrivate = useRecipePrivate({
        sourceType: seed.recipe?.sourceType,
        sourceKind: seed.recipe?.sourceKind ?? null,
        knownPaidFeatures,
    });
    const session = useRecipeEditorSession({
        seed,
        locale: 'en',
        keep: 'disk',
        port: makeFakeEditorWritePort(),
        drafts: NO_DRAFTS,
        navigation: { finished: vi.fn(), leftForRecipe: vi.fn(), discarded: vi.fn() },
        reportError: vi.fn(),
        openPaste: false,
        privateRefusal: recipePrivate.refusal,
    });

    return (
        <RecipeEditorSurface
            session={{
                ...session,
                ...(props.openChoices === undefined
                    ? {}
                    : { paste: { ...session.paste, openChoices: props.openChoices } }),
                ...(props.editorOver === undefined ? {} : { editor: { ...session.editor, ...props.editorOver } }),
                ...(props.photosOver === undefined ? {} : { photos: props.photosOver(session.photos) }),
                ...(props.publishBlocked === undefined
                    ? {}
                    : {
                          editor: {
                              ...session.editor,
                              publishBlocked: props.publishBlocked.ask,
                              keepAsDraft: props.publishBlocked.keepAsDraft,
                              publishAsPublic: props.publishBlocked.publishAsPublic,
                          },
                      }),
            }}
            seed={seed}
            mode={seed.recipe === undefined ? 'create' : 'edit'}
            keep="disk"
            paidFeatures={paidFeatures}
            knownPaidFeatures={knownPaidFeatures}
            slotStanding={recipePrivate.standing}
            renderPhotos={renderPhotos}
            onClose={onClose}
            onOpenMyRecipes={onOpenMyRecipes}
            leaveAsk={props.leaveAsk ?? 'inPage'}
            {...(props.onOpenFood === undefined ? {} : { onOpenFood: props.onOpenFood })}
        />
    );
}

function mount(over: Partial<HarnessProps> = {}, client = createFakeRecipeServiceClient()) {
    const props: HarnessProps = {
        seed: {},
        paidFeatures: 'granted',
        knownPaidFeatures: 'granted',
        renderPhotos: () => <p>photo uploader</p>,
        onClose: vi.fn(),
        onOpenMyRecipes: vi.fn(),
        ...over,
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
        <LocaleProvider locale="en">
            <QueryClientProvider client={queryClient}>
                <RecipeServiceProvider client={client}>
                    <FoodServiceProvider client={makeQuietFoodClient()} subject="user_cook">
                        <Harness {...props} />
                    </FoodServiceProvider>
                </RecipeServiceProvider>
            </QueryClientProvider>
        </LocaleProvider>,
    );

    return { ...view, props, client };
}

describe('RecipeEditorSurface — the section map', () => {
    it('holds the four sections, each with its real leaves', () => {
        mount();

        expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
            'Details',
            'Ingredients',
            'Steps',
            'Photos & publish',
        ]);
        // Each section's own control, so a section left empty in the map fails.
        expect(screen.getByRole('textbox', { name: /^title/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Paste steps' })).toBeTruthy();
    });

    it('offers Paste a list in the Ingredients heading', () => {
        mount();

        expect(screen.getAllByRole('button', { name: 'Paste a list' }).length).toBeGreaterThan(0);
    });
});

describe('RecipeEditorSurface — the status poller', () => {
    it('polls each pending ingredient line once, and not a settled one', () => {
        const client = createFakeRecipeServiceClient();
        const poll = vi.spyOn(client, 'getIngredientStatus').mockReturnValue(new Promise(() => undefined));
        const recipe = makeRecipeDetail({
            ingredients: [
                makeIngredientView({ ingredientId: 'ing_pending', resolutionStatus: 'PENDING' }),
                makeIngredientView({ ingredientId: 'ing_done', resolutionStatus: 'RESOLVED' }),
            ],
        });

        mount({ seed: { recipe } }, client);

        expect(poll.mock.calls.map(([id]) => id)).toEqual(['ing_pending']);
    });
});

describe('RecipeEditorSurface — where the visibility field lives', () => {
    it('renders "Who can see it" inside Photos & publish', () => {
        mount({ paidFeatures: 'granted', knownPaidFeatures: 'granted' });

        const section = screen.getByRole('heading', { level: 2, name: 'Photos & publish' }).closest('section');

        expect(section).not.toBeNull();
        expect(within(section as HTMLElement).getByRole('radio', { name: /private/i })).toBeTruthy();
    });
});

/**
 * REWRITTEN (owner report 2026-11-10: "/recipes/new shows only Public/Private, no way to add a photo"). This used to pin
 * that the uploader was asked for ONLY once the recipe existed on the server — which is exactly the missing control. A
 * photo now behaves like every other field (owner ruling U33): the uploader is drawn on a new recipe too, over the
 * editor's ONE photo session, and a pick waits for the recipe to exist.
 */
describe('RecipeEditorSurface — photos', () => {
    it('draws the uploader on a new recipe, before it exists on the server, over the editor’s photo session', () => {
        const renderPhotos = vi.fn((_target: PhotoUploaderTarget) => <p>photo uploader</p>);

        mount({ renderPhotos });

        expect(screen.getByText('photo uploader')).toBeTruthy();
        expect(renderPhotos.mock.lastCall?.[0]).toMatchObject({ recipeId: null, title: '', cuisine: '' });
        expect(renderPhotos.mock.lastCall?.[0].manager.queue.items).toEqual([]);
    });

    it('asks for the uploader with the recipe id, title and cuisine once it exists', () => {
        const renderPhotos = vi.fn((_target: PhotoUploaderTarget) => <p>photo uploader</p>);
        const recipe = makeRecipeDetail({ id: 'rec_1', title: 'Soup', cuisine: 'Italian' });

        mount({ seed: { recipe }, renderPhotos });

        expect(renderPhotos.mock.lastCall?.[0]).toMatchObject({ recipeId: 'rec_1', title: 'Soup', cuisine: 'Italian' });
        expect(screen.getByText('photo uploader')).toBeTruthy();
    });

    /** The ask before a leave would lose photos (each app raises it: web on ×, native on any leave of the screen). */
    it('asks "Leave without your photos?" while the session asks it: Stay and Leave are the session’s', async () => {
        const stay = vi.fn();
        const confirm = vi.fn();
        mount({
            photosOver: (photos) => ({
                ...photos,
                atRisk: true,
                atRiskCount: 1,
                waitingForTitle: true,
                manager: {
                    ...photos.manager,
                    queue: {
                        ...photos.manager.queue,
                        items: [{ fileId: 1, fileName: 'a.png', status: 'waiting', retryable: false }],
                    },
                },
                leave: { ...photos.leave, open: true, stay, confirm },
            }),
        });

        const ask = screen.getByRole('alertdialog', { name: 'Leave without your photos?' });
        expect(
            within(ask).getByText('1 photo uploads once this recipe has a title. If you leave now, it won’t be kept.'),
        ).toBeTruthy();

        await userEvent.click(within(ask).getByRole('button', { name: 'Stay' }));
        expect(stay).toHaveBeenCalledOnce();

        await userEvent.click(within(ask).getByRole('button', { name: 'Leave without photos' }));
        expect(confirm).toHaveBeenCalledOnce();
    });

    /**
     * Where the ask lives (GATE 2026-11-10). On web the page asks for EVERY exit it hands the app: × and the "My recipes"
     * hand-offs, which are client-side navigations the tab-close prompt cannot see. On native the navigator's guard
     * (`PreventLeave`) catches every removal of the screen, so the page must not ask too: the cook would be asked twice.
     */
    it('web: × with a photo at risk asks first, and closes only when the leave goes', async () => {
        const request = vi.fn<(proceed: () => void) => void>();
        const { props } = mount({
            photosOver: (photos) => ({ ...photos, atRisk: true, leave: { ...photos.leave, request } }),
        });

        await userEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(request).toHaveBeenCalledOnce();
        expect(props.onClose).not.toHaveBeenCalled();

        act(() => request.mock.lastCall?.[0]());
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('native: × leaves at once and asks nothing in the page: the navigator asks', async () => {
        const request = vi.fn<(proceed: () => void) => void>();
        const { props } = mount({
            leaveAsk: 'byNavigator',
            photosOver: (photos) => ({ ...photos, atRisk: true, leave: { ...photos.leave, request } }),
        });

        await userEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(request).not.toHaveBeenCalled();
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    /**
     * ⛔ PR #180 follow-up: on native, × used to run the exit checkpoint and THEN navigate, so the route guard asked after
     * the editor had already recorded a leave. While a photo is at risk, × only navigates; the guard asks, and the unmount
     * runs the exit checkpoint for a leave that goes ahead. With nothing at risk, × checkpoints as before.
     */
    it('native: × with a photo at risk navigates without the exit checkpoint', async () => {
        const checkpoint = vi.fn<UseRecipeEditorResult['checkpoint']>();
        const { props } = mount({
            leaveAsk: 'byNavigator',
            editorOver: { checkpoint },
            photosOver: (photos) => ({ ...photos, atRisk: true }),
        });

        await userEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(props.onClose).toHaveBeenCalledOnce();
        expect(checkpoint).not.toHaveBeenCalledWith('editorExit');
    });

    it('native: × with nothing at risk checkpoints the exit, then leaves', async () => {
        const checkpoint = vi.fn<UseRecipeEditorResult['checkpoint']>();
        const { props } = mount({ leaveAsk: 'byNavigator', editorOver: { checkpoint } });

        await userEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(checkpoint).toHaveBeenCalledWith('editorExit');
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('during a finish that waits for photos, shows only Photos & publish, without the visibility choice', () => {
        mount({
            photosOver: (photos) => ({ ...photos, finish: { kind: 'uploading' } }),
            editorOver: { state: { status: 'done' } },
        });

        expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
            'Photos & publish',
        ]);
        expect(screen.getByText('photo uploader')).toBeTruthy();
        expect(screen.queryByRole('radio', { name: /private/i })).toBeNull();
        expect(screen.getByText('Recipe saved. Finishing your photo uploads…')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Finish without the remaining photos' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    });

    /**
     * staff-architect REVIEW 2026-11-10, finding 3: the editor reaching "done" and its finish being held may land in
     * different commits. In between, a photo still at risk keeps the page mounted, so the uploader (and the previews it
     * owns) never unmounts under a photo that is still going.
     */
    it('keeps the page while a photo is at risk, even before the finish is held', () => {
        mount({
            photosOver: (photos) => ({ ...photos, atRisk: true, atRiskCount: 1 }),
            editorOver: { state: { status: 'done' } },
        });

        expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    });

    it('says how many photos failed while a finish waits on them', () => {
        mount({
            photosOver: (photos) => ({ ...photos, finish: { kind: 'failed', count: 2 } }),
            editorOver: { state: { status: 'done' } },
        });

        expect(screen.getByText('2 photos didn’t upload. Retry them, or finish without them.')).toBeTruthy();
    });
});

describe('RecipeEditorSurface — the Private choice', () => {
    /** The server's read of the cook's slots, which the surface shows and never states itself. */
    function withSlots(used: number, limit = 50) {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getPrivateSlots').mockResolvedValue({ kind: 'limited', used, limit });

        return client;
    }

    it('offers Private to a viewer whose paid features grant it', () => {
        mount({ paidFeatures: 'granted', knownPaidFeatures: 'granted' });

        expect(screen.getByRole('radio', { name: /private/i })).toBeTruthy();
    });

    // REWRITTEN for ADR-0073. It used to say a viewer whose paid features hide Private gets no Private choice. A free cook
    // keeps up to the server's limit of recipes private, paid features or not, so hidden paid features no longer hide it.
    it('⛔ offers Private to a free cook even when paid features are hidden: a slot, not Pro', () => {
        mount({ paidFeatures: 'hidden', knownPaidFeatures: 'hidden' });

        expect(screen.getByRole('radio', { name: /private/i })).toBeTruthy();
    });

    // REWRITTEN for ADR-0077 section 6: an imported public-web recipe is under the slots rule, so with paid features hidden
    // Private is OFFERED, not refused (it used to be aria-disabled with "can only be public").
    it('⛔ offers Private, not refused, for an imported public-web recipe when paid features are hidden', () => {
        const recipe = makeRecipeDetail({ sourceType: 'imported_public', visibility: 'public' });

        mount({ seed: { recipe }, paidFeatures: 'hidden', knownPaidFeatures: 'hidden' });

        const card = screen.getByRole('radio', { name: /private/i });

        expect(card.getAttribute('aria-disabled')).toBeNull();
        expect(screen.queryByText('Not available. A recipe from a public web page can only be public.')).toBeNull();
    });

    // REWRITTEN for the owner ruling of 2026-10-26 (ADR-0073 section 12): a DRAFT holds no slot. These two cases used a new
    // recipe (a draft) and expected the count and the refusal; they now use a PUBLISHED recipe, which is what holds one,
    // and the draft cases follow.
    const PUBLISHED_PUBLIC: EditorSeed = {
        recipe: makeRecipeDetail({ status: RecipeStatus.PUBLISHED, visibility: 'public', cuisine: 'Italian' }),
    };

    it('shows how many private slots are left, from the server`s read, on a published recipe', async () => {
        mount({ seed: PUBLISHED_PUBLIC, paidFeatures: 'upsell', knownPaidFeatures: 'upsell' }, withSlots(38));

        expect(await screen.findByText('12 of 50 private slots left')).toBeTruthy();
    });

    it('⛔ with every slot used, refuses Private on a published recipe with its three ways forward; the first two go to My recipes, Pro opens the sheet', async () => {
        const user = userEvent.setup();
        const { props } = mount(
            { seed: PUBLISHED_PUBLIC, paidFeatures: 'upsell', knownPaidFeatures: 'upsell' },
            withSlots(50),
        );

        expect(await screen.findByText('Not available. All 50 of your private slots are in use.')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: /Make a private recipe public/u }));
        await user.click(screen.getByRole('button', { name: /Delete a private recipe/u }));
        expect(props.onOpenMyRecipes).toHaveBeenCalledTimes(2);

        await user.click(screen.getByRole('button', { name: /Get Pro/u }));
        expect(await screen.findByRole('dialog')).toBeTruthy();
    });

    /** GATE 2026-11-10: on web, "My recipes" is a leave too, and a photo still uploading would be lost by it. */
    it('web: with a photo at risk, a refusal`s way forward asks before it leaves for My recipes', async () => {
        const user = userEvent.setup();
        const request = vi.fn<(proceed: () => void) => void>();
        const { props } = mount(
            {
                seed: PUBLISHED_PUBLIC,
                paidFeatures: 'upsell',
                knownPaidFeatures: 'upsell',
                photosOver: (photos) => ({ ...photos, atRisk: true, leave: { ...photos.leave, request } }),
            },
            withSlots(50),
        );

        expect(await screen.findByText('Not available. All 50 of your private slots are in use.')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: /Make a private recipe public/u }));

        expect(request).toHaveBeenCalledOnce();
        expect(props.onOpenMyRecipes).not.toHaveBeenCalled();

        act(() => request.mock.lastCall?.[0]());
        expect(props.onOpenMyRecipes).toHaveBeenCalledOnce();
    });

    it('native: "My recipes" with a photo at risk goes to My recipes and lets the route guard ask', async () => {
        const user = userEvent.setup();
        const request = vi.fn<(proceed: () => void) => void>();
        const { props } = mount(
            {
                seed: PUBLISHED_PUBLIC,
                paidFeatures: 'upsell',
                knownPaidFeatures: 'upsell',
                leaveAsk: 'byNavigator',
                photosOver: (photos) => ({ ...photos, atRisk: true, leave: { ...photos.leave, request } }),
            },
            withSlots(50),
        );

        expect(await screen.findByText('Not available. All 50 of your private slots are in use.')).toBeTruthy();
        await user.click(screen.getByRole('button', { name: /Make a private recipe public/u }));

        expect(request).not.toHaveBeenCalled();
        expect(props.onOpenMyRecipes).toHaveBeenCalledOnce();
        expect(props.onClose).not.toHaveBeenCalled();
    });

    describe('a private DRAFT with every slot used (ADR-0073 section 12)', () => {
        const REFUSAL = 'Not available. All 50 of your private slots are in use.';
        const PRIVATE_DRAFT_SEED: EditorSeed = {
            recipe: makeRecipeDetail({ status: RecipeStatus.DRAFT, visibility: 'private', cuisine: 'Italian' }),
        };

        /** Mount, and wait until the surface has the cook's real standing, so what follows is not a read still in flight. */
        async function mountFull(seed: EditorSeed) {
            const client = withSlots(50);
            const view = mount({ seed, paidFeatures: 'hidden', knownPaidFeatures: 'hidden' }, client);

            await waitFor(() => expect(client.getPrivateSlots).toHaveBeenCalled());
            // Let the query settle and the surface re-render with the answer (a macrotask: the cache notifies on one).
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
            });

            return view;
        }

        it('⛔ shows NO out-of-slots refusal: it says a private draft uses no slot, and keeps Private chosen', async () => {
            await mountFull(PRIVATE_DRAFT_SEED);

            expect(screen.queryByText(REFUSAL)).toBeNull();
            expect(screen.queryByRole('button', { name: /Delete a private recipe/u })).toBeNull();
            expect(screen.getAllByText('A private draft uses no slot. Publishing it uses one.').length).toBeGreaterThan(
                0,
            );
            expect((screen.getByRole('radio', { name: /private/i }) as HTMLInputElement).checked).toBe(true);
        });

        // REWRITTEN for the owner ruling of 2026-10-26: PUBLISHING a private draft with every slot used used to draw the
        // refusal and its ways forward inline. It now opens the "Your private slots are full" dialog and draws nothing inline.
        it('⛔ PUBLISHING it opens the dialog, keeps Private chosen, and draws no inline refusal', async () => {
            const user = userEvent.setup();

            await mountFull(PRIVATE_DRAFT_SEED);
            await user.click(screen.getByRole('button', { name: 'Publish' }));

            const dialog = await screen.findByRole('dialog', { name: 'Your private slots are full' });

            expect(within(dialog).getByText(/^All 50 of your private slots are in use, so this recipe/u)).toBeTruthy();
            expect(screen.queryByText(REFUSAL)).toBeNull();
            expect(screen.queryByRole('button', { name: /Delete a private recipe/u })).toBeNull();
        });

        it('Keep as draft closes it and keeps Private chosen; nothing is published', async () => {
            const user = userEvent.setup();

            await mountFull(PRIVATE_DRAFT_SEED);
            await user.click(screen.getByRole('button', { name: 'Publish' }));
            await screen.findByRole('dialog', { name: 'Your private slots are full' });
            await user.click(screen.getByRole('button', { name: 'Keep as draft' }));

            await waitFor(() =>
                expect(screen.queryByRole('dialog', { name: 'Your private slots are full' })).toBeNull(),
            );
            expect((screen.getByRole('radio', { name: /private/i }) as HTMLInputElement).checked).toBe(true);
        });
    });

    it('Pro sees no count', async () => {
        const client = createFakeRecipeServiceClient();
        vi.spyOn(client, 'getPrivateSlots').mockResolvedValue({ kind: 'unlimited' });
        mount({ paidFeatures: 'granted', knownPaidFeatures: 'granted' }, client);

        // Wait for the read to SETTLE (the "checking" line goes), so the absence below is Pro's, not a read in flight.
        await waitFor(() => expect(screen.queryByText('Checking your private slots…')).toBeNull());

        expect(screen.queryByText(/private slots/u)).toBeNull();
    });
});

describe('RecipeEditorSurface — hand-offs', () => {
    it('closes through the app’s close', async () => {
        const { props } = mount();

        await userEvent.click(screen.getByRole('button', { name: /^close/i }));

        expect(props.onClose).toHaveBeenCalledTimes(1);
    });
});

/**
 * ⛔ A REFUSED PUBLISH'S "YOU HAVE TEXT YOU HAVEN'T ADDED" GOES WHEN THE TEXT DOES. The editor hears the ingredient entry
 * only at the press, so the error was read from the press's text and stayed on screen after the cook cleared the entry,
 * until the next press. The surface reads the entry as it is now.
 */
describe('RecipeEditorSurface — an error about the ingredient entry', () => {
    const pending = recipeFormMessages.en.errors.ingredientsPendingText;

    it('shows ingredientsPendingText after a refused Publish, and drops it when the entry is cleared', async () => {
        const user = userEvent.setup();

        mount();

        const entry = screen.getByRole('combobox', { name: 'Add an ingredient' });

        await user.type(entry, 'flour');
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(screen.getAllByText(pending).length).toBeGreaterThan(0);

        await user.clear(entry);

        expect(screen.queryByText(pending)).toBeNull();
    });
});

describe('RecipeEditorSurface — Publish asks about the paste’s open lines (R23)', () => {
    const FACTS = { openNames: ['milk'], checkingNames: [], counted: 3, total: 4 };
    // A stored draft that would publish: the ask comes only for a publish the gate would accept.
    const DRAFT_SEED: EditorSeed = { recipe: makeRecipeDetail({ status: RecipeStatus.DRAFT, cuisine: 'Italian' }) };

    it('⛔ hands the paste’s open lines to the editor, so Publish asks before it saves them as written', async () => {
        const user = userEvent.setup();
        const chooseNow = vi.fn();

        mount({ seed: DRAFT_SEED, openChoices: { facts: FACTS, chooseNow } });
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(screen.getByRole('dialog', { name: '1 ingredient has no food yet' })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Choose now' }));

        expect(chooseNow).toHaveBeenCalledTimes(1);
    });

    it('does not ask while no line needs a pick', async () => {
        const user = userEvent.setup();

        mount({ seed: DRAFT_SEED, openChoices: { facts: undefined, chooseNow: vi.fn() } });
        await user.click(screen.getByRole('button', { name: 'Publish' }));

        expect(screen.queryByRole('dialog', { name: /have no food yet|has no food yet/u })).toBeNull();
    });
});

describe('RecipeEditorSurface — the blocked-publish dialog', () => {
    // REWRITTEN for ADR-0077 section 6: the `webImport` ask is gone; only the slots ask remains.
    it('shows the slots ask while the editor stands it, wired to the editor’s two answers', async () => {
        const ask = { kind: 'noSlot' } as const;
        const title = 'Your private slots are full';
        const user = userEvent.setup();
        const keepAsDraft = vi.fn();
        const publishAsPublic = vi.fn();

        mount({ publishBlocked: { ask, keepAsDraft, publishAsPublic } });

        expect(screen.getByRole('dialog', { name: title })).toBeTruthy();

        await user.click(screen.getByRole('button', { name: 'Keep as draft' }));
        expect(keepAsDraft).toHaveBeenCalledTimes(1);
        expect(publishAsPublic).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Publish as public' }));
        expect(publishAsPublic).toHaveBeenCalledTimes(1);
    });

    it('shows nothing while no ask stands', () => {
        mount();

        expect(screen.queryByRole('dialog', { name: /private slots are full|can.t be private yet/u })).toBeNull();
    });
});

describe('RecipeEditorSurface — the refusal of a private food in a public recipe (F6, revision 4)', () => {
    const LINE = {
        isUserEntered: false,
        ingredientId: '00000000-0000-4000-8000-000000000001',
        foodId: 'food_spice',
        name: 'My spice mix',
        quantity: 2,
        unit: 'tbsp',
        foodVisibility: 'private' as const,
    };
    const publicDraft = (visibility: RecipeVisibility = RecipeVisibility.PUBLIC) =>
        makeFilledRecipeFormValues({ visibility, ingredients: withLineKeys([LINE]) });
    // What `useRecipeEditor` holds once the server refused the write: the write is already dropped, so nothing is parked.
    const refusal = { lines: [{ sortOrder: 0, foodId: 'food_spice' }], count: 1 } as const;

    const open = (over: Partial<HarnessProps> = {}) => {
        const setValues = vi.fn();
        const retry = vi.fn();
        const publish = vi.fn();
        const onOpenFood = vi.fn();
        const view = mount({
            editorOver: { values: publicDraft(), privateFoodRefusal: refusal, setValues, retry, publish },
            onOpenFood,
            ...over,
        });

        return { ...view, setValues, retry, publish, onOpenFood };
    };

    const sheetName = 'This recipe can’t be public yet';

    it('⛔ a refusal of a private food opens the sheet, naming the line', () => {
        open();
        const dialog = screen.getByRole('dialog', { name: sheetName });

        expect(within(dialog).getByText(/1 ingredient uses a food only you can see/u)).toBeTruthy();
        expect(within(dialog).getByText('2 tbsp')).toBeTruthy();
        expect(within(dialog).getByText('My spice mix')).toBeTruthy();
    });

    it('⛔ shows no save-failure notice and no Try again: the refused write is dropped, not parked', () => {
        open();

        expect(screen.queryByText(/We couldn.t save your latest changes/u)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try again', hidden: true })).toBeNull();
    });

    it('Open food opens that food through the app, and the sheet stays', async () => {
        const { onOpenFood } = open();

        await userEvent.click(
            screen.getByRole('button', { name: /^Open food: .*My spice mix.*, opens in a new tab$/u }),
        );

        expect(onOpenFood).toHaveBeenCalledExactlyOnceWith('food_spice');
        expect(screen.getByRole('dialog', { name: sheetName })).toBeTruthy();
    });

    it('Publish as private moves the draft to Private and sends the draft as it now is, in one step', async () => {
        const { setValues, publish, retry } = open();

        await userEvent.click(screen.getByRole('button', { name: 'Publish as private' }));

        expect(setValues).toHaveBeenCalledWith(expect.objectContaining({ visibility: RecipeVisibility.PRIVATE }));
        expect(publish).toHaveBeenCalledOnce();
        expect(retry).not.toHaveBeenCalled();
    });

    it('Back to editor closes the sheet and sends nothing', async () => {
        const { setValues, publish, retry } = open();

        await userEvent.click(screen.getByRole('button', { name: 'Back to editor' }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: sheetName })).toBeNull());
        expect(setValues).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(retry).not.toHaveBeenCalled();
    });

    it('opens nothing without a refusal, and nothing once the refused food is out of the draft', () => {
        mount({ editorOver: { values: publicDraft() } });
        expect(screen.queryByRole('dialog', { name: sheetName })).toBeNull();
        cleanup();

        mount({
            editorOver: {
                values: makeFilledRecipeFormValues({ ingredients: [] }),
                privateFoodRefusal: refusal,
            },
        });
        expect(screen.queryByRole('dialog', { name: sheetName })).toBeNull();
    });
});

/**
 * ADDED for ADR-0089: the Source row, over a real session. Pasting steps that carry a link line sets the Source; the draft
 * is then private only (Public is refused with the web-source reason, Private is shown chosen), and the cook's own choice
 * comes back when the Source is removed. With every slot used, Publish asks about a slot with the web-source words and no
 * "Publish as public". A published recipe's Source is locked.
 */
describe('RecipeEditorSurface — the Source (ADR-0089)', () => {
    const LINK = 'https://www.allrecipes.com/recipe/1/soup/';
    const neverPublished = () =>
        makeRecipeDetail({
            id: 'rec_1',
            status: RecipeStatus.DRAFT,
            visibility: RecipeVisibility.PUBLIC,
            cuisine: 'Italian',
        });

    const section = () =>
        screen.getByRole('heading', { level: 2, name: 'Photos & publish' }).closest('section') as HTMLElement;
    const sourceField = () => within(section()).getByRole<HTMLInputElement>('textbox', { name: 'Source' });

    async function pasteSteps(text: string) {
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Paste steps' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Steps' }), { target: { value: text } });
        await user.click(screen.getByRole('button', { name: /^Add \d+ steps?$/u }));

        return user;
    }

    it('sits in Photos & publish, after the photos and before "Who can see it"', () => {
        mount({ seed: { recipe: neverPublished() } });

        const photos = within(section()).getByText('photo uploader');
        const legend = within(section()).getByText('Who can see it');

        expect(photos.compareDocumentPosition(sourceField()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(sourceField().compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('pasted steps with a link: the link is the Source, not a step, and the recipe becomes private only', async () => {
        mount({ seed: { recipe: neverPublished() } });

        await pasteSteps(`Boil the water.\n${LINK}`);

        expect(sourceField().value).toBe(LINK);
        expect(screen.getByText('Copied from a public web page · allrecipes.com')).toBeTruthy();
        // Said once to a screen reader (the live region) and shown once under the paste control that was used.
        expect(screen.getAllByText('Source set to allrecipes.com. This recipe will be private.')).toHaveLength(2);
        expect(screen.queryByDisplayValue(LINK, { exact: true })).toBe(sourceField());

        const publicCard = within(section()).getByRole('radio', { name: /^public/i });

        expect(publicCard.getAttribute('aria-disabled')).toBe('true');
        expect(within(section()).getByText(/copied from a web page, and its author owns the writing/u)).toBeTruthy();
        expect(within(section()).getByRole<HTMLInputElement>('radio', { name: /^private/i }).checked).toBe(true);
    });

    it('Remove puts the cook’s own choice back and returns focus to the empty field', async () => {
        mount({ seed: { recipe: neverPublished() } });
        const user = await pasteSteps(`Boil the water.\n${LINK}`);

        await user.click(screen.getByRole('button', { name: 'Remove source' }));

        expect(sourceField().value).toBe('');
        expect(document.activeElement).toBe(sourceField());
        expect(
            within(section())
                .getByRole('radio', { name: /^public/i })
                .getAttribute('aria-disabled'),
        ).not.toBe('true');
        expect(within(section()).getByRole<HTMLInputElement>('radio', { name: /^public/i }).checked).toBe(true);
    });

    it('a link typed into the field has the same effect as a pasted one', async () => {
        mount({ seed: { recipe: neverPublished() } });
        const user = userEvent.setup();

        await user.click(sourceField());
        await user.paste(LINK);

        expect(screen.getByText('Copied from a public web page · allrecipes.com')).toBeTruthy();
        expect(
            within(section())
                .getByRole('radio', { name: /^public/i })
                .getAttribute('aria-disabled'),
        ).toBe('true');
    });

    it('with every slot used, Publish asks with the web-source words and offers no Publish as public', async () => {
        // A stored never-published web copy: the draft opens with its link, and Publish was refused for want of a slot.
        mount({
            seed: {
                recipe: makeRecipeDetail({
                    id: 'rec_1',
                    status: RecipeStatus.DRAFT,
                    visibility: RecipeVisibility.PRIVATE,
                    sourceType: 'imported_public',
                    sourceKind: 'public_web',
                    sourceUrl: LINK,
                    cuisine: 'Italian',
                }),
            },
            publishBlocked: { ask: { kind: 'noSlot', total: 50 }, keepAsDraft: vi.fn(), publishAsPublic: vi.fn() },
        });

        const dialog = await screen.findByRole('dialog', { name: 'Your private slots are full' });

        expect(within(dialog).getByText(/A recipe copied from a web page can only be private/u)).toBeTruthy();
        expect(within(dialog).queryByRole('button', { name: 'Publish as public' })).toBeNull();
        expect(within(dialog).getByRole('button', { name: 'Keep as draft' })).toBeTruthy();
    });

    it('without a Source the same ask still offers Publish as public', async () => {
        mount({
            seed: { recipe: neverPublished() },
            publishBlocked: { ask: { kind: 'noSlot', total: 50 }, keepAsDraft: vi.fn(), publishAsPublic: vi.fn() },
        });

        const dialog = await screen.findByRole('dialog', { name: 'Your private slots are full' });

        expect(within(dialog).getByRole('button', { name: 'Publish as public' })).toBeTruthy();
    });

    it('a published web copy: the Source is read only, with the site as a link', () => {
        mount({
            seed: {
                recipe: makeRecipeDetail({
                    id: 'rec_1',
                    status: RecipeStatus.PUBLISHED,
                    firstPublishedAt: '2026-11-01T00:00:00.000Z',
                    visibility: RecipeVisibility.PRIVATE,
                    sourceType: 'imported_public',
                    sourceKind: 'public_web',
                    sourceUrl: LINK,
                    cuisine: 'Italian',
                }),
            },
        });

        expect(within(section()).queryByRole('textbox', { name: 'Source' })).toBeNull();
        expect(
            within(section()).getByRole('link', { name: 'allrecipes.com (opens in a new tab)' }).getAttribute('href'),
        ).toBe(LINK);
        expect(within(section()).getByText('The source can’t be changed after publishing.')).toBeTruthy();
    });
    const stepsSection = () =>
        screen.getByRole('heading', { level: 2, name: 'Steps' }).closest('section') as HTMLElement;

    it('a sighted cook sees the notice under Paste steps, with a Remove that keeps focus on the paste button', async () => {
        mount({ seed: { recipe: neverPublished() } });
        const user = await pasteSteps(`Boil the water.\n${LINK}`);

        const caption = within(stepsSection()).getByText('Source set to allrecipes.com. This recipe will be private.');

        expect(caption).toBeTruthy();

        await user.click(within(stepsSection()).getByRole('button', { name: 'Remove' }));

        expect(sourceField().value).toBe('');
        expect(within(stepsSection()).queryByText(/Source set to/u)).toBeNull();
        // Focus is where the cook was: on the paste control, not in a field they were not using.
        expect(document.activeElement).toBe(within(stepsSection()).getByRole('button', { name: 'Paste steps' }));
    });

    it('the row’s own Remove still lands the cook in the empty Source field', async () => {
        mount({ seed: { recipe: neverPublished() } });
        const user = await pasteSteps(`Boil the water.\n${LINK}`);

        await user.click(within(section()).getByRole('button', { name: 'Remove source' }));

        expect(document.activeElement).toBe(sourceField());
    });

    it('a locked source says so under Paste steps when a link is pasted, and offers no Remove', async () => {
        mount({
            seed: {
                recipe: makeRecipeDetail({
                    id: 'rec_1',
                    status: RecipeStatus.PUBLISHED,
                    firstPublishedAt: '2026-11-01T00:00:00.000Z',
                    visibility: RecipeVisibility.PRIVATE,
                    sourceType: 'imported_public',
                    sourceKind: 'public_web',
                    sourceUrl: LINK,
                    cuisine: 'Italian',
                }),
            },
        });

        await pasteSteps(`Boil the water.\nhttps://www.bbcgoodfood.com/recipes/soup`);

        expect(
            within(stepsSection()).getByText(
                'Left out the link. A published recipe’s source can’t be added or changed.',
            ),
        ).toBeTruthy();
        expect(within(stepsSection()).queryByRole('button', { name: 'Remove' })).toBeNull();
    });

    it('a half-typed address is no error while the cook types, and is one when they leave the field', async () => {
        mount({ seed: { recipe: neverPublished() } });
        const user = userEvent.setup();

        await user.click(sourceField());
        await user.paste('https://exa');

        expect(within(section()).queryByText(/That isn’t a web link/u)).toBeNull();

        await user.tab();

        expect(within(section()).getByText(/That isn’t a web link/u)).toBeTruthy();
    });
});
