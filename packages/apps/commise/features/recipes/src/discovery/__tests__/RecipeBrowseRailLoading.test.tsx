// @vitest-environment jsdom
/**
 * Component tests for the web browse-rail LOADING body — what one rail's read boundary renders while that rail is
 * pending. Moved from the loading cases of `RecipeBrowseRails.test.tsx`'s "rail states".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeBrowseRailLoading } from '../RecipeBrowseRailLoading.js';

afterEach(cleanup);

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
