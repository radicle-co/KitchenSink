import { describe, expect, it, vi } from 'vitest';

import { PROFILE_ME_PATH, updateProfile } from '../profileClient.js';

describe('profile-client', () => {
    it('targets PATCH /v1/users/me — the route the identity service actually exposes', () => {
        // Guards against the historical drift where mobile PATCHed /v1/profiles/me (a route that
        // does not exist server-side). If someone re-drifts the path, this fails.
        expect(PROFILE_ME_PATH).toBe('/v1/users/me');
    });

    it('sends the update body to the profile path via the transport and returns its result', async () => {
        const patched = { user: { displayName: 'Ada' }, account: {} };
        const patch = vi.fn().mockResolvedValue(patched);

        const result = await updateProfile({ patch }, { displayName: 'Ada', avatarUrl: null });

        expect(patch).toHaveBeenCalledTimes(1);
        expect(patch).toHaveBeenCalledWith('/v1/users/me', { displayName: 'Ada', avatarUrl: null });
        expect(result).toBe(patched);
    });

    it('propagates transport failures to the caller', async () => {
        const patch = vi.fn().mockRejectedValue(new Error('HTTP 403'));

        await expect(updateProfile({ patch }, { displayName: 'Ada' })).rejects.toThrow('HTTP 403');
    });
});
