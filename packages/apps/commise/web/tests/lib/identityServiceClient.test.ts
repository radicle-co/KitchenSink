/**
 * The web app's identity client sends no cookies: identity authenticates by bearer only and reads no cookie
 * (`packages/services/identity/src/config/cors.ts`), so `credentials: 'include'` would hand an admitted origin ambient
 * credentials for nothing, and would force identity and the edge to grant credentials (ADR-0047).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileServiceClient } from '@/lib/identityServiceClient';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('createProfileServiceClient', () => {
    it('sends the bearer and leaves the request credentials at the browser default', async () => {
        const sent: RequestInit[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: string, init: RequestInit) => {
                sent.push(init);
                throw new TypeError('the network is down');
            }),
        );

        await expect(createProfileServiceClient('token-1').getMe()).rejects.toBeDefined();

        expect(sent).toHaveLength(1);
        expect(new Headers(sent[0]?.headers).get('authorization')).toBe('Bearer token-1');
        expect(sent[0]?.credentials).toBeUndefined();
    });
});
