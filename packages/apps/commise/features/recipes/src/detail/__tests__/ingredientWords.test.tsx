// @vitest-environment jsdom
/**
 * What an ingredient row shows on the recipe page (design answers 2026-11-08, "the cook's own words"): the cook's words
 * (`displayText`) when the line has them, else the food's name; the note ("9 inch") first in the muted tail, then the
 * preparation, never in parentheses; a package size stays in the bold amount. No second food name, badge or link.
 * Seen red first. The native twin is `ingredientWords.native.test.tsx`.
 */
import { FoodServiceClient } from '@kitchensink/food-service-client';
import { FoodServiceProvider } from '@kitchensink/food-service-client/hooks';
import { renderWithRecipeClient } from '@commise/test-utils';
import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';
import { cleanup, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { idleUnreachableRetry, makeIngredientView, makeRecipeDetail } from '../../__fixtures__/index.js';
import { DetailTestScope } from '../../__fixtures__/detailScope.js';
import { resetServingScale } from '../servingScale.js';
import { RecipeDetailView } from '../RecipeDetailView.js';

beforeEach(resetServingScale);
afterEach(cleanup);

const render = (ui: ReactElement): ReturnType<typeof renderWithRecipeClient> =>
    renderWithRecipeClient(
        <FoodServiceProvider
            client={
                new FoodServiceClient({
                    baseUrl: 'https://food.test',
                    fetch: () => Promise.reject(new Error('offline')),
                })
            }
            subject="user_test"
        >
            <DetailTestScope>{ui}</DetailTestScope>
        </FoodServiceProvider>,
        createFakeRecipeServiceClient(),
    );

const NBSP = '\u00A0';

const rowsOf = (...lines: Parameters<typeof makeIngredientView>[0][]): ReactElement => (
    <RecipeDetailView
        unreachableRetry={idleUnreachableRetry}
        recipe={makeRecipeDetail({ ingredients: lines.map((line) => makeIngredientView(line)) })}
    />
);

const rowText = (name: RegExp): string => screen.getByRole('checkbox', { name }).textContent ?? '';

describe('an ingredient row shows the cook’s words (web)', () => {
    it('shows displayText when it is set, and not the food’s name', () => {
        render(rowsOf({ name: 'Pork sausage', displayText: 'sweet Italian sausage', unit: 'lb' }));

        const row = screen.getByRole('checkbox', { name: /sweet Italian sausage/u });

        expect(row.textContent).toContain('sweet Italian sausage');
        expect(row.textContent).not.toContain('Pork sausage');
    });

    it('shows the food’s name when displayText is NULL', () => {
        render(rowsOf({ name: 'Pork sausage', unit: 'lb' }));

        expect(rowText(/Pork sausage/u)).toContain('Pork sausage');
        expect(screen.queryByText(/Counted as/u)).toBeNull();
    });

    it('puts the note first in the muted tail, then the preparation, joined by the middle dot, and never in parentheses', () => {
        render(rowsOf({ name: 'pie crust', unit: '', note: '9 inch', preparation: 'unbaked' }));

        const row = screen.getByRole('checkbox', { name: /pie crust/u });
        const text = row.textContent ?? '';

        expect(text).not.toContain('(');
        expect(text.indexOf(`9${NBSP}inch`)).toBeGreaterThan(text.indexOf('pie crust'));
        expect(text.indexOf('unbaked')).toBeGreaterThan(text.indexOf(`9${NBSP}inch`));
        expect(text).toContain('·');
        // Spoken "pie crust, 9 inch, unbaked".
        expect(row.getAttribute('aria-label')).toMatch(/pie crust, 9\s+inch, unbaked$/u);
    });

    it('a note alone is the tail', () => {
        render(rowsOf({ name: 'pie crust', unit: '', note: '9 inch' }));

        expect(screen.getByRole('checkbox', { name: /pie crust, 9\s+inch$/u })).toBeTruthy();
    });

    it('a package size stays in the bold amount as the cook wrote it', () => {
        render(rowsOf({ name: 'crushed tomatoes', unit: '(28 ounce) can', quantity: { kind: 'exact', value: 1 } }));

        const row = screen.getByRole('checkbox', { name: /crushed tomatoes/u });
        const amount = row.querySelector('.font-semibold');

        expect(amount?.textContent).toContain('(28 ounce) can');
        expect(row.textContent).not.toMatch(/crushed tomatoes.*\(28/u);
    });

    it('shows no second name, badge or link for the matched food', () => {
        render(rowsOf({ name: 'Pork sausage', displayText: 'sweet Italian sausage' }));

        const row = screen.getByRole('checkbox', { name: /sweet Italian sausage/u });

        expect(row.textContent).not.toContain('Pork sausage');
        expect(row.querySelector('a')).toBeNull();
    });
});
