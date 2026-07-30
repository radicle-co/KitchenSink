/**
 * Unit tests for {@link ClerkAuthService} — the identity service's networkless Clerk token verifier.
 *
 * After ARCH-PS-1 this delegates to the shared `@kitchensink/clerk-verify` (one implementation shared
 * across services so the security-sensitive handling can't drift). These tests pin the delegation
 * contract: the configured jwtKey + parsed azp allowlist are forwarded, a verified result is returned,
 * and ANY verifier failure maps to an opaque 401 that leaks nothing about the reason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { verifyClerkToken } from '@kitchensink/clerk-verify';

import { ClerkAuthService } from '../clerk-auth.service.js';

// Only stub `verifyClerkToken` — `resolveAzpEnforcement` (which the constructor also calls) is a real,
// pure function; keeping it real means these tests exercise the actual azp-allowlist parsing instead of
// duplicating its logic in a hand-maintained mock that can drift from the real implementation.
vi.mock('@kitchensink/clerk-verify', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@kitchensink/clerk-verify')>();
    return { ...actual, verifyClerkToken: vi.fn() };
});

const mockVerify = vi.mocked(verifyClerkToken);

describe('ClerkAuthService', () => {
    beforeEach(() => {
        mockVerify.mockReset();
        process.env['CLERK_JWT_KEY'] = 'pem-public-key';
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://a.example.com, https://b.example.com';
    });

    afterEach(() => {
        delete process.env['CLERK_JWT_KEY'];
        delete process.env['CLERK_AUTHORIZED_PARTIES'];
    });

    it('delegates to the shared verifier with the configured jwtKey + parsed azp allowlist', async () => {
        mockVerify.mockResolvedValue({ sub: 'user_1', scopes: [], permissions: [] });

        const claims = await new ClerkAuthService().verify('the-token');

        expect(mockVerify).toHaveBeenCalledWith('the-token', {
            jwtKey: 'pem-public-key',
            authorizedParties: ['https://a.example.com', 'https://b.example.com'],
        });
        expect(claims.sub).toBe('user_1');
    });

    it('forwards an empty azp allowlist when the env var is unset (the shared verifier skips the azp check)', async () => {
        delete process.env['CLERK_AUTHORIZED_PARTIES'];
        mockVerify.mockResolvedValue({ sub: 'user_2', scopes: [], permissions: [] });

        await new ClerkAuthService().verify('t');

        expect(mockVerify).toHaveBeenCalledWith('t', { jwtKey: 'pem-public-key', authorizedParties: [] });
    });

    it('maps ANY verifier failure to an opaque 401 without leaking the reason', async () => {
        mockVerify.mockRejectedValue(new Error('bad signature: key fingerprint ab:cd mismatch'));

        const service = new ClerkAuthService();

        await expect(service.verify('t')).rejects.toBeInstanceOf(UnauthorizedException);
        // The 401 carries no detail from the underlying verification error.
        await expect(service.verify('t')).rejects.not.toThrow(/signature|fingerprint|key/);
    });
});
