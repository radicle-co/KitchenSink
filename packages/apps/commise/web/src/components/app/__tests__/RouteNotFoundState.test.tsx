// @vitest-environment jsdom
/**
 * Component test for the shared, PURE {@link RouteNotFoundState} (B18) — the localized fallback every web
 * App Router `not-found.tsx` boundary renders, with a way back to the current locale's home.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

vi.mock('next/navigation', () => ({ useParams: () => ({ locale: 'en' }) }));

const { RouteNotFoundState } = await import('../RouteNotFoundState');

afterEach(() => {
    cleanup();
});

describe('RouteNotFoundState', () => {
    it('renders localized not-found copy with a way back to the current locale home', () => {
        renderWithProviders(<RouteNotFoundState />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        const backLink = screen.getByRole('link');
        expect(backLink).toHaveAttribute('href', '/en');
    });
});
