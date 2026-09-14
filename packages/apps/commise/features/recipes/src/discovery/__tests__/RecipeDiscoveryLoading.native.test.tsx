/**
 * Native component tests for the discovery LOADING body (react-native-web under jsdom). Mirrors
 * `RecipeDiscoveryLoading.test.tsx`; moved from the retired `RecipeDiscoveryList.native.test.tsx` ("loading state",
 * "loading skeleton (U7)").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDiscoveryLoading } from '../RecipeDiscoveryLoading.native.js';

afterEach(cleanup);

describe('RecipeDiscoveryLoading (native)', () => {
    it('labels the loading region and renders no recipe rows', () => {
        render(<RecipeDiscoveryLoading />);

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders inert skeleton cards (not a blank view) inside the labelled region', () => {
        render(<RecipeDiscoveryLoading />);

        expect(
            screen.getByLabelText('Loading recipes').querySelectorAll('[aria-hidden="true"]').length,
        ).toBeGreaterThan(0);
    });
});
