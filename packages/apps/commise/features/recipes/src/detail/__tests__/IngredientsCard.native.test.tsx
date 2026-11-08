/**
 * The native ingredients card, as `RecipeDetailAndroid384` draws it (`nativeBoards/buildLists.md` item 13): one paper
 * card holding the heading with "for {n}" and the stepper, the owner's Edit under the heading, group headings, and rows
 * that read "amount name note" in one flow, with a hairline between rows. react-native-web under jsdom.
 */
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';
import { guardedFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { FC, ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { recipeMessages } from '../../messages.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';

const { detail } = recipeMessages.en;

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.Dimensions.get('window'), width: 390, fontScale: 1 }),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

beforeEach(resetServingScale);
afterEach(cleanup);

/** The owner's view also mounts the ambiguity review, which reads the recipe and food clients. */
const Scope: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <QueryClientProvider client={new QueryClient()}>
        <RecipeServiceProvider client={createFakeRecipeServiceClient()}>
            <FoodServiceProvider client={guardedFoodClient()} subject="user_test">
                <CookMarksTestProvider>{children}</CookMarksTestProvider>
            </FoodServiceProvider>
        </RecipeServiceProvider>
    </QueryClientProvider>
);

const render = (ui: ReactElement) => renderWithTamagui(<Scope>{ui}</Scope>, 'light');

const recipe = makeRecipeDetail({
    servings: 4,
    ingredients: [
        makeIngredientView({
            ingredientId: 'i1',
            name: 'unsalted butter',
            quantity: { kind: 'exact', value: 3 },
            unit: 'tbsp',
            preparation: 'softened',
            groupLabel: 'Chicken',
        }),
        makeIngredientView({
            ingredientId: 'i2',
            name: 'fresh thyme',
            quantity: { kind: 'exact', value: 6 },
            unit: 'sprigs',
            groupLabel: 'Chicken',
        }),
        makeIngredientView({
            ingredientId: 'i3',
            name: 'waxy potatoes',
            quantity: { kind: 'exact', value: 800 },
            unit: 'g',
            notes: 'quartered',
            groupLabel: 'Vegetables',
        }),
    ],
});

const view = (owner = true, over = recipe): ReactElement => (
    <RecipeDetailView
        unreachableRetry={idleUnreachableRetry}
        recipe={over}
        onEditSection={vi.fn()}
        {...(owner ? { viewerIsOwner: true } : {})}
    />
);

const heading = (): HTMLElement => screen.getByRole('heading', { name: detail.ingredientsHeading });
const rowOf = (name: RegExp): HTMLElement => screen.getByRole('checkbox', { name });

/** The nearest ancestor of `node` painted `paper`: the card. */
function cardAround(node: HTMLElement): HTMLElement | null {
    for (let el = node.parentElement; el !== null; el = el.parentElement) {
        // Past the page's own root there is no Tamagui theme to resolve a colour in: the card was not found.
        if (el === document.body) {
            return null;
        }

        if (resolvedColour(el, 'backgroundColor') === rgb(rolesFor('light').paper)) {
            return el;
        }
    }

    return null;
}

const follows = (earlier: Element, later: Element): boolean =>
    Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the ingredients card (native)', () => {
    it('holds the heading and every row in one paper card with the large radius', () => {
        render(view());

        const card = cardAround(heading());

        expect(card).not.toBeNull();
        expect(card?.contains(rowOf(/waxy potatoes/u))).toBe(true);
        expect(resolvedStyle(card as HTMLElement, 'borderRadius')).toBe(`${String(nativeTokens.radius.lg)}px`);
    });

    it('reads "for {n}" and then the servings stepper after the heading', () => {
        render(view());

        const forCount = screen.getByText('for 4');
        const stepper = screen.getByRole('group', { name: detail.servingsAdjustLabel });

        expect(follows(heading(), forCount)).toBe(true);
        expect(follows(forCount, stepper)).toBe(true);
    });

    it('puts the owner’s Edit under the heading row, before the first group', () => {
        render(view());

        const edit = screen.getByRole('button', { name: detail.editIngredientsLabel });

        expect(follows(screen.getByRole('group', { name: detail.servingsAdjustLabel }), edit)).toBe(true);
        expect(heading().parentElement?.contains(edit)).toBe(false);
        expect(follows(edit, screen.getByText('Chicken'))).toBe(true);
    });

    it('offers another cook no Edit', () => {
        render(view(false));

        expect(screen.queryByRole('button', { name: detail.editIngredientsLabel })).toBeNull();
    });

    it('draws a hairline between the rows of a group, and none above its first row', () => {
        render(view());

        const dividerBefore = (row: HTMLElement): boolean =>
            row.previousElementSibling?.getAttribute('name') === 'IngredientRowDivider';

        expect(dividerBefore(rowOf(/unsalted butter/u))).toBe(false);
        expect(dividerBefore(rowOf(/fresh thyme/u))).toBe(true);
        expect(dividerBefore(rowOf(/waxy potatoes/u))).toBe(false);
        expect(document.querySelectorAll('[name="IngredientRowDivider"]')).toHaveLength(1);
    });
});

describe('an ingredient row (native)', () => {
    it('starts its hairline where its text starts: the gutter, the 18 pt box, then the gap', () => {
        render(view());

        const divider = document.querySelector('[name="IngredientRowDivider"]') as HTMLElement;
        const row = rowOf(/fresh thyme/u);
        const gutter = nativeTokens.spacing[4];

        expect(resolvedStyle(row, 'paddingLeft')).toBe(`${String(gutter)}px`);
        expect(resolvedStyle(divider, 'marginLeft')).toBe(`${String(gutter + 18 + nativeTokens.spacing[3])}px`);
    });

    it('reads amount, name and note in one flow of text', () => {
        render(view());

        const note = screen.getByText('softened');
        const line = note.parentElement as HTMLElement;

        // The note is a span inside the line's own text block, which holds the amount and the name too, and is not the row's
        // column of blocks.
        expect(line.contains(screen.getByText('3 tbsp'))).toBe(true);
        expect(line).not.toBe(rowOf(/unsalted butter/u).lastElementChild);
        expect(line.textContent).toMatch(/3\stbsp.*unsalted butter.*softened/u);
        expect(within(rowOf(/unsalted butter/u)).getByText('softened')).toBe(note);
    });

    it('reads a notes override in the same flow, muted', () => {
        render(view());

        const note = screen.getByText('quartered');

        expect(note.parentElement).not.toBe(rowOf(/waxy potatoes/u).lastElementChild);
        expect(note.parentElement?.textContent).toMatch(/800\sg.*waxy potatoes.*quartered/u);
        expect(resolvedColour(note, 'color')).toBe(rgb(rolesFor('light').inkMuted));
    });

    it('sets the line in the body role, 16 pt', () => {
        render(view());

        const line = screen.getByText('softened').parentElement as HTMLElement;

        expect(resolvedStyle(line, 'fontSize')).toBe(`${String(nativeTokens.type.body.fontSize)}px`);
    });

    it('sets the amount in the stressed figure face', () => {
        render(view());

        const amount = screen.getByText('3 tbsp');

        expect(resolvedStyle(amount, 'fontFamily')).toContain(nativeTokens.type.figureInline.fontFamily);
    });

    it('dims the whole line, amount and note, when it is checked', () => {
        render(view());

        fireEvent.click(rowOf(/unsalted butter/u));

        const muted = rgb(rolesFor('light').inkMuted);

        expect(resolvedColour(screen.getByText('3 tbsp'), 'color')).toBe(muted);
        expect(resolvedColour(screen.getByText('softened'), 'color')).toBe(muted);
    });
});

describe('the scaled caveat (native)', () => {
    it('is the caption role in ink, not a bold meta line', () => {
        render(view());
        fireEvent.click(screen.getByRole('button', { name: detail.servingsIncrease }));

        const caveat = screen.getByText(detail.scaledTimingCaveat);

        expect(resolvedStyle(caveat, 'fontFamily')).toContain(nativeTokens.type.caption.fontFamily);
        expect(resolvedStyle(caveat, 'fontSize')).toBe(`${String(nativeTokens.type.caption.fontSize)}px`);
        expect(resolvedColour(caveat, 'color')).toBe(rgb(rolesFor('light').ink));
    });
});
