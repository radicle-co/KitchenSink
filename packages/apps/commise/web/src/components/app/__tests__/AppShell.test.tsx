// @vitest-environment jsdom
/**
 * Tests for the app-wide navigation shell (W1/L9). Verifies the shared chrome wraps an arbitrary surface —
 * so routes beyond Home (the recipe list, …) get the SAME sidebar/bottom-nav — and that the surface's own
 * destination is marked current. The viewer-profile hook is mocked; the locale comes from a provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';

vi.mock('@/hooks/useUserProfile', () => ({
    useUserProfile: () => ({ data: { user: { displayName: 'Ada' } } }),
}));

const { AppShell } = await import('../AppShell');

afterEach(cleanup);

const renderShell = (activeId: 'home' | 'recipes') =>
    render(
        <LocaleProvider locale="en">
            <AppShell activeId={activeId}>
                <p>surface content</p>
            </AppShell>
        </LocaleProvider>,
    );

describe('AppShell', () => {
    it('renders the surface content inside the shared navigation chrome', () => {
        renderShell('recipes');

        expect(screen.getByText('surface content')).toBeTruthy();
        // The shell contributes the navigation landmarks (desktop sidebar + bottom tab bar).
        expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    });

    it('marks the active destination as the current page', () => {
        const { container } = renderShell('recipes');

        expect(container.querySelector('[aria-current="page"]')).not.toBeNull();
    });
});
