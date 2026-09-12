/**
 * The native Data sources loading state (design §S16): the caption is spoken politely and shown, and the placeholder
 * cards stay out of the accessibility tree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourcesSkeleton } from '../DataSourcesSkeleton.native.js';

afterEach(cleanup);

describe('DataSourcesSkeleton (native)', () => {
    it('shows and politely announces the caption', () => {
        render(<DataSourcesSkeleton />);

        const caption = screen.getByText('Loading data sources…');

        expect(caption.closest('[aria-live="polite"]')).not.toBeNull();
    });

    it('hides the three placeholder cards from assistive technology', () => {
        const { container } = render(<DataSourcesSkeleton />);

        const hidden = container.querySelector('[aria-hidden="true"]');

        expect(hidden?.children).toHaveLength(3);
        expect(hidden?.contains(screen.getByText('Loading data sources…'))).toBe(false);
    });
});
