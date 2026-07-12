// @vitest-environment jsdom
/**
 * Component tests for the web recent-recipe row — the leaf renders the recipe title as its visible text and
 * exposes that same title as the row's accessible name (an <article> labelled by the title).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { RecipeSummary } from '../props.js';
import { RecentRecipeItem } from '../RecentRecipeItem.js';

afterEach(cleanup);

const makeSummary = (overrides: Partial<RecipeSummary> = {}): RecipeSummary => ({
    id: 'rec_1',
    title: 'Weeknight Pasta',
    updatedAt: '2026-04-19T09:30:00.000Z',
    ...overrides,
});

describe('RecentRecipeItem (web)', () => {
    it('renders the recipe title as visible text', () => {
        render(<RecentRecipeItem recipe={makeSummary({ title: 'Chana Masala' })} />);

        expect(screen.getByText('Chana Masala')).toBeTruthy();
    });

    it('names the row (article) with the recipe title', () => {
        render(<RecentRecipeItem recipe={makeSummary({ title: 'Chana Masala' })} />);

        expect(screen.getByRole('article', { name: 'Chana Masala' })).toBeTruthy();
    });
});
