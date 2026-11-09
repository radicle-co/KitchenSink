/**
 * What a native ingredient row shows on the recipe page (design answers 2026-11-08, "the cook's own words"): the twin of
 * `ingredientWords.test.tsx`. react-native-web under jsdom. Seen red first.
 */
import { renderWithTamagui } from '@commise/ui/testing/tamagui';
import { guardedFoodClient } from '@commise/test-utils';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { RecipeServiceProvider } from '@kitchensink/recipe-service-client/hooks';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import type { FC, ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';

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

const NBSP = '\u00A0';
const rowOf = (name: RegExp): HTMLElement => screen.getByRole('checkbox', { name });

const rowsOf = (...lines: Parameters<typeof makeIngredientView>[0][]): ReactElement => (
    <RecipeDetailView
        unreachableRetry={idleUnreachableRetry}
        recipe={makeRecipeDetail({ ingredients: lines.map((line) => makeIngredientView(line)) })}
        onEditSection={vi.fn()}
    />
);

describe('an ingredient row shows the cook’s words (native)', () => {
    it('shows displayText when it is set, and not the food’s name', () => {
        render(rowsOf({ name: 'Pork sausage', displayText: 'sweet Italian sausage', unit: 'lb' }));

        const row = screen.getByRole('checkbox', { name: /sweet Italian sausage/u });

        expect(row.textContent).toContain('sweet Italian sausage');
        expect(row.textContent).not.toContain('Pork sausage');
    });

    it('shows the food’s name when displayText is NULL', () => {
        render(rowsOf({ name: 'Pork sausage', unit: 'lb' }));

        expect(rowOf(/Pork sausage/u).textContent).toContain('Pork sausage');
    });

    it('puts the note first in the muted tail, then the preparation, and never in parentheses', () => {
        render(rowsOf({ name: 'pie crust', unit: '', note: '9 inch', preparation: 'unbaked' }));

        const row = rowOf(/pie crust/u);
        const text = row.textContent ?? '';

        expect(text).not.toContain('(');
        expect(text.indexOf(`9${NBSP}inch`)).toBeGreaterThan(text.indexOf('pie crust'));
        expect(text.indexOf('unbaked')).toBeGreaterThan(text.indexOf(`9${NBSP}inch`));
        // Each tail word is joined by a no-break space and a middle dot: "pie crust · 9 inch · unbaked".
        expect(text).toContain(`${NBSP}· 9${NBSP}inch${NBSP}· unbaked`);
        expect(row.getAttribute('aria-label')).toMatch(/pie crust, 9\s+inch, unbaked$/u);
    });

    it('a package size stays in the amount as the cook wrote it', () => {
        render(rowsOf({ name: 'crushed tomatoes', unit: '(28 ounce) can', quantity: { kind: 'exact', value: 1 } }));

        const row = rowOf(/crushed tomatoes/u);

        expect(row.textContent).toContain('(28 ounce) can');
        expect(row.textContent).not.toMatch(/crushed tomatoes.*\(28/u);
    });
});
