// @vitest-environment jsdom
/**
 * Authoritative state-matrix tests for the profile-edit form (U3 — supersedes the pre-U3
 * `tests/components/auth/AccountEditForm.test.tsx`). Covers every UI path: initial values + localized labels,
 * required-field validation, a successful save wired to `PATCH /api/v1/users/me` (NOT `/api/v1/profiles/me`) plus
 * `router.refresh`, the localized in-flight busy label, the localized generic failure alert that never echoes
 * the raw server error (B17), and the localized missing-token guard. The real identity client is exercised
 * against a mocked `fetch` so the wire is asserted; copy resolves through the default ('en') locale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserId, UserProfile } from '@kitchensink/identity-service';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { AccountEditForm } from '../AccountEditForm';

const userId = '01JVXXXXXXXXXXXXXXXXXXXXXXXXX' as UserId;
const mockProfile: UserProfile = {
    user: {
        id: userId,
        email: 'test@example.com',
        displayName: 'Test User',
        avatarUrl: null,
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
    },
    account: {
        id: 'acc-123',
        userId,
        subscriptionTier: 'free',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
    },
};

const renderForm = (accessToken = 'test-token'): void => {
    render(<AccountEditForm accessToken={accessToken} initialProfile={mockProfile} />);
};

beforeEach(() => {
    refresh.mockReset();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('AccountEditForm (U3) — rendering', () => {
    it('renders the initial values with localized, accessible labels', () => {
        renderForm();

        expect(screen.getByLabelText('Display Name')).toHaveValue('Test User');
        expect(screen.getByLabelText('Avatar URL')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeTruthy();
    });

    it('marks the display name invalid when cleared (required)', async () => {
        const user = userEvent.setup();
        renderForm();

        await user.clear(screen.getByLabelText('Display Name'));
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(screen.getByLabelText('Display Name')).toBeInvalid();
    });
});

describe('AccountEditForm (U3) — submit', () => {
    it('PATCHes /api/v1/users/me with the edited values and refreshes on success', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify(mockProfile)),
        } as Response);
        vi.stubGlobal('fetch', fetchMock);

        renderForm();
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/api/v1/users/me');
        expect(url).not.toContain('/api/v1/profiles/me');
        expect(init.method).toBe('PATCH');
        expect(init.body).toBe(JSON.stringify({ displayName: 'Test User', avatarUrl: null }));
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    });

    it('surfaces a localized, generic failure alert that never echoes the raw server error (B17)', async () => {
        const user = userEvent.setup();
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ message: 'RAW_SERVER_DETAIL_boom' }),
            } as Response),
        );

        renderForm();
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe('We couldn’t save your changes. Please try again.');
        expect(screen.queryByText(/RAW_SERVER_DETAIL_boom/)).toBeNull();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('blocks the request with a localized notice when the session token is missing', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        renderForm('');
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        expect(screen.getByRole('alert').textContent).toBe('You’re not signed in. Please sign in and try again.');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('AccountEditForm (U3) — in-flight', () => {
    it('shows the localized busy label and disables the control while the save is pending', async () => {
        const user = userEvent.setup();
        let resolveFetch: ((value: Response) => void) | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn().mockReturnValue(
                new Promise<Response>((resolve) => {
                    resolveFetch = resolve;
                }),
            ),
        );

        renderForm();
        await user.click(screen.getByRole('button', { name: 'Save Changes' }));

        const busy = await screen.findByRole('button', { name: 'Saving…' });
        expect(busy).toHaveProperty('disabled', true);

        resolveFetch?.({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify(mockProfile)),
        } as Response);
    });
});
