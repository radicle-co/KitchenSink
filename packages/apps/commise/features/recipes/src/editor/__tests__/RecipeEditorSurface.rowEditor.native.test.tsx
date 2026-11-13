// @vitest-environment jsdom
/**
 * The phone row editor sheet over the REAL editor session (native leaves): the device sequence an Android run lost an
 * edit on (2026-11-10). The cook opens a line, clears "Name on the recipe", the editor's idle checkpoint writes and the
 * server answers, and then the cook types a new name. The sheet must stay open, keep the typed text, and the draft must
 * hold it.
 *
 * Only this tier holds the app-side routes that could close the sheet without the cook: the row editor's open line is
 * dropped when its key leaves the draft (`useLineEditorState`), the sheet draws only while its row is in the drawn rows
 * (`RecipeIngredientsFields.native.tsx`), and a checkpoint's answer moves the server facts under both. It fails if a
 * write's answer re-keys the draft's lines. It did not reproduce the device loss, so what closed the sheet there is
 * outside jsdom's reach (key events, focus).
 */
import { LocaleProvider } from '@commise/i18n/react';
import { makeQuietFoodClient, dialogTitled, queryDialogTitled } from '@commise/test-utils';
import { BackInterceptProvider } from '@commise/ui/back-intercept';
import { render } from '@commise/ui/testing/tamagui';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeStatus } from '@kitchensink/recipe-core';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, screen, within } from '@testing-library/react';
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
import { editorMessages } from '../messages.js';
import { RecipeEditorSurface } from '../RecipeEditorSurface.js';
import { useRecipeEditorSession } from '../useRecipeEditorSession.js';

vi.mock('../../layout/useMainContainerClass.native.js', () => ({ useMainContainerClass: () => 'narrow' }));
// The row panel's food search is not what this suite is about.
vi.mock('../../hooks/ingredientSuggestionSource.js', () => ({
    useIngredientSuggestionSource: () => ({
        read: { kind: 'asking', resumed: false, answer: { database: undefined, sources: [], complete: false } },
        refetch: () => undefined,
    }),
}));
// react-native-web does not implement `sendAccessibilityEvent`, which the sheets call to move the screen-reader cursor.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() } };
});

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
            leaveAsk="byNavigator"
        />
    );
}

function mount(arrival?: EditorArrival) {
    const port = makeFakeEditorWritePort();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
        <LocaleProvider locale="en">
            <QueryClientProvider client={queryClient}>
                <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
                    <FoodServiceProvider client={makeQuietFoodClient()} subject="user_cook">
                        <BackInterceptProvider onUnhandled={() => false}>
                            <Harness
                                seed={{ recipe: STORED }}
                                port={port}
                                {...(arrival === undefined ? {} : { arrival })}
                            />
                        </BackInterceptProvider>
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

describe('the phone row editor sheet, over the real editor session (native)', () => {
    // The device flow taps the label text, and its typed text landed nowhere: the label must hand focus to its field.
    it('pressing the "Name on the recipe" label focuses the Name field', () => {
        mount();

        fireEvent.click(screen.getByRole('button', { name: /^Edit 2 tbsp chili oil/u }));
        expect(document.activeElement).not.toBe(nameField());
        fireEvent.click(within(dialogTitled('chili oil')).getByText(en.rowDisplayTextLabel));

        expect(document.activeElement).toBe(nameField());
    });

    // REWRITTEN (needs-review, row edit hold): this case used to prove the sheet survived an idle checkpoint's answer
    // arriving while it was open. A row editor now HOLDS the draft's server checkpoints (`rowEditHold.ts`), so the idle
    // pause sends nothing while the sheet is open, and the checkpoint it deferred runs once, at Done. The typed name must
    // still survive the pause, the keystrokes and the close.
    it('stays open and keeps a new name typed after the name was cleared and the idle pause passed', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { port } = mount();

        fireEvent.click(screen.getByRole('button', { name: /^Edit 2 tbsp chili oil/u }));
        fireEvent.change(nameField(), { target: { value: '' } });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(SERVER_CHECKPOINT_IDLE_MS + 100);
        });
        expect(port.submitted).toHaveLength(0);

        // Typed one key at a time, as a device delivers it.
        for (const typed of ['c', 'cr', 'crushed', 'crushed ', 'crushed tomatoes']) {
            fireEvent.change(nameField(), { target: { value: typed } });
        }

        expect(queryDialogTitled(/crushed tomatoes/u)).not.toBeNull();
        expect(nameField().value).toBe('crushed tomatoes');
        // The draft holds it: Done closes the sheet on a row that reads the new name, and the held checkpoint goes out.
        fireEvent.click(within(dialogTitled('crushed tomatoes')).getByRole('button', { name: en.rowDone }));
        expect(screen.getByRole('button', { name: /^Edit 2 tbsp crushed tomatoes/u })).toBeTruthy();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10);
        });
        expect(port.submitted.length).toBeGreaterThan(0);
    });
});

/**
 * Arriving from a link (the native `line` route param): the Surface resolves the address ONCE against the editor's own
 * keys, over the real session. A good address opens that row's sheet, a stale one opens nothing and says so, and the
 * sentence goes once the cook opens a row.
 */
describe('arriving at a line from a link, over the real editor session (native)', () => {
    const missing = editorMessages.en.ingredients.jumpLineMissing;

    it('opens the sheet of the addressed row', () => {
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

    it('clears the sentence once the cook opens any row', () => {
        mount({ section: 'ingredients', line: { version: 9, position: 0 } });
        expect(screen.getByText(missing)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /^Edit 2 tbsp chili oil/u }));

        expect(screen.queryByText(missing)).toBeNull();
    });
});
