// @vitest-environment jsdom
/**
 * Component tests for the web browse-rail LOADING body — what one rail's read boundary renders while that rail is
 * pending. Moved from the loading cases of `RecipeBrowseRails.test.tsx`'s "rail states".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { makeRecipe } from '../../__fixtures__/index.js';
import { RecipeBrowseRailLoading } from '../RecipeBrowseRailLoading.js';
import type { SaveCopy } from '../../hooks/useSaveCopy.js';
import { RecipeBrowseRailResults } from '../RecipeBrowseRailResults.js';

afterEach(cleanup);

const noop = () => undefined;
const SAVE_COPY: SaveCopy = { stateOf: () => ({ kind: 'idle' }), save: noop };

describe('RecipeBrowseRailLoading (web)', () => {
    it('shows a busy status', () => {
        render(<RecipeBrowseRailLoading />);

        expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeTruthy();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        render(<RecipeBrowseRailLoading />);

        // The shimmer cards are all `aria-hidden`, so without a visible caption the live region has NO content — and a
        // live region announces its content, not its label.
        expect(screen.getByRole('status').textContent).toContain('Loading recipes');
    });

    /**
     * E1 (`docs/design/uiOverhaul/evaluateShellAndLists.md`): the skeleton strip had `flex gap-4` and no overflow rule,
     * so three 256 px tiles widened the whole page to 832 px at 320. The fix is that the pending strip IS the loaded
     * strip's scroll container, so they cannot drift again. jsdom has no layout, so this proves the shared container;
     * `tests/e2e/discoverReflow.spec.ts` proves the page width in a browser.
     */
    it('lays its shimmer cards out in the SAME scroll track as the loaded rail', () => {
        render(<RecipeBrowseRailLoading />);
        const pendingTrack = screen.getByRole('status').querySelector('[aria-hidden="true"]');
        cleanup();
        render(
            <RecipeBrowseRailResults results={[{ recipe: makeRecipe() }]} saveCopy={SAVE_COPY} onSelectRecipe={noop} />,
        );
        // The scroll container is the list's parent: it carries the overflow, so it is what must not drift.
        const loadedTrack = screen.getByRole('list').parentElement as HTMLElement;

        expect(pendingTrack?.tagName).toBe(loadedTrack.tagName);
        expect(pendingTrack?.className).toBe(loadedTrack.className);
    });

    it('renders decorative shimmer cards that stop under reduce-motion', () => {
        render(<RecipeBrowseRailLoading />);

        const shimmer = screen.getByRole('status').querySelectorAll('.animate-pulse');
        expect(shimmer.length).toBeGreaterThanOrEqual(3);

        for (const node of Array.from(shimmer)) {
            expect(node.closest('[aria-hidden="true"]')).not.toBeNull();
            expect(node.className).toContain('motion-reduce:animate-none');
        }
    });
});
