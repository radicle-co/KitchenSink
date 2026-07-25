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
});
