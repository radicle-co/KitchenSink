/**
 * Component tests for the NATIVE recipe-card-grid skeleton (react-native-web under jsdom).
 *
 * ⛔ WHY THIS FILE IS NEW. The web leaf has been the single authoritative recipe-grid skeleton since it was
 * extracted, while native had NO counterpart at all: `RecipeList.native.tsx` and
 * `RecipeDiscoveryList.native.tsx` each hand-rolled their own placeholder grid in their own `StyleSheet`.
 * That is a live breach of the cross-platform rule (`docs/CODING_STANDARDS.md` §14) — one component with a
 * web-only implementation and two divergent native copies — so the leaf exists now and both surfaces compose
 * it.
 *
 * The native contract is the web one expressed in RN primitives: the localized label NAMES the region (RN has
 * no live regions, so the label is an accessibility name rather than an announcement), and the placeholder
 * cards are hidden from assistive tech. They are INERT — no animation, hence no reduced-motion gate — which
 * is the choice both native surfaces already made and which this leaf preserves.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeCardGridSkeleton } from '../RecipeCardGridSkeleton.native.js';
import { RECIPE_CARD_SKELETON_COUNT } from '../model.js';

afterEach(cleanup);

describe('RecipeCardGridSkeleton (native)', () => {
    it('names the loading region with its localized label', () => {
        render(<RecipeCardGridSkeleton label="Loading recipes" />);

        expect(screen.getByLabelText('Loading recipes')).toBeTruthy();
    });

    it('paints the default number of placeholder cards, and honours an explicit count', () => {
        const { container } = render(<RecipeCardGridSkeleton label="Loading recipes" />);

        expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(RECIPE_CARD_SKELETON_COUNT);
        cleanup();

        const { container: three } = render(<RecipeCardGridSkeleton label="Loading recipes" count={3} />);
        expect(three.querySelectorAll('[aria-hidden="true"]').length).toBe(3);
    });

    // The label names the wait ONCE; the cards themselves say nothing, so a six-card grid does not announce
    // six times. Asserted on the accessible NAME of each placeholder, not on a role it never had.
    it('gives the region the only accessible name — every placeholder card is nameless', () => {
        const { container } = render(<RecipeCardGridSkeleton label="Loading recipes" />);

        expect(screen.getAllByLabelText('Loading recipes')).toHaveLength(1);

        for (const card of container.querySelectorAll('[aria-hidden="true"]')) {
            expect(card.getAttribute('aria-label')).toBeNull();
            expect(card.textContent).toBe('');
        }
    });
});
