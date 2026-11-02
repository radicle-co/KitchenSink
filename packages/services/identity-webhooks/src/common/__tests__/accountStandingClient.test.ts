/**
 * The suspended-mark writer (ADR-0081): what it sends to Clerk, and that it only ever MERGES one key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateUserMetadata } = vi.hoisted(() => ({ updateUserMetadata: vi.fn() }));

vi.mock('../identityClient.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../identityClient.js')>()),
    getClerkClient: vi.fn().mockResolvedValue({ users: { updateUserMetadata } }),
}));

import { setSuspendedMark } from '../accountStandingClient.js';

beforeEach(() => {
    updateUserMetadata.mockReset().mockResolvedValue(undefined);
});

describe('setSuspendedMark', () => {
    it('merges `suspended: true` and nothing else, so roles, scopes and the test-pool marker survive', async () => {
        await expect(setSuspendedMark('user_1', true)).resolves.toBe('written');

        expect(updateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: { suspended: true } });
    });

    it('clears the key with null (Clerk deep-merge removes it), never false or an empty object', async () => {
        await setSuspendedMark('user_1', false);

        expect(updateUserMetadata).toHaveBeenCalledWith('user_1', { publicMetadata: { suspended: null } });
    });

    it('converges as absent when Clerk no longer holds the user', async () => {
        updateUserMetadata.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));

        await expect(setSuspendedMark('user_gone', true)).resolves.toBe('absent');
    });

    it('rethrows any other failure so the message redelivers', async () => {
        updateUserMetadata.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));

        await expect(setSuspendedMark('user_1', true)).rejects.toThrow('rate limited');
    });
});
