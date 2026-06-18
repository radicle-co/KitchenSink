import { describe, expect, it, vi } from 'vitest';

import { buildOriginUpdate, parsePrKey, resolveRoute } from '../src/resolve';

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

describe('resolveRoute', () => {
    const map: Record<string, string> = { 'pr-123': 'my-app-abc.vercel.app' };
    const getHost = (key: string) => Promise.resolve(map[key]);

    it('routes a known PR to its host, URI unchanged (host-swap only)', async () => {
        const decision = await resolveRoute('/pr-123/profile?_rsc=abc', getHost);

        expect(decision).toEqual({ kind: 'origin', host: 'my-app-abc.vercel.app' });
        // The caller forwards request.uri verbatim — this function never rewrites the path.
    });

    it('404s an unknown/closed PR without consulting the origin', async () => {
        const spy = vi.fn(getHost);

        expect(await resolveRoute('/pr-999/profile', spy)).toEqual({ kind: 'notfound' });
        expect(spy).toHaveBeenCalledWith('pr-999');
    });

    it('404s a malformed path before any lookup', async () => {
        const spy = vi.fn(getHost);

        expect(await resolveRoute('/', spy)).toEqual({ kind: 'notfound' });
        expect(await resolveRoute('/notapr/x', spy)).toEqual({ kind: 'notfound' });
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
