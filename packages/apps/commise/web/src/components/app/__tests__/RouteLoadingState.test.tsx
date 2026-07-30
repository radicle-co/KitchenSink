// @vitest-environment jsdom
/**
 * Component test for the shared, PURE {@link RouteLoadingState} (B18) — the localized Suspense-fallback
 * every web App Router `loading.tsx` boundary renders.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { RouteLoadingState } from '../RouteLoadingState';

afterEach(() => {
    cleanup();
});

describe('RouteLoadingState', () => {
    it('renders an accessible, localized loading status', () => {
        renderWithProviders(<RouteLoadingState />);

        expect(screen.getByRole('status')).toHaveAccessibleName(/loading/i);
    });

    it('announces the localized label as the live region CONTENT, not only its aria-label', () => {
        renderWithProviders(<RouteLoadingState />);

        // An accessible NAME is not an announcement. A `role="status"` node rendered EMPTY is doubly broken:
        // it is zero-height (nothing for a sighted viewer, and Playwright resolves it as `hidden`) AND it is
        // silent, because a live region announces its CONTENT, not its label. The label is the caption.
        expect(screen.getByRole('status')).toHaveTextContent('Loading');
    });
});
