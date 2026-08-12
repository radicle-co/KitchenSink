/**
 * The CORS policy's OBSERVABLE BEHAVIOUR — the actual `Access-Control-Allow-*` headers a browser receives,
 * through the real `cors` middleware Nest's `enableCors` installs.
 *
 * ⚠️ WHY THIS EXISTS SEPARATELY FROM `tests/cors.test.ts`. The option value and the emitted header are NOT
 * the same claim, and the gap between them is a live trap. `cors@2.8.6`'s `configureOrigin` begins:
 *
 * ```js
 * if (!options.origin || options.origin === '*') {
 *     headers.push([{ key: 'Access-Control-Allow-Origin', value: '*' }]);
 * }
 * ```
 *
 * So `origin: false` — the intuitive spelling of "deny everything" — emits `Access-Control-Allow-Origin: *`.
 * Only a value that reaches the third branch (an ARRAY, matched by `isOriginAllowed`) can omit the header, and
 * an empty array is how "closed" is expressed. A unit test on the option object cannot see any of that; this
 * one asserts the header itself, so a future "simplification" of `[]` to `false` turns the suite red instead
 * of turning the service into an any-origin reflector.
 *
 * Runs in the DEFAULT test tier on purpose (no database, no AWS): identity's e2e job is gated on
 * `steps.secrets.outcome == 'success'` in `.github/workflows/_ci.yml`, and a security gate must not live
 * behind a step that can skip.
 *
 * @module
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';

import { buildCorsPolicy, type CorsPolicyInput } from '../src/config/cors.js';

@Controller('probe')
class ProbeController {
    @Get()
    public read(): { ok: true } {
        return { ok: true };
    }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/** Boot a throwaway Nest app whose CORS is configured from `input`, and return its base URL + closer. */
async function bootWithPolicy(input: CorsPolicyInput): Promise<{ app: INestApplication; baseUrl: string }> {
    const app = await NestFactory.create(ProbeModule, { logger: false });

    app.enableCors(buildCorsPolicy(input).options);
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;

    return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('CORS response headers — the deployed non-prod (pattern) policy', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
        ({ app, baseUrl } = await bootWithPolicy({
            stage: 'sandbox',
            authorizedPartiesRaw: undefined,
            previewBaseDomain: 'sandbox.commise.app',
            previewMode: undefined,
        }));
    });

    afterAll(async () => {
        await app?.close();
    });

    it('echoes a matching preview origin and allows credentials', async () => {
        const res = await fetch(`${baseUrl}/probe`, { headers: { Origin: 'https://pr-73.sandbox.commise.app' } });

        expect(res.headers.get('access-control-allow-origin')).toBe('https://pr-73.sandbox.commise.app');
        expect(res.headers.get('access-control-allow-credentials')).toBe('true');
        expect(res.headers.get('vary')).toContain('Origin');
    });

    it('sends NO allow-origin header for a foreign origin — and specifically not `*`', async () => {
        const res = await fetch(`${baseUrl}/probe`, { headers: { Origin: 'https://evil.example' } });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('refuses a foreign origin on the PREFLIGHT too, where the browser actually checks', async () => {
        const res = await fetch(`${baseUrl}/probe`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://evil.example',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'authorization',
            },
        });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('admits the Authorization + tracing headers on a matching preflight', async () => {
        const res = await fetch(`${baseUrl}/probe`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://pr-1.sandbox.commise.app',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'authorization,sentry-trace',
            },
        });

        expect(res.headers.get('access-control-allow-origin')).toBe('https://pr-1.sandbox.commise.app');
        expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
        expect(res.headers.get('access-control-allow-headers')).toContain('sentry-trace');
    });
});

describe('CORS response headers — the fail-CLOSED policy', () => {
    let app: INestApplication;
    let baseUrl: string;

    // A deployed stage with neither selector. `env.schema.ts` rejects this configuration at boot, so this is
    // the defence-in-depth branch: if it is ever reached, it must deny — not reflect, and NOT `*`.
    beforeAll(async () => {
        ({ app, baseUrl } = await bootWithPolicy({
            stage: 'sandbox',
            authorizedPartiesRaw: undefined,
            previewBaseDomain: undefined,
            previewMode: undefined,
        }));
    });

    afterAll(async () => {
        await app?.close();
    });

    // ⛔ MUTATION GUARD: change `origin: []` to `origin: false` in `src/config/cors.ts` and this test fails
    // with `'*'`, which is the whole reason it is written at the header level.
    it('emits no allow-origin header at all — never the `*` that `origin: false` would produce', async () => {
        const res = await fetch(`${baseUrl}/probe`, { headers: { Origin: 'https://commise.app' } });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('still serves the request itself — CORS is a browser-enforced boundary, not an authz check', async () => {
        const res = await fetch(`${baseUrl}/probe`, { headers: { Origin: 'https://commise.app' } });

        expect(res.status).toBe(200);
    });
});
