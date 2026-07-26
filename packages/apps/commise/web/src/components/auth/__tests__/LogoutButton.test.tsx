// @vitest-environment jsdom
/**
 * State tests for the sign-out control (U3): it renders the localized label as a design-system Button, an
 * explicit child overrides the label, and activating it signs the viewer out (basePath-prefixed home) while
 * showing the localized busy label. Clerk + basePath are mocked at the module boundary; copy resolves via
 * the real LocaleProvider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@commise/test-utils';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut }) }));
vi.mock('@/lib/basePath', () => ({ withBasePath: (p: string) => p }));

const { LogoutButton } = await import('../LogoutButton');

beforeEach(() => {
    signOut.mockReset();
});

afterEach(cleanup);

describe('LogoutButton (U3)', () => {
    it('renders the localized default label as a button', () => {
        renderWithProviders(<LogoutButton />);

        expect(screen.getByRole('button', { name: 'Sign out of your account' })).toBeTruthy();
    });

    it('lets a consumer override the label', () => {
        renderWithProviders(<LogoutButton>Log out</LogoutButton>);

        expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    });

    it('signs the viewer out to the basePath-prefixed home on activation, showing the busy label', async () => {
        const user = userEvent.setup();
        let resolveSignOut: (() => void) | undefined;
        signOut.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                resolveSignOut = resolve;
            }),
        );
        renderWithProviders(<LogoutButton />);

        await user.click(screen.getByRole('button', { name: 'Sign out of your account' }));

        expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/' });
        expect(await screen.findByRole('button', { name: 'Signing out…' })).toHaveProperty('disabled', true);

        resolveSignOut?.();
    });
});
