/**
 * U14 — THE CORRECTION AFFORDANCE on the web ingredient picker (plan U14 / R19, R20), every state.
 *
 * ## What this suite is really guarding
 *
 * U10 shipped a curated-mapping write path that NOTHING could reach: no route, no client method, no control.
 * A knowledge base with a writer and no caller never learns, so the learning loop never fires. This is the
 * control that closes it, and the three properties below are the ones a regression would quietly break:
 *
 *  1. ⛔ **The phrase sent is the one the user TYPED**, never the resolved ingredient's name. A curated
 *     mapping is only ever consulted under the key the cascade looks up, and that key comes from the phrase
 *     `addByName` received. A control that sent the catalog's rendering of the food would write rows the
 *     cascade never queries — a feature that appears to work, teaches nothing, and fails silently forever.
 *  2. ⛔ **The REACH is reported, and the two reaches read differently.** A correction binds a phrase either
 *     for its author or for every user of the installation; which one happened is decided server-side from
 *     signed grants the client cannot read. One sentence for both would tell a curator they had made a
 *     private note when they had rewritten what that phrase means for everyone.
 *  3. ⚠️ **"Nothing was written" is a SUCCESS, not an error.** Re-asserting a binding already in force is
 *     idempotent by design (it must not mint a churn row and inflate the corroboration count that decides
 *     promotion), so it renders as a neutral `status`, never an `alert`.
 *
 * Driven through the REAL `useIngredientResolver` + `useIngredientCorrection` and a real, network-guarded
 * `RecipeServiceClient` stubbed with type-checked `vi.spyOn` — the same seam the sibling picker suite uses.
 * Queries are role/label only.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ingredient } from '@kitchensink/recipe-core';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import type { IngredientSuggestion, IngredientSuggestions } from '@kitchensink/recipe-service-client';
import type { RecordCorrectionResponse } from '@kitchensink/schema-recipe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recipeCorrectionMessages } from '@commise/features-recipes';
import { renderWithRecipeClient } from '@commise/test-utils';

import { IngredientPicker } from '@/components/recipes/IngredientPicker';

import { makeIngredient } from './__fixtures__/ingredientFixtures';

const m = recipeCorrectionMessages.en;

/** The phrase the cook types — deliberately NOT the name of either suggestion below. */
const PHRASE = 'plain flour';

/** The food the cook says the phrase should mean. */
const RIGHT_FOOD = '01JU14RIGHTFOOD0000000001';

/**
 * A catalog suggestion: always food-backed, so always correctable.
 *
 * Typed as the NARROWED member rather than the `IngredientSuggestion` union so `catalogRow.name` resolves —
 * a `local` suggestion carries its name one level in, on `.ingredient`.
 */
const catalogRow: Extract<IngredientSuggestion, { provenance: 'catalog' }> = {
    provenance: 'catalog',
    foodId: RIGHT_FOOD,
    name: 'Wheat flour, white, all-purpose',
    score: 0.9,
};

/** One of the caller's own rows, food-backed. */
const ownFoodBacked: Ingredient = makeIngredient({
    id: '00000000-0000-4000-8000-0000000000f1',
    name: 'Bread flour',
    foodId: '01JU14WRONGFOOD000000001',
});

/** One of the caller's own rows with NO food behind it — a freeform ingredient. */
const ownFreeform: Ingredient = makeIngredient({
    id: '00000000-0000-4000-8000-0000000000f2',
    name: 'Grandma’s flour blend',
    isUserEntered: true,
    // ⛔ Both cleared EXPLICITLY. `makeIngredient` defaults to a resolved, FOOD-BACKED item, so a fixture
    // that only flips `isUserEntered` still carries a `foodId` — and would then be offered the very control
    // this case asserts is absent, passing for the wrong reason if the control keyed on `isUserEntered`.
    foodId: undefined,
    foodResolutionStatus: undefined,
});

/** The `GET /api/v1/ingredients/suggest` envelope the picker consumes. */
const blended = (suggestions: readonly IngredientSuggestion[]): IngredientSuggestions => ({
    suggestions,
    catalogAvailability: 'ok',
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

/** Mount the picker, stub the typeahead with `suggestions`, and type {@link PHRASE} into it. */
async function typeQuery(
    suggestions: readonly IngredientSuggestion[],
): Promise<ReturnType<typeof createFakeRecipeServiceClient>> {
    const client = createFakeRecipeServiceClient();

    vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended(suggestions));
    renderWithRecipeClient(<IngredientPicker onSelect={vi.fn()} />, client);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), PHRASE);

    return client;
}

/** The correction control for the row whose pick-button is named `name`. */
const correctionControlFor = async (name: string): Promise<HTMLElement> =>
    within((await screen.findByRole('button', { name })).closest('li') ?? document.body).getByRole('button', {
        name: m.teachAction.replace('{phrase}', PHRASE),
    });

describe('the correction control — who can be taught, and with which phrase', () => {
    it('offers the control on a food-backed CATALOG suggestion', async () => {
        await typeQuery([catalogRow]);

        expect(await correctionControlFor(catalogRow.name)).toBeInTheDocument();
    });

    it('offers it on one of the caller’s OWN rows when that row is food-backed', async () => {
        await typeQuery([{ provenance: 'local', ingredient: ownFoodBacked }]);

        expect(await correctionControlFor(ownFoodBacked.name)).toBeInTheDocument();
    });

    // ⛔ A mapping's `food_id` is the whole content of the row. A freeform ingredient has no food behind it,
    // so there is nothing a correction could bind the phrase TO — offering the control would produce either a
    // request that cannot be built or a mapping pointing at nothing.
    it('⛔ does NOT offer it on a freeform row, which has no food to bind the phrase to', async () => {
        await typeQuery([{ provenance: 'local', ingredient: ownFreeform }]);

        const row = (await screen.findByRole('button', { name: ownFreeform.name })).closest('li');

        expect(
            within(row ?? document.body).queryByRole('button', {
                name: m.teachAction.replace('{phrase}', PHRASE),
            }),
        ).not.toBeInTheDocument();
    });

    // ⛔ THE CENTRAL ASSERTION OF THIS FILE. See property 1 in the module docstring.
    it('⛔ sends the phrase the user TYPED, the picked food, and this surfacing — never the food’s name', async () => {
        const client = await typeQuery([catalogRow]);
        const record = vi
            .spyOn(client, 'recordIngredientCorrection')
            .mockResolvedValue({ recorded: true, mappingId: 'm-1', scope: 'author' });

        await userEvent.click(await correctionControlFor(catalogRow.name));

        await waitFor(() =>
            expect(record).toHaveBeenCalledWith({
                phrase: PHRASE,
                foodId: RIGHT_FOOD,
                surfacing: 'ingredient_picker',
            }),
        );
        expect(record.mock.calls[0]?.[0].phrase).not.toBe(catalogRow.name);
    });

    // ⚠️ The correction is a SEPARATE intent from the pick. Teaching the resolver must not add the line —
    // otherwise a cook correcting a match silently gains an ingredient they did not ask for.
    it('does not resolve a line — teaching is not picking', async () => {
        const onSelect = vi.fn();
        const client = createFakeRecipeServiceClient();

        vi.spyOn(client, 'suggestIngredients').mockResolvedValue(blended([catalogRow]));
        vi.spyOn(client, 'recordIngredientCorrection').mockResolvedValue({
            recorded: true,
            mappingId: 'm-1',
            scope: 'author',
        });
        renderWithRecipeClient(<IngredientPicker onSelect={onSelect} />, client);
        await userEvent.type(screen.getByRole('searchbox', { name: 'Search ingredients' }), PHRASE);
        await userEvent.click(await correctionControlFor(catalogRow.name));

        await waitFor(() => expect(screen.getByRole('status', { name: m.regionLabel })).toBeInTheDocument());
        expect(onSelect).not.toHaveBeenCalled();
    });
});

describe('the correction control — every state it can be in', () => {
    /**
     * What the stubbed correction answers with: a wire response, a thrown error, or — when omitted — a
     * promise that never settles, which is how the in-flight state is held still for an assertion.
     */
    type CorrectionAnswer = RecordCorrectionResponse | Error;

    /** Click the control after stubbing the correction with `answer` (or a never-settling promise). */
    async function correctWith(answer?: CorrectionAnswer): Promise<void> {
        const client = await typeQuery([catalogRow]);
        const spy = vi.spyOn(client, 'recordIngredientCorrection');

        if (answer === undefined) {
            spy.mockReturnValue(new Promise(() => undefined));
        } else if (answer instanceof Error) {
            spy.mockRejectedValue(answer);
        } else {
            spy.mockResolvedValue(answer);
        }

        await userEvent.click(await correctionControlFor(catalogRow.name));
    }

    it('announces the in-flight write and DISABLES the control, so it cannot be double-submitted', async () => {
        await correctWith();

        expect(await screen.findByText(m.saving)).toBeInTheDocument();
        expect(await correctionControlFor(catalogRow.name)).toBeDisabled();
    });

    it('reports a PERSONAL binding when the server scoped it to the author', async () => {
        await correctWith({ recorded: true, mappingId: 'm-1', scope: 'author' });

        expect(await screen.findByText(m.savedForYou)).toBeInTheDocument();
    });

    // ⛔ Property 2. A curator's correction rewrites the phrase for every cook, and the copy must say so.
    it('⛔ reports a GLOBAL binding differently, so a curator is never told it was personal', async () => {
        await correctWith({ recorded: true, mappingId: 'm-1', scope: 'global' });

        expect(await screen.findByText(m.savedForEveryone)).toBeInTheDocument();
        expect(screen.queryByText(m.savedForYou)).not.toBeInTheDocument();
    });

    // ⚠️ Property 3.
    it.each([['already_in_force'] as const, ['superseded'] as const])(
        '⚠️ renders the no-op outcome %s as a neutral status, never an alert',
        async (outcome) => {
            await correctWith({ recorded: false, outcome });

            expect(await screen.findByText(m.alreadySaved)).toBeInTheDocument();
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        },
    );

    it('renders a genuine failure as an ALERT, and says the ingredient was still added', async () => {
        await correctWith(new Error('knowledge base unwritable'));

        const alert = await screen.findByRole('alert');

        expect(alert).toHaveTextContent(m.failed);
    });

    it('resting state says nothing at all — no notice before the user has corrected anything', async () => {
        await typeQuery([catalogRow]);
        await correctionControlFor(catalogRow.name);

        expect(screen.queryByText(m.saving)).not.toBeInTheDocument();
        expect(screen.queryByText(m.savedForYou)).not.toBeInTheDocument();
        expect(screen.queryByText(m.alreadySaved)).not.toBeInTheDocument();
        expect(screen.queryByText(m.failed)).not.toBeInTheDocument();
    });
});
