/**
 * Native component tests for the browse-rail LOADING body (react-native-web under jsdom). Mirrors
 * `RecipeBrowseRailLoading.test.tsx`; moved from `RecipeBrowseRails.native.test.tsx`'s "rail states".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeBrowseRailLoading } from '../RecipeBrowseRailLoading.native.js';

afterEach(cleanup);

/**
 * `docs/design/nativeContainerNames.md` N1: the loading region keeps its status role (rule 4), and its visible caption
 * says what is loading, so the region carries no name of its own and the caption is said once (rule 1, N4).
 */
describe('RecipeBrowseRailLoading (native) — N1: a status said by its caption alone', () => {
    it('keeps one status, its caption says "Loading recipes", and no node is labelled with it', () => {
        render(<RecipeBrowseRailLoading />);

        const status = screen.getByRole('status');
        expect(status.textContent).toContain('Loading recipes');
        expect(screen.queryAllByLabelText('Loading recipes')).toEqual([]);
    });
});
