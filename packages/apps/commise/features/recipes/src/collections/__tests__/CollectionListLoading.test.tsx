// @vitest-environment jsdom
/**
 * Component tests for the web `CollectionListLoading` — what the collection list's `Suspense` renders while the first
 * page is pending. Moved from the retired `CollectionList.test.tsx` ("loading state").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { CollectionListLoading } from '../CollectionListLoading.js';

afterEach(cleanup);

describe('CollectionListLoading (web)', () => {
    it('shows a busy status', () => {
        render(<CollectionListLoading />);

        expect(screen.getByRole('status')).toBeTruthy();
    });

    it('announces the localized loading label as the live region CONTENT, not only its aria-label', () => {
        render(<CollectionListLoading />);

        // A `role="status"` node rendered EMPTY is doubly broken: it is zero-height (nothing for a sighted viewer, and
        // Playwright resolves it as `hidden`) AND it is silent, because a live region announces its CONTENT, not its
        // label. The label must therefore be the visible caption.
        expect(screen.getByRole('status').textContent).toContain('Loading collections');
    });
});
