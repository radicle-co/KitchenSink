/**
 * Native component tests for the browse-rail LOADING body (react-native-web under jsdom). Mirrors
 * `RecipeBrowseRailLoading.test.tsx`; moved from `RecipeBrowseRails.native.test.tsx`'s "rail states".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeBrowseRailLoading } from '../RecipeBrowseRailLoading.native.js';

afterEach(cleanup);

describe('RecipeBrowseRailLoading (native)', () => {
    it('shows a busy status labelled for assistive tech, with the label as its visible caption', () => {
        render(<RecipeBrowseRailLoading />);

        const status = screen.getByRole('status', { name: 'Loading recipes' });
        // The label is the region's CONTENT too, as on web: a live region announces its content, not its label.
        expect(status.textContent).toContain('Loading recipes');
    });
});
