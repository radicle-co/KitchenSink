/**
 * Heading order on Collections at the largest text size (designer finding, qa-ios, 2026-11-03): the "5 collections" count
 * was a plain React Native `Text` with the `label` STYLE, which iOS grows by the whole system scale (14 x 3.1 = 43.4 pt)
 * past the page title's 42 pt cap. It is now the design-system Text, `label` role, capped at 2x (28 pt).
 *
 * jsdom cannot apply the OS font scale to a plain React Native `Text`, so the first test pins the count to the size its ROLE
 * draws at that scale, which only the design-system Text produces; the second states the designer's ordering directly.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { scaledTypeSize } from '@commise/ui/scaled-type';
import { renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { makeCollection } from '@kitchensink/recipe-core/testing';

import { RecipeListHeaderContext } from '../../list/recipeListHeaderContext.js';
import { CollectionListResults } from '../CollectionListResults.native.js';

afterEach(cleanup);

/** The iOS scale at AX XXXL. */
const IOS_CAP_SCALE = 3.1;

const noop = () => undefined;

const px = (element: HTMLElement): number => Number.parseFloat(resolvedStyle(element, 'fontSize'));

function renderCollections() {
    renderWithTamagui(
        <LocaleProvider locale="en">
            <RecipeListHeaderContext value={<LargeTitleHeader headingId="recipes-title" title="Recipes" />}>
                <CollectionListResults
                    collections={[
                        makeCollection({ id: 'col_1', name: 'Weeknight Dinners', visibility: 'private' }),
                        makeCollection({ id: 'col_2', name: 'Holiday Baking', visibility: 'private' }),
                    ]}
                    total={5}
                    onSelect={noop}
                    search={{ value: '', onChange: noop }}
                    firstRun={{ hasRecipes: true, onAddRecipe: noop }}
                />
            </RecipeListHeaderContext>
        </LocaleProvider>,
        'light',
        IOS_CAP_SCALE,
    );
}

describe('Collections (native) — heading order at the largest text size', () => {
    it('draws the count row at the label role’s capped size', () => {
        renderCollections();

        expect(px(screen.getByText('5 collections'))).toBe(scaledTypeSize('label', IOS_CAP_SCALE).fontSize);
    });

    it('never draws the page title smaller than the count row', () => {
        renderCollections();

        expect(px(screen.getByRole('heading', { name: 'Recipes' }))).toBeGreaterThanOrEqual(
            px(screen.getByText('5 collections')),
        );
    });
});
