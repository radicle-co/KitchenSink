import { describe, expect, it, vi } from 'vitest';

const getItemAsync = vi.fn(async () => 'cached-token' as string | null);
const setItemAsync = vi.fn(async () => undefined);
const deleteItemAsync = vi.fn(async () => undefined);

vi.mock('expo-secure-store', () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
}));

vi.mock('@clerk/expo', () => ({
    useAuth: vi.fn(),
    useUser: vi.fn(),
}));

const { deriveAuthState } = await import('../src/hooks/useAuth.js');
const { IMPERSONATION_BLOCK, SUSPENDED_BLOCK } = await import('@commise/features-account');
const { tokenCache } = await import('../src/storage/tokenCache.js');

describe('deriveAuthState', () => {
    it('returns loading when IdP has not loaded', () => {
        expect(
            deriveAuthState({
                isLoaded: false,
                isSignedIn: false,
                userId: null,
                sessionClaims: null,
                userPublicMetadata: null,
            }),
        ).toEqual({ status: 'loading' });
    });

    it('returns unauthenticated when not signed in', () => {
        expect(
            deriveAuthState({
                isLoaded: true,
                isSignedIn: false,
                userId: null,
                sessionClaims: null,
                userPublicMetadata: null,
            }),
        ).toEqual({ status: 'unauthenticated' });
    });

    it('returns authenticated when signed in', () => {
        expect(
            deriveAuthState({
                isLoaded: true,
                isSignedIn: true,
                userId: 'user_abc',
                sessionClaims: {},
                userPublicMetadata: {},
            }),
        ).toEqual({ status: 'authenticated', userId: 'user_abc' });
    });

    it('blocks impersonated sessions', () => {
        expect(
            deriveAuthState({
                isLoaded: true,
                isSignedIn: true,
                userId: 'user_abc',
                sessionClaims: { act: { sub: 'admin_1' } },
                userPublicMetadata: {},
            }),
        ).toEqual({ status: 'blocked', reason: IMPERSONATION_BLOCK });
    });

    it('blocks suspended accounts', () => {
        expect(
            deriveAuthState({
                isLoaded: true,
                isSignedIn: true,
                userId: 'user_abc',
                sessionClaims: {},
                userPublicMetadata: { status: 'suspended' },
            }),
        ).toEqual({ status: 'blocked', reason: SUSPENDED_BLOCK });
    });
});

describe('tokenCache', () => {
    it('reads tokens from SecureStore', async () => {
        const value = await tokenCache.getToken('idp_jwt');
        expect(value).toBe('cached-token');
        expect(getItemAsync).toHaveBeenCalledWith('idp_jwt');
    });

    it('writes tokens with WHEN_UNLOCKED_THIS_DEVICE_ONLY', async () => {
        await tokenCache.saveToken('idp_jwt', 'new-token');
        expect(setItemAsync).toHaveBeenCalledWith('idp_jwt', 'new-token', {
            keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
        });
    });

    it('deletes corrupt items on read failure', async () => {
        getItemAsync.mockRejectedValueOnce(new Error('corrupt'));
        const value = await tokenCache.getToken('idp_jwt');
        expect(value).toBeNull();
        expect(deleteItemAsync).toHaveBeenCalledWith('idp_jwt');
    });
});
