/**
 * Native component tests for the recent-recipe row (rendered via react-native-web under jsdom): the leaf
 * renders the recipe title as visible text and sets the row's accessibilityLabel to that title (mapped by
 * RNW to `aria-label`), mirroring the web leaf's accessible-name semantics.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { RecipeSummary } from '../props.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecentRecipeItem } from '../RecentRecipeItem.native.js';

afterEach(cleanup);

const makeSummary = (overrides: Partial<RecipeSummary> = {}): RecipeSummary => ({
    id: 'rec_1',
    title: 'Weeknight Pasta',
    updatedAt: '2026-04-19T09:30:00.000Z',
    ...overrides,
});

describe('RecentRecipeItem (native)', () => {
    it('renders the recipe title as visible text', () => {
        render(<RecentRecipeItem recipe={makeSummary({ title: 'Chana Masala' })} />);

        expect(screen.getByText('Chana Masala')).toBeTruthy();
    });

    it('labels the row with the recipe title', () => {
        render(<RecentRecipeItem recipe={makeSummary({ title: 'Chana Masala' })} />);

        expect(screen.getByLabelText('Chana Masala')).toBeTruthy();
    });
});
