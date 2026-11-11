// @vitest-environment jsdom
/**
 * The phone row editor sheet over the REAL editor session (web leaves): the web mirror of
 * `RecipeEditorSurface.rowEditor.native.test.tsx`, for the device sequence an Android run lost an edit on (2026-11-10).
 * The cook opens a line, clears "Name on the recipe", the editor's idle checkpoint writes and the server answers, and
 * then the cook types a new name. The sheet must stay open, keep the typed text, and the draft must hold it.
 *
 * Only this tier holds every route that can close the sheet without the cook: the row editor's open line is dropped
 * when its key leaves the draft (`useLineEditorState`), the sheet draws only while its row is in the drawn rows
 * (`RecipeIngredientsFields.tsx`), and a checkpoint's answer moves the server facts under both. It fails if a write's
 * answer re-keys the draft's lines.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { makeQuietFoodClient, dialogTitled, queryDialogTitled } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { FoodResolutionStatus, RecipeStatus } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRecipePrivate } from '../../actions/useRecipePrivate.js';
import { makeFakeEditorWritePort } from '../../__fixtures__/editorWritePort.js';
import { makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { recipeFormMessages } from '../../form/messages.js';
import type { EditorSeed } from '../../hooks/useRecipeEditor.js';
import { SERVER_CHECKPOINT_IDLE_MS } from '../checkpointPolicy.js';
import type { DraftStore } from '../draftStore.js';
import type { EditorArrival } from '../editorArrival.js';
import { toRecipeFormValues } from '../../form/wire.js';
import { editorMessages } from '../messages.js';
import { RecipeEditorSurface } from '../RecipeEditorSurface.js';
import { useRecipeEditorSession } from '../useRecipeEditorSession.js';

vi.mock('../../layout/useMainContainerClass.js', () => ({ useMainContainerClass: () => 'narrow' }));
// The row panel's food search is not what this suite is about.
vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

const en = recipeFormMessages.en;

const NO_DRAFTS: DraftStore = {
    load: async () => undefined,
    save: async () => undefined,
    discard: async () => undefined,
    adopt: async () => undefined,
    clear: async () => undefined,
};

const STORED = makeRecipeDetail({
    id: 'rec_9',
    currentVersion: 1,
    status: RecipeStatus.DRAFT,
    cuisine: 'Italian',
    ingredients: [
        makeIngredientView({
            name: 'Smoked Chili Oil',
            displayText: 'chili oil',
            quantity: { kind: 'exact', value: 2 },
            unit: 'tbsp',
        }),
    ],
});

function Harness({
    seed,
    port,
    arrival,
}: {
    seed: EditorSeed;
    port: ReturnType<typeof makeFakeEditorWritePort>;
    arrival?: EditorArrival;
}): ReactElement {
    // What the app's container does: the rule, the slot standing and the known refusal, from one hook.
    const recipePrivate = useRecipePrivate({
        sourceType: seed.recipe?.sourceType,
        sourceKind: seed.recipe?.sourceKind ?? null,
        knownPaidFeatures: 'granted',
    });
    const session = useRecipeEditorSession({
        seed,
        locale: 'en',
        keep: 'disk',
        port,
        drafts: NO_DRAFTS,
        navigation: { finished: vi.fn(), leftForRecipe: vi.fn(), discarded: vi.fn() },
        reportError: vi.fn(),
        openPaste: false,
        privateRefusal: recipePrivate.refusal,
    });

    return (
        <RecipeEditorSurface
            session={session}
            seed={seed}
            mode="edit"
            keep="disk"
            paidFeatures="granted"
            knownPaidFeatures="granted"
            slotStanding={recipePrivate.standing}
            renderPhotos={() => null}
            {...(arrival === undefined ? {} : { arrival })}
            onClose={vi.fn()}
            onOpenMyRecipes={vi.fn()}
            leaveAsk="inPage"
        />
    );
}

function mount(arrival?: EditorArrival, recipe: EditorSeed['recipe'] = STORED, memento?: EditorSeed['memento']) {
    const port = makeFakeEditorWritePort();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
        <LocaleProvider locale="en">
            <QueryClientProvider client={queryClient}>
                <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
                    <FoodServiceProvider client={makeQuietFoodClient()} subject="user_cook">
                        <Harness
                            seed={{ recipe, ...(memento === undefined ? {} : { memento }) }}
                            port={port}
                            {...(arrival === undefined ? {} : { arrival })}
                        />
                    </FoodServiceProvider>
                </RecipeServiceProvider>
            </QueryClientProvider>
        </LocaleProvider>,
    );

    return { port };
}

const nameField = (): HTMLInputElement =>
    within(dialogTitled(/^(chili oil|Smoked Chili Oil|c.*)$/u)).getByLabelText(
        en.rowDisplayTextLabel,
    ) as HTMLInputElement;

describe('the phone row editor sheet, over the real editor session (web)', () => {
    it('stays open and keeps a new name typed after the name was cleared and a checkpoint was answered', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { port } = mount();

        fireEvent.click(screen.getByRole('button', { name: /^Edit 2 tbsp chili oil/u }));
        fireEvent.change(nameField(), { target: { value: '' } });

        // The idle checkpoint writes, and the server answers with the next version.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(SERVER_CHECKPOINT_IDLE_MS + 100);
        });
        expect(port.submitted.length).toBeGreaterThan(0);
        act(() => {
            port.sync(port.lastSeq(), { ...STORED, currentVersion: 2 });
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });

        // Typed one key at a time, as a device delivers it.
        for (const typed of ['c', 'cr', 'crushed', 'crushed ', 'crushed tomatoes']) {
            fireEvent.change(nameField(), { target: { value: typed } });
        }

        expect(queryDialogTitled(/crushed tomatoes/u)).not.toBeNull();
        expect(nameField().value).toBe('crushed tomatoes');
        // The draft holds it: Done closes the sheet on a row that reads the new name.
        fireEvent.click(within(dialogTitled('crushed tomatoes')).getByRole('button', { name: en.rowDone }));
        expect(screen.getByRole('button', { name: /^Edit 2 tbsp crushed tomatoes/u })).toBeTruthy();
    });
});

/**
 * Arriving from a link (`#ingredients/{version}.{position}`, or the native `line` param): the Surface resolves the
 * address ONCE against the editor's own keys. This tier proves it over the real session, where the keys come from the
 * server read: a good address opens that row's editor, a stale one opens nothing and says so, and the sentence goes
 * once the cook opens a row.
 */
describe('arriving at a line from a link, over the real editor session (web)', () => {
    const missing = editorMessages.en.ingredients.jumpLineMissing;

    it('opens the editor of the addressed row', () => {
        mount({ section: 'ingredients', line: { version: 1, position: 0 } });

        expect(queryDialogTitled(/chili oil/u)).not.toBeNull();
        expect(screen.queryByText(missing)).toBeNull();
    });

    it.each([
        ['a version the editor was not seeded at', { version: 7, position: 0 }],
        ['a position past the end', { version: 1, position: 5 }],
    ])('says so and opens nothing for %s', (_name, line) => {
        mount({ section: 'ingredients', line });

        expect(queryDialogTitled(/chili oil/u)).toBeNull();
        expect(screen.getByText(missing)).toBeTruthy();
    });

    it('says so when the address names a line the resumed draft no longer holds', () => {
        // The draft was seeded at version 1, where position 0 is a real key, but the cook deleted that line since.
        const memento = {
            recipeRef: 'rec_9',
            baseVersion: 1,
            values: { ...toRecipeFormValues(STORED), ingredients: [] },
            pendingRebinds: [],
            savedAt: '2026-11-11T00:00:00.000Z',
        };

        mount({ section: 'ingredients', line: { version: 1, position: 0 } }, STORED, memento);

        expect(screen.getByText(missing)).toBeTruthy();
    });

    it('says nothing when the link names a section only', () => {
        mount({ section: 'ingredients' });

        expect(screen.queryByText(missing)).toBeNull();
        expect(queryDialogTitled(/chili oil/u)).toBeNull();
    });

    it('clears the sentence once the cook opens any row', () => {
        mount({ section: 'ingredients', line: { version: 9, position: 0 } });
        expect(screen.getByText(missing)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /^Edit 2 tbsp chili oil/u }));

        expect(screen.queryByText(missing)).toBeNull();
    });

    it('shows the cook’s original line for a needs-review line, from the server read and not the draft', () => {
        const review = makeRecipeDetail({
            id: 'rec_9',
            currentVersion: 1,
            status: RecipeStatus.DRAFT,
            cuisine: 'Italian',
            ingredients: [
                {
                    ...makeIngredientView({
                        name: 'Smoked Chili Oil',
                        displayText: 'chili oil',
                        resolutionStatus: FoodResolutionStatus.NEEDS_REVIEW,
                    }),
                    sourceLine: '2 tbsp chilli oil, the good stuff',
                },
            ],
        });

        mount({ section: 'ingredients', line: { version: 1, position: 0 } }, review);
        const sheet = dialogTitled(/chili oil/u);

        expect(within(sheet).getByText(en.statusExplainNeedsReview)).toBeTruthy();
        expect(within(sheet).getByText('2 tbsp chilli oil, the good stuff')).toBeTruthy();
    });
});
