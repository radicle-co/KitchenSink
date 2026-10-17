// @vitest-environment jsdom
/**
 * {@link RecipeEditorSurface} — what both apps' editor screens mount over a session (UI audit 10: the web
 * `RecipeEditorContainer` and the native `RecipeEditorScreen` each built the same `sections` map, heading actions and
 * the three trailing sheets).
 *
 * What is pinned: the section map holds each section's real leaves; a pending ingredient line gets ONE status poller;
 * the photos section asks the app for its uploader only once the recipe exists on the server (the upload takes a recipe
 * id, and a picked photo's bytes cannot live in the device draft, ADR-0057); Private is offered from the viewer's paid
 * features alone (E1, plan 2026-10-14-009 D14); the app's close and "My recipes" hand-offs are the ones the view calls.
 * Real hooks over the type-checked fake client, as `useRecipeEditorSession.test.tsx` has them.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { makeQuietFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PaidFeatureState } from '@commise/features-account';

import { makeFakeEditorWritePort } from '../../__fixtures__/editorWritePort.js';
import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeFormMessages } from '../../form/messages.js';
import type { EditorSeed } from '../../hooks/useRecipeEditor.js';
import type { DraftStore } from '../draftStore.js';
import { RecipeEditorSurface } from '../RecipeEditorSurface.js';
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
    readonly renderPhotos: (recipe: { recipeId: string; title: string; cuisine: string }) => ReactNode;
    readonly onClose: () => void;
    readonly onOpenMyRecipes: () => void;
}

/** The surface over a real session, as an app's container mounts it. */
function Harness(props: HarnessProps): ReactElement {
    const { seed, paidFeatures, knownPaidFeatures, renderPhotos, onClose, onOpenMyRecipes } = props;
    const session = useRecipeEditorSession({
        seed,
        locale: 'en',
        keep: 'disk',
        port: makeFakeEditorWritePort(),
        drafts: NO_DRAFTS,
        navigation: { finished: vi.fn(), leftForRecipe: vi.fn(), discarded: vi.fn() },
        reportError: vi.fn(),
        openPaste: false,
        knownPaidFeatures,
    });

    return (
        <RecipeEditorSurface
            session={session}
            seed={seed}
            mode={seed.recipe === undefined ? 'create' : 'edit'}
            keep="disk"
            paidFeatures={paidFeatures}
            knownPaidFeatures={knownPaidFeatures}
            renderPhotos={renderPhotos}
            onClose={onClose}
            onOpenMyRecipes={onOpenMyRecipes}
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

describe('RecipeEditorSurface — photos', () => {
    it('asks for no uploader while the recipe does not exist on the server', () => {
        const renderPhotos = vi.fn(() => <p>photo uploader</p>);

        mount({ renderPhotos });

        expect(renderPhotos).not.toHaveBeenCalled();
        expect(screen.queryByText('photo uploader')).toBeNull();
    });

    it('asks for the uploader with the recipe id, title and cuisine once it does', () => {
        const renderPhotos = vi.fn(() => <p>photo uploader</p>);
        const recipe = makeRecipeDetail({ id: 'rec_1', title: 'Soup', cuisine: 'Italian' });

        mount({ seed: { recipe }, renderPhotos });

        expect(renderPhotos).toHaveBeenCalledWith({ recipeId: 'rec_1', title: 'Soup', cuisine: 'Italian' });
        expect(screen.getByText('photo uploader')).toBeTruthy();
    });
});

describe('RecipeEditorSurface — the Private choice', () => {
    it('offers Private to a viewer whose paid features grant it', () => {
        mount({ paidFeatures: 'granted', knownPaidFeatures: 'granted' });

        expect(screen.getByRole('radio', { name: /private/i })).toBeTruthy();
    });

    it('offers no Private choice to a viewer whose paid features hide it', () => {
        mount({ paidFeatures: 'hidden', knownPaidFeatures: 'hidden' });

        expect(screen.queryByRole('radio', { name: /private/i })).toBeNull();
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
