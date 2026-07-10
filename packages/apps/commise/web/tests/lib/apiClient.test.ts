import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApiClient } from '@/lib/apiClient';

const mockNavigateTo = vi.fn();

vi.mock('@/lib/navigation', () => ({
    navigateTo: (url: string) => mockNavigateTo(url),
}));

describe('api-client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.history.replaceState(null, '', '/profile');
    });

    it('redirects expired sessions to IdP sign-in fallback on 401', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ message: 'Unauthorized' }),
        } as Response);

        await expect(buildApiClient('expired-token').get('/v1/users/me')).rejects.toThrow('Unauthorized');

        expect(mockNavigateTo).toHaveBeenCalledWith('/sign-in?redirect_url=%2Fprofile');
    });
});
