/**
 * The browser Sentry config keeps ONE release-health session per document load.
 *
 * The SDK's default `browserSessionIntegration` uses `lifecycle: 'route'`: every history write that changes the address
 * ends the session and starts a new one. In this app a history write is not a visit — Next writes the address on
 * hydration, Clerk strips its ticket and handshake parameters, and Discover writes its criteria on each keystroke — so a
 * sandbox load of `/en/discover` sent a chain of session envelopes, each new `sid` starting when the last one ended.
 *
 * This runs the REAL browser SDK over the real config, so it proves the override takes effect (a user integration
 * replaces the default of the same name), not just that the config mentions it.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import * as Sentry from '@sentry/nextjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Vitest resolves `@sentry/nextjs` with the `node` condition, which is the SERVER SDK. The browser build is the one
// `instrumentation-client.ts` runs in, so the test loads it from beside the resolved entry.
vi.mock('@sentry/nextjs', async () => {
    const serverEntry = createRequire(import.meta.url).resolve('@sentry/nextjs');
    const clientEntry = join(dirname(serverEntry), '..', 'esm', 'index.client.js');

    return vi.importActual(clientEntry);
});

describe('instrumentation-client', () => {
    beforeAll(async () => {
        vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/1');
        // A sent envelope must not reach the network.
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
        await import('../instrumentation-client');
    });

    afterAll(async () => {
        await Sentry.close();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('keeps the page-load session across address changes', () => {
        const started = Sentry.getIsolationScope().getSession()?.sid;

        expect(started).toEqual(expect.any(String));

        window.history.replaceState(null, '', '/en/discover');
        window.history.replaceState(null, '', '/en/discover?query=soup');
        window.history.pushState(null, '', '/en/recipes/1');

        expect(Sentry.getIsolationScope().getSession()?.sid).toBe(started);
    });

    it('keeps the default error capture', () => {
        const client = Sentry.getClient();

        expect(client?.getIntegrationByName('GlobalHandlers')).toBeDefined();
        expect(client?.getIntegrationByName('BrowserSession')).toBeDefined();
    });
});
