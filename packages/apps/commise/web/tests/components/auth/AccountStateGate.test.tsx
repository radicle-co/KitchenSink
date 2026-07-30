import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPERSONATION_BLOCK, SUSPENDED_BLOCK } from '@commise/features-account';
import { AccountStateGate } from '@/components/auth/AccountStateGate';

const mockUseAuth = vi.fn();
const mockUseUser = vi.fn();

vi.mock('@clerk/nextjs', () => ({
    useAuth: () => mockUseAuth(),
    useUser: () => mockUseUser(),
}));

function setSession(overrides: {
    isLoaded?: boolean;
    isSignedIn?: boolean;
    userId?: string | null;
    sessionClaims?: Record<string, unknown> | null;
    publicMetadata?: Record<string, unknown> | null;
}) {
    mockUseAuth.mockReturnValue({
        isLoaded: overrides.isLoaded ?? true,
        isSignedIn: overrides.isSignedIn ?? true,
        userId: overrides.userId ?? 'user_abc',
        sessionClaims: overrides.sessionClaims ?? {},
    });
    mockUseUser.mockReturnValue({ user: { publicMetadata: overrides.publicMetadata ?? {} } });
}

describe('AccountStateGate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows a loading status while the IdP is still loading (no protected content leaks)', () => {
        setSession({ isLoaded: false });

        render(
            <AccountStateGate>
                <p>Protected content</p>
            </AccountStateGate>,
        );

        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });

    it('renders children for a valid, active, non-impersonated session', () => {
        setSession({});

        render(
            <AccountStateGate>
                <p>Protected content</p>
            </AccountStateGate>,
        );

        expect(screen.getByText('Protected content')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('blocks suspended accounts with the shared suspension copy and hides protected content', () => {
        setSession({ publicMetadata: { status: 'suspended' } });

        render(
            <AccountStateGate>
                <p>Protected content</p>
            </AccountStateGate>,
        );

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(SUSPENDED_BLOCK.title);
        expect(alert).toHaveTextContent(SUSPENDED_BLOCK.body);
        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });

    it('blocks impersonated sessions with the shared impersonation copy', () => {
        setSession({ sessionClaims: { act: { sub: 'admin_1' } } });

        render(
            <AccountStateGate>
                <p>Protected content</p>
            </AccountStateGate>,
        );

        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(IMPERSONATION_BLOCK.title);
        expect(alert).toHaveTextContent(IMPERSONATION_BLOCK.body);
        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });
});
