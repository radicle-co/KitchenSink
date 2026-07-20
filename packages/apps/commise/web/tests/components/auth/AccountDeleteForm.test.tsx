import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeleteForm } from '@/components/auth/AccountDeleteForm';

const mockSignOut = vi.fn();

vi.mock('@clerk/nextjs', () => ({
    useClerk: () => ({ signOut: mockSignOut }),
}));

describe('AccountDeleteForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSignOut.mockResolvedValue(undefined);
    });

    it('reveals an accessible deletion confirmation dialog', async () => {
        const user = userEvent.setup();

        render(<AccountDeleteForm accessToken="test-token" userId="user-123" />);

        await user.click(screen.getByRole('button', { name: 'Delete your account' }));

        expect(screen.getByRole('dialog', { name: 'Confirm Account Deletion' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirm Deletion' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('calls DELETE /v1/users/me and signs out via IdP after confirmation', async () => {
        const user = userEvent.setup();
        // DELETE /v1/users/me returns a real 202 Accepted with an EMPTY body. A faithful Response (not a
        // hand-stubbed `{ json }`) is what proves the fix: reading an empty 202 must resolve so signOut runs.
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
        global.fetch = fetchMock;

        render(<AccountDeleteForm accessToken="test-token" userId="user-123" />);

        await user.click(screen.getByRole('button', { name: 'Delete your account' }));
        await user.click(screen.getByRole('button', { name: 'Confirm Deletion' }));

        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:4000/v1/users/me',
            expect.objectContaining({ method: 'DELETE' }),
        );
        expect(mockSignOut).toHaveBeenCalledWith({ redirectUrl: '/' });
    });
});
