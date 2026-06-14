import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyToken = vi.fn();

vi.mock('@clerk/backend', () => ({
    verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

const JWT_KEY = '-----BEGIN PUBLIC KEY-----\nMIIBfake\n-----END PUBLIC KEY-----';

async function makeService() {
    const { ClerkAuthService } = await import('../src/auth/clerk-auth.service.js');

    return new ClerkAuthService();
}

describe('ClerkAuthService', () => {
    beforeEach(() => {
        vi.resetModules();
        mockVerifyToken.mockReset();
        process.env['CLERK_JWT_KEY'] = JWT_KEY;
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://commise.app, https://app.commise.app';
    });

    afterEach(() => {
        delete process.env['CLERK_JWT_KEY'];
        delete process.env['CLERK_AUTHORIZED_PARTIES'];
    });

    it('returns mapped claims for a valid token', async () => {
        mockVerifyToken.mockResolvedValueOnce({
            data: {
                sub: 'user_abc123',
                email: 'new@example.com',
                first_name: 'Ada',
                last_name: 'Lovelace',
                image_url: 'https://img.example/a.png',
            },
        });

        const service = await makeService();
        const claims = await service.verify('Bearer.token.value');

        expect(claims).toEqual({
            sub: 'user_abc123',
            email: 'new@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            picture: 'https://img.example/a.png',
        });
    });

    it('passes jwtKey and authorizedParties to verifyToken', async () => {
        mockVerifyToken.mockResolvedValueOnce({ data: { sub: 'user_x' } });

        const service = await makeService();
        await service.verify('t');

        expect(mockVerifyToken).toHaveBeenCalledWith('t', {
            jwtKey: JWT_KEY,
            authorizedParties: ['https://commise.app', 'https://app.commise.app'],
        });
    });

    it('returns undefined email/name when custom claims are absent', async () => {
        mockVerifyToken.mockResolvedValueOnce({ data: { sub: 'user_no_claims' } });

        const service = await makeService();
        const claims = await service.verify('t');

        expect(claims.sub).toBe('user_no_claims');
        expect(claims.email).toBeUndefined();
        expect(claims.firstName).toBeUndefined();
        expect(claims.picture).toBeUndefined();
    });

    it('throws Unauthorized when verifyToken returns errors (bad signature / expiry / azp)', async () => {
        mockVerifyToken.mockResolvedValueOnce({ errors: [new Error('token-invalid')] });

        const service = await makeService();
        await expect(service.verify('t')).rejects.toMatchObject({ status: 401 });
    });

    it('throws Unauthorized when verifyToken throws', async () => {
        mockVerifyToken.mockRejectedValueOnce(new Error('boom'));

        const service = await makeService();
        await expect(service.verify('t')).rejects.toMatchObject({ status: 401 });
    });

    it('throws Unauthorized when the verified payload has no sub', async () => {
        mockVerifyToken.mockResolvedValueOnce({ data: { email: 'x@example.com' } });

        const service = await makeService();
        await expect(service.verify('t')).rejects.toMatchObject({ status: 401 });
    });

    it('throws Unauthorized (and never calls verifyToken) when no JWT key is configured', async () => {
        delete process.env['CLERK_JWT_KEY'];

        const service = await makeService();
        await expect(service.verify('t')).rejects.toMatchObject({ status: 401 });
        expect(mockVerifyToken).not.toHaveBeenCalled();
    });
});
