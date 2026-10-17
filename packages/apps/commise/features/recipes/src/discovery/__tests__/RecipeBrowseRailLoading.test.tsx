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
     * so three 256 px tiles widened the whole page to 832 px at 320. The fix is that the pending strip is held inside its
     * box, so they cannot widen the page. jsdom has no layout, so this proves the rule; `tests/e2e/discoverReflow.spec.ts`
     * proves the page width in a browser.
     *
     * ⚠️ REWRITTEN for the scroll hint. The pending strip used to share the loaded rail's scroll container, class for
     * class. The loaded rail is now a `HorizontalScroller`; the pending strip has nothing to scroll to and nothing to
     * promise, so it is a non-scrolling box (`overflow-x-hidden`) with no chevron and no fade, and it shares the loaded
     * rail's LIST so the tiles lay out identically.
     */
    it('holds its shimmer cards inside a box that does not scroll, and draws no scroll hint', () => {
        render(<RecipeBrowseRailLoading />);
        const status = screen.getByRole('status');
        const pendingTrack = status.querySelector('[aria-hidden="true"]') as HTMLElement;
        const pendingList = pendingTrack.querySelector('ul') as HTMLElement;

        expect(pendingTrack.className.split(' ')).toContain('overflow-x-hidden');
        expect(status.querySelector('[class*="overflow-x-auto"]')).toBeNull();
        expect(status.querySelector('svg')).toBeNull();

        cleanup();
        render(
            <RecipeBrowseRailResults results={[{ recipe: makeRecipe() }]} saveCopy={SAVE_COPY} onSelectRecipe={noop} />,
        );

        expect(pendingList.className).toBe(screen.getByRole('list').className);
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
