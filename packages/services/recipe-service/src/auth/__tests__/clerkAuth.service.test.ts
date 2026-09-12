/**
 * Unit tests for the recipe service's `ClerkAuthService` — networkless Clerk token verification.
 *
 * `@clerk/backend`'s `verifyToken` is mocked so the REAL shared `@kitchensink/clerk-verify` chain
 * (`resolveAzpEnforcement` → `verifyClerkToken`) runs: this pins the service's azp wiring, including the
 * ADR-0001 subdomain-cutover selector `CLERK_AZP_PREVIEW_MODE` that threads into the shared resolver.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyToken = vi.fn();

vi.mock('@clerk/backend', () => ({
    verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

const JWT_KEY = '-----BEGIN PUBLIC KEY-----\nMIIBfake\n-----END PUBLIC KEY-----';

async function makeService() {
    const { ClerkAuthService } = await import('../clerkAuth.service.js');

    return new ClerkAuthService();
}

describe('ClerkAuthService (recipe-service)', () => {
    beforeEach(() => {
        vi.resetModules();
        mockVerifyToken.mockReset();
        process.env['CLERK_JWT_KEY'] = JWT_KEY;
    });

    afterEach(() => {
        delete process.env['CLERK_JWT_KEY'];
        delete process.env['CLERK_AUTHORIZED_PARTIES'];
        delete process.env['CLERK_AZP_PATTERN'];
        delete process.env['CLERK_AZP_PREVIEW_MODE'];
        delete process.env['CLERK_ADMIT_NATIVE_CLIENT'];
    });

    // REWRITTEN (2026-09-02): this pinned the DELEGATION — forwarding the parsed list so `@clerk/backend`
    // owned the azp decision in list mode. That contract is gone: 3.16.12 rejects an absent `azp` against
    // a list (1.34 returned early), 401ing every azp-less native token, so `clerk-verify` enforces azp
    // itself in BOTH modes now and forwards nothing. The list is still PARSED and still decides — this
    // asserts where, plus the two outcomes that parsing exists for.
    it('parses the exact-match azp allowlist and enforces it ITSELF (nothing forwarded to the SDK)', async () => {
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://commise.app, https://app.commise.app';
        mockVerifyToken.mockResolvedValueOnce({
            sub: 'user_x',
            azp: 'https://app.commise.app',
            external_id: '01HZY0OWNERULID0000000000',
        });

        await (await makeService()).verify('t');

        expect(mockVerifyToken).toHaveBeenCalledWith('t', { jwtKey: JWT_KEY, authorizedParties: undefined });
    });

    it('list mode rejects an azp outside the parsed allowlist', async () => {
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://commise.app, https://app.commise.app';
        mockVerifyToken.mockResolvedValueOnce({ sub: 'user_x', azp: 'https://evil.example.com' });

        await expect((await makeService()).verify('t')).rejects.toThrow();
    });

    it('list mode admits an azp-less NATIVE token when the stage sets CLERK_ADMIT_NATIVE_CLIENT', async () => {
        // Every stage carries this gate now (owner ruling 2026-09-02) — prod included, since the mobile
        // app calls this service directly with a token that has no `azp` at all.
        process.env['CLERK_AUTHORIZED_PARTIES'] = 'https://commise.app';
        process.env['CLERK_ADMIT_NATIVE_CLIENT'] = 'true';
        mockVerifyToken.mockResolvedValueOnce({
            sub: 'mobile_user',
            client_type: 'native',
            external_id: '01HZY0OWNERULID0000000000',
        });

        await expect((await makeService()).verify('t')).resolves.toMatchObject({ sub: 'mobile_user' });
    });

    describe('azp preview-mode wiring (ADR-0001 subdomain cutover)', () => {
        beforeEach(() => {
            // Pattern mode: base domain drives a self-enforced azp pattern; the exact-match list is unset.
            delete process.env['CLERK_AUTHORIZED_PARTIES'];
            process.env['CLERK_AZP_PATTERN'] = 'sandbox.commise.app';
        });

        it('skips the SDK azp check in pattern mode (authorizedParties undefined)', async () => {
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://pr-1.sandbox.commise.app' });

            await (await makeService()).verify('t');

            expect(mockVerifyToken).toHaveBeenCalledWith('t', { jwtKey: JWT_KEY, authorizedParties: undefined });
        });

        it('accepts the path-routed apex origin under CLERK_AZP_PREVIEW_MODE=transition', async () => {
            process.env['CLERK_AZP_PREVIEW_MODE'] = 'transition';
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://sandbox.commise.app' });

            await expect((await makeService()).verify('t')).resolves.toMatchObject({ sub: 'u' });
        });

        it('accepts a per-PR subdomain origin under transition mode', async () => {
            process.env['CLERK_AZP_PREVIEW_MODE'] = 'transition';
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://pr-42.sandbox.commise.app' });

            await expect((await makeService()).verify('t')).resolves.toMatchObject({ sub: 'u' });
        });

        it('REJECTS the apex origin in strict mode (CLERK_AZP_PREVIEW_MODE unset) — subdomains only', async () => {
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://sandbox.commise.app' });

            await expect((await makeService()).verify('t')).rejects.toMatchObject({ status: 401 });
        });

        it('still accepts a per-PR subdomain in strict mode', async () => {
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://pr-42.sandbox.commise.app' });

            await expect((await makeService()).verify('t')).resolves.toMatchObject({ sub: 'u' });
        });
    });
});
