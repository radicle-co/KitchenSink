/**
 * Native component tests for the recipe-list LOADING fallback (react-native-web under jsdom). Mirrors
 * `RecipeListLoading.test.tsx`; moved from the retired `RecipeList.native.test.tsx` ("loading state", and the loading
 * half of "create FAB (L1)").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeListLoading } from '../RecipeListLoading.native.js';

afterEach(cleanup);

describe('RecipeListLoading (native)', () => {
    it('labels the loading region for assistive tech', () => {
        render(<RecipeListLoading />);

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
    });

    it('renders inert skeleton cards (not a blank view), hidden from assistive tech (U4)', () => {
        render(<RecipeListLoading />);

        expect(
            screen.getByLabelText('Loading recipes').querySelectorAll('[aria-hidden="true"]').length,
        ).toBeGreaterThan(0);
    });

    it('⛔ offers NO create control at all while the library is unresolved', () => {
        // The mobile mirror of the mid-press-unmount defect: a dial mounted over an unanswered library detached under a
        // first-run cook's finger when the empty library settled.
        render(<RecipeListLoading />);

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByRole('menuitem')).toBeNull();
    });
});
