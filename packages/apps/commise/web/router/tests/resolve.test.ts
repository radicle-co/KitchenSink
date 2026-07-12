import { describe, expect, it, vi } from 'vitest';

import { buildOriginUpdate, parsePrKey, parsePrKeyFromHost, resolveRoute } from '../src/resolve';

describe('parsePrKey', () => {
    it('extracts pr-{N} from a deep path', () => {
        expect(parsePrKey('/pr-123/profile')).toBe('pr-123');
    });

    it('extracts pr-{N} from the bare prefix root (no trailing path)', () => {
        expect(parsePrKey('/pr-123')).toBe('pr-123');
    });

    it('returns null for paths with no PR segment', () => {
        expect(parsePrKey('/')).toBeNull();
        expect(parsePrKey('/profile')).toBeNull();
        expect(parsePrKey('/notapr/x')).toBeNull();
    });
});

describe('parsePrKeyFromHost (subdomain routing — the migration target)', () => {
    it('extracts pr-{N} from a leftmost pr-{N} label', () => {
        expect(parsePrKeyFromHost('pr-123.sandbox.commise.app')).toBe('pr-123');
    });

    it('is case-insensitive on the host (DNS is case-insensitive) and drops the port', () => {
        expect(parsePrKeyFromHost('PR-123.sandbox.commise.app')).toBe('pr-123');
        expect(parsePrKeyFromHost('pr-123.sandbox.commise.app:443')).toBe('pr-123');
    });

    it('returns null for the bare apex and any non-pr leftmost label', () => {
        expect(parsePrKeyFromHost('sandbox.commise.app')).toBeNull(); // apex (path-routed origin)
        expect(parsePrKeyFromHost('staging.sandbox.commise.app')).toBeNull();
        expect(parsePrKeyFromHost('pr-.sandbox.commise.app')).toBeNull(); // no digits
        expect(parsePrKeyFromHost('pr-4x.sandbox.commise.app')).toBeNull(); // non-digit label
        expect(parsePrKeyFromHost('')).toBeNull();
        expect(parsePrKeyFromHost(undefined)).toBeNull();
    });

    it('requires the pr-{N} label to be a full leftmost label, not a prefix of one', () => {
        // "pr-123-x.sandbox…" is a different single label, not PR 123.
        expect(parsePrKeyFromHost('pr-123-x.sandbox.commise.app')).toBeNull();
    });
});

describe('resolveRoute', () => {
    const map: Record<string, string> = { 'pr-123': 'my-app-abc.vercel.app' };
    const getHost = (key: string) => Promise.resolve(map[key]);

    it('routes a path-prefixed request to its host, URI unchanged (path routing — pre-cutover)', async () => {
        const decision = await resolveRoute({ uri: '/pr-123/profile?_rsc=abc' }, getHost);

        expect(decision).toEqual({ kind: 'origin', host: 'my-app-abc.vercel.app' });
        // The caller forwards request.uri verbatim — this function never rewrites the path.
    });

    it('routes a pr-{N} SUBDOMAIN request by Host, URI unchanged (subdomain routing — post-cutover)', async () => {
        const decision = await resolveRoute({ uri: '/profile', host: 'pr-123.sandbox.commise.app' }, getHost);

        expect(decision).toEqual({ kind: 'origin', host: 'my-app-abc.vercel.app' });
    });

    it('prefers the Host key over the path key when BOTH are present (transition determinism)', async () => {
        const spy = vi.fn(getHost);

        // A subdomain request that also carries a /pr-999 path must resolve by host (pr-123), not path.
        await resolveRoute({ uri: '/pr-999/x', host: 'pr-123.sandbox.commise.app' }, spy);

        expect(spy).toHaveBeenCalledWith('pr-123');
        expect(spy).not.toHaveBeenCalledWith('pr-999');
    });

    it('falls back to the path key when the Host is the bare apex (path-routed preview during cutover)', async () => {
        const decision = await resolveRoute({ uri: '/pr-123/profile', host: 'sandbox.commise.app' }, getHost);

        expect(decision).toEqual({ kind: 'origin', host: 'my-app-abc.vercel.app' });
    });

    it('404s an unknown/closed PR without consulting the origin', async () => {
        const spy = vi.fn(getHost);

        expect(await resolveRoute({ uri: '/pr-999/profile' }, spy)).toEqual({ kind: 'notfound' });
        expect(spy).toHaveBeenCalledWith('pr-999');
    });

    it('404s a malformed request (no PR in host or path) before any lookup', async () => {
        const spy = vi.fn(getHost);

        expect(await resolveRoute({ uri: '/', host: 'sandbox.commise.app' }, spy)).toEqual({ kind: 'notfound' });
        expect(await resolveRoute({ uri: '/notapr/x' }, spy)).toEqual({ kind: 'notfound' });
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('buildOriginUpdate', () => {
    it('uses customOriginConfig (https/443) + hostHeader, not the top-level originSslProtocols field', () => {
        const update = buildOriginUpdate('app-abc.vercel.app');

        expect(update).toEqual({
            domainName: 'app-abc.vercel.app',
            customOriginConfig: { port: 443, protocol: 'https', sslProtocols: ['TLSv1.2'] },
            hostHeader: 'app-abc.vercel.app',
        });
        expect(update).not.toHaveProperty('originSslProtocols');
    });
});
