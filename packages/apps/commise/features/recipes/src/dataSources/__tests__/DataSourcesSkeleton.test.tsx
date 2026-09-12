// @vitest-environment jsdom
/**
 * The web Data sources loading state (design §S16): a polite status whose content is the caption, beside three
 * placeholder cards a screen reader never reaches.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { DataSourcesSkeleton } from '../DataSourcesSkeleton.js';

afterEach(cleanup);

describe('DataSourcesSkeleton (web)', () => {
    it('announces the caption politely, as real text', () => {
        render(<DataSourcesSkeleton />);

        const status = screen.getByRole('status');

        expect(status.textContent).toBe('Loading data sources…');
        expect(status.getAttribute('aria-live')).not.toBe('assertive');
    });

    it('draws three placeholder cards, all hidden from assistive technology', () => {
        const { container } = render(<DataSourcesSkeleton />);

        const hidden = container.querySelector('[aria-hidden="true"]');

        expect(hidden?.children).toHaveLength(3);
        // Nothing hidden is also the status: the caption stays readable.
        expect(hidden?.contains(screen.getByRole('status'))).toBe(false);
    });
});
