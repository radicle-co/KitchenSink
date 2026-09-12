/**
 * Native component tests for `CollectionListLoading` — the list's `Suspense` fallback. Moved from the retired
 * `CollectionList.native.test.tsx` ("loading state").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { CollectionListLoading } from '../CollectionListLoading.native.js';

afterEach(cleanup);

describe('CollectionListLoading (native)', () => {
    it('shows the loading label', () => {
        render(<CollectionListLoading />);

        expect(screen.getByLabelText('Loading collections')).toBeTruthy();
    });

    it('renders inert skeleton cards (not a blank view) while loading (U4)', () => {
        render(<CollectionListLoading />);

        const region = screen.getByLabelText('Loading collections');
        expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    });
});
