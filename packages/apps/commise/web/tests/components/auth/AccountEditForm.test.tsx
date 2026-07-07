import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountEditForm } from '@/components/auth/AccountEditForm';
import type { UserProfile } from '@commise/services-identity';

const mockUseRouter = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => mockUseRouter(),
}));

const mockProfile: UserProfile = {
    user: {
        id: '01JVXXXXXXXXXXXXXXXXXXXXXXXXX' as import('@commise/services-identity').UserId,
        email: 'test@example.com',
        displayName: 'Test User',
        avatarUrl: null,
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
    },
    account: {
        id: 'acc-123',
        userId: '01JVXXXXXXXXXXXXXXXXXXXXXXXXX' as import('@commise/services-identity').UserId,
        subscriptionTier: 'free',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
    },
};

describe('AccountEditForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseRouter.mockReturnValue({
            refresh: vi.fn(),
        });
    });

    it('renders form with initial values', () => {
        render(<AccountEditForm accessToken="test-token" initialProfile={mockProfile} />);

        expect(screen.getByLabelText('Display Name')).toHaveValue('Test User');
        expect(screen.getByLabelText('Avatar URL')).toHaveValue('');
    });

    it('validates required display name', async () => {
        const user = userEvent.setup();
        render(<AccountEditForm accessToken="test-token" initialProfile={mockProfile} />);

        await user.clear(screen.getByLabelText('Display Name'));
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(screen.getByLabelText('Display Name')).toBeInvalid();
    });

    it('shows loading state when submitting', async () => {
        const user = userEvent.setup();
        global.fetch = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => setTimeout(resolve, 100)));

        render(<AccountEditForm accessToken="test-token" initialProfile={mockProfile} />);

        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(screen.getByRole('button', { name: 'Saving...' })).toBeInTheDocument();
    });

    it('displays error message on failure', async () => {
        const user = userEvent.setup();
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ message: 'Update failed' }),
        } as Response);

        render(<AccountEditForm accessToken="test-token" initialProfile={mockProfile} />);

        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(await screen.findByRole('alert')).toBeInTheDocument();
    });

    it('has accessible form labels', () => {
        render(<AccountEditForm accessToken="test-token" initialProfile={mockProfile} />);

        expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
        expect(screen.getByLabelText('Avatar URL')).toBeInTheDocument();
    });
});
