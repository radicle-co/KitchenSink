import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyToken = vi.fn();

vi.mock('@clerk/backend', () => ({
    verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

const JWT_KEY = '-----BEGIN PUBLIC KEY-----\nMIIBfake\n-----END PUBLIC KEY-----';

async function makeService() {
    const { ClerkAuthService } = await import('../src/auth/clerkAuth.service.js');

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
        delete process.env['CLERK_ADMIT_NATIVE_CLIENT'];
        delete process.env['CLERK_JWT_KEY'];
        delete process.env['CLERK_AUTHORIZED_PARTIES'];
        delete process.env['CLERK_AZP_PATTERN'];
        delete process.env['CLERK_AZP_PREVIEW_MODE'];
    });

    // Uses the BARE-payload shape @clerk/backend (>= 1.34) actually resolves on success — the regression
    // guard for the bug where the wrapper only read `result.data` and 401'd every valid token. Other
    // cases below keep the legacy `{ data }` envelope to prove cross-version back-compat.
    it('returns mapped claims for a valid token (bare-payload runtime shape)', async () => {
        mockVerifyToken.mockResolvedValueOnce({
            sub: 'user_abc123',
            azp: 'https://commise.app',
            email: 'new@example.com',
            first_name: 'Ada',
            last_name: 'Lovelace',
            image_url: 'https://img.example/a.png',
        });

        const service = await makeService();
        const claims = await service.verify('Bearer.token.value');

        expect(claims).toEqual({
            sub: 'user_abc123',
            // Surfaced by the verifier (it always has); asserted here because this case is exact-match.
            azp: 'https://commise.app',
            userId: undefined,
            email: 'new@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            picture: 'https://img.example/a.png',
            scopes: [],
            permissions: [],
        });
    });

    it('reads scopes/permissions from the public_metadata claim (the session-token template shape)', async () => {
        mockVerifyToken.mockResolvedValueOnce({
            data: {
                sub: 'user_admin',
                azp: 'https://commise.app',
                email: 'admin@example.com',
                first_name: 'Ad',
                last_name: 'Min',
                public_metadata: { scopes: ['admin:users'], permissions: ['admin:users', 'billing:read'] },
            },
        });

        const service = await makeService();
        const claims = await service.verify('t');

        expect(claims.scopes).toEqual(['admin:users']);
        expect(claims.permissions).toEqual(['admin:users', 'billing:read']);
        expect(claims.email).toBe('admin@example.com');
    });

    it('ignores top-level scopes/permissions — grants come ONLY from public_metadata', async () => {
        // Security: a top-level claim must NOT confer privilege. A future session-token template could
        // map a top-level claim from user-editable unsafe_metadata → self-elevation. Only the
        // backend-controlled public_metadata is trusted.
        mockVerifyToken.mockResolvedValueOnce({
            data: {
                sub: 'user_admin',
                azp: 'https://commise.app',
                scopes: ['admin:users'],
                permissions: ['admin:users', 'billing:read'],
            },
        });

        const service = await makeService();
        const claims = await service.verify('t');

        expect(claims.scopes).toEqual([]);
        expect(claims.permissions).toEqual([]);
    });

    it('defaults scopes to empty for a non-array claim and filters non-strings from public_metadata', async () => {
        mockVerifyToken.mockResolvedValueOnce({
            data: {
                sub: 'user_x',
                azp: 'https://commise.app',
                public_metadata: { scopes: 'admin:users', permissions: [1, 'ok', null] },
            },
        });

        const service = await makeService();
        const claims = await service.verify('t');

        expect(claims.scopes).toEqual([]); // string, not array → ignored
        expect(claims.permissions).toEqual(['ok']); // non-strings filtered out
    });

    // REWRITTEN (2026-09-02): this pinned the DELEGATION — forwarding the party list so `@clerk/backend`
    // owned the azp decision. That contract is gone: 3.16.12 rejects an absent `azp` against a list
    // (1.34 returned early), which 401'd every azp-less native token, so `clerk-verify` now enforces azp
    // itself in BOTH modes and never forwards the list. The coverage moved with it — the two cases below
    // assert the boundary this service actually depends on now.
    it('never forwards authorizedParties to the SDK — azp is enforced by clerk-verify itself', async () => {
        mockVerifyToken.mockResolvedValueOnce({ data: { sub: 'user_x', azp: 'https://commise.app' } });

        const service = await makeService();
        await service.verify('t');

        expect(mockVerifyToken).toHaveBeenCalledWith('t', { jwtKey: JWT_KEY, authorizedParties: undefined });
    });

    it('list mode still REJECTS an azp outside the configured parties', async () => {
        mockVerifyToken.mockResolvedValueOnce({ data: { sub: 'user_x', azp: 'https://evil.example.com' } });

        const service = await makeService();

        await expect(service.verify('t')).rejects.toThrow();
    });

    it('list mode ADMITS an azp-less native token when the stage sets CLERK_ADMIT_NATIVE_CLIENT', async () => {
        // The prod-parity case (owner ruling 2026-09-02): every stage now carries this gate, because a
        // native (@clerk/expo) token has no `azp` at all and would otherwise 401 on this service.
        process.env['CLERK_ADMIT_NATIVE_CLIENT'] = 'true';
        mockVerifyToken.mockResolvedValueOnce({ data: { sub: 'mobile_user', client_type: 'native' } });

        const service = await makeService();

        await expect(service.verify('t')).resolves.toMatchObject({ sub: 'mobile_user' });
        delete process.env['CLERK_ADMIT_NATIVE_CLIENT'];
    });

    it('returns undefined email/name when custom claims are absent', async () => {
        mockVerifyToken.mockResolvedValueOnce({ data: { sub: 'user_no_claims', azp: 'https://commise.app' } });

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

    // ── ADR-0001 subdomain-cutover wiring: CLERK_AZP_PREVIEW_MODE threads into the shared resolver ──
    describe('azp preview-mode wiring (subdomain cutover)', () => {
        beforeEach(() => {
            // Pattern mode: the base domain drives a self-enforced azp pattern; the list is unset.
            delete process.env['CLERK_AUTHORIZED_PARTIES'];
            process.env['CLERK_AZP_PATTERN'] = 'sandbox.commise.app';
        });

        it('accepts the path-routed apex origin under CLERK_AZP_PREVIEW_MODE=transition (no in-flight 401)', async () => {
            process.env['CLERK_AZP_PREVIEW_MODE'] = 'transition';
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://sandbox.commise.app' });

            const service = await makeService();
            const claims = await service.verify('t');

            expect(claims.sub).toBe('u');
            // Pattern mode enforces azp itself, so the SDK azp check is skipped.
            expect(mockVerifyToken).toHaveBeenCalledWith('t', { jwtKey: JWT_KEY, authorizedParties: undefined });
        });

        it('accepts a per-PR subdomain origin under transition mode', async () => {
            process.env['CLERK_AZP_PREVIEW_MODE'] = 'transition';
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://pr-42.sandbox.commise.app' });

            const service = await makeService();
            await expect(service.verify('t')).resolves.toMatchObject({ sub: 'u' });
        });

        it('REJECTS the apex origin in strict mode (CLERK_AZP_PREVIEW_MODE unset) — subdomains only', async () => {
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://sandbox.commise.app' });

            const service = await makeService();
            await expect(service.verify('t')).rejects.toMatchObject({ status: 401 });
        });

        it('still accepts a per-PR subdomain in strict mode', async () => {
            mockVerifyToken.mockResolvedValueOnce({ sub: 'u', azp: 'https://pr-42.sandbox.commise.app' });

            const service = await makeService();
            await expect(service.verify('t')).resolves.toMatchObject({ sub: 'u' });
        });
    });
});
