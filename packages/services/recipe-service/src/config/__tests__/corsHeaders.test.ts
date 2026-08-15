/**
 * The CORS policy's OBSERVABLE BEHAVIOUR — the actual `Access-Control-Allow-*` headers a browser receives,
 * through the real `cors` middleware that Nest's `enableCors` installs (`ExpressAdapter.enableCors` is
 * `this.use(cors(options))`, so this exercises the production path, not a re-implementation of it).
 *
 * ⚠️ WHY THIS EXISTS SEPARATELY FROM `cors.test.ts`. The option VALUE and the emitted HEADER are not the same
 * claim, and the gap between them is where this module's two dangerous values hide. Measured on the installed
 * `cors@2.8.6`, for a request carrying `Origin: https://evil.example`:
 *
 * | `origin` | `Access-Control-Allow-Origin`    | `Vary`   | preflight        |
 * | -------- | -------------------------------- | -------- | ---------------- |
 * | `true`   | reflects `https://evil.example`  | `Origin` | `204`            |
 * | `false`  | absent                           | absent   | `200` + `Allow:` |
 * | `[]`     | absent                           | `Origin` | `204`            |
 *
 * `true` is the bug that shipped — an empty `CLERK_AUTHORIZED_PARTIES` list took that branch on sandbox and on
 * every `pr-{N}`, and the pre-fix version of this suite's first case FAILED with
 * `expected 'https://evil.example' to be null`.
 *
 * `false` is the inverse trap, and NOT for the reason usually repeated: `configureOrigin`'s
 * `if (!options.origin || options.origin === '*')` → `*` branch is unreachable for a falsy static option,
 * because `middlewareWrapper` calls `next()` before `cors()` ever runs. What `false` really does is take the
 * CORS middleware out of the request path — no `Vary: Origin`, and the preflight answered by Express's default
 * `OPTIONS` handler. So "closed" is asserted here as the `[]` SIGNATURE (`Vary: Origin` present, preflight
 * `204`, no allow-origin), which is what turns red if `[]` is ever "simplified" to `false`; a unit test on the
 * option object can see none of it.
 *
 * Runs in the DEFAULT unit tier on purpose (no database, no AWS, no Docker): a security gate must not live
 * behind a CI step that can skip.
 *
 * @module
 */
import 'reflect-metadata';

import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';

import { buildCorsPolicy, type CorsPolicyInput } from '../cors.js';

@Controller('probe')
class ProbeController {
    @Get()
    public read(): { ok: true } {
        return { ok: true };
    }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/** A throwaway Nest app whose CORS comes from `input`, plus its base URL. */
interface ProbeApp {
    readonly app: INestApplication;
    readonly baseUrl: string;
}

/**
 * Boot a throwaway Nest app whose CORS is configured from `input`.
 *
 * @param input - The environment configuration the policy is derived from.
 * @returns The running app and its base URL.
 * @sideEffect Listens on an ephemeral port; the caller must `close()`.
 */
async function bootWithPolicy(input: CorsPolicyInput): Promise<ProbeApp> {
    const app = await NestFactory.create(ProbeModule, { logger: false });

    app.enableCors(buildCorsPolicy(input).options);
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo;

    return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}

/**
 * Issue a CORS preflight for a JSON mutation from `origin`.
 *
 * @param baseUrl - The probe app's base URL.
 * @param origin - The `Origin` to preflight as.
 * @returns The preflight response.
 * @sideEffect Performs an HTTP request.
 */
function preflight(baseUrl: string, origin: string): Promise<Response> {
    return fetch(`${baseUrl}/probe`, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'authorization,content-type',
        },
    });
}

describe('CORS response headers — the deployed non-prod (preview-pattern) environment', () => {
    let probe: ProbeApp;

    // Exactly what infra injects on sandbox / pr-{N}: NO CLERK_AUTHORIZED_PARTIES, only CLERK_AZP_PATTERN.
    beforeAll(async () => {
        probe = await bootWithPolicy({
            nodeEnv: 'staging',
            authorizedPartiesRaw: undefined,
            previewBaseDomain: 'sandbox.commise.app',
            previewMode: undefined,
        });
    });

    afterAll(async () => {
        await probe?.app.close();
    });

    // ⛔ MUTATION GUARD: this is the regression. Restore `origin: true` for the empty-list case and this fails
    // with `expected 'https://evil.example' to be null`.
    it('sends NO allow-origin header for a foreign origin — the any-origin reflection is gone', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, { headers: { Origin: 'https://evil.example' } });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('refuses a foreign origin on the PREFLIGHT too, where the browser actually checks', async () => {
        const res = await preflight(probe.baseUrl, 'https://evil.example');

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('echoes a matching preview origin and allows credentials', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, {
            headers: { Origin: 'https://pr-73.sandbox.commise.app' },
        });

        expect(res.headers.get('access-control-allow-origin')).toBe('https://pr-73.sandbox.commise.app');
        expect(res.headers.get('access-control-allow-credentials')).toBe('true');
        expect(res.headers.get('vary')).toContain('Origin');
    });

    it('admits the Authorization + Content-Type + tracing headers on a matching preflight', async () => {
        const res = await preflight(probe.baseUrl, 'https://pr-1.sandbox.commise.app');

        expect(res.headers.get('access-control-allow-origin')).toBe('https://pr-1.sandbox.commise.app');
        expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
        expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
        expect(res.headers.get('access-control-allow-headers')).toContain('sentry-trace');
    });
});

describe('CORS response headers — the fail-CLOSED environment', () => {
    let probe: ProbeApp;

    // A deployed environment with neither selector. `config.types.ts` rejects this configuration at boot, so
    // this is the defence-in-depth branch: if it is ever reached it must deny — by decision, not by absence.
    beforeAll(async () => {
        probe = await bootWithPolicy({
            nodeEnv: 'production',
            authorizedPartiesRaw: undefined,
            previewBaseDomain: undefined,
            previewMode: undefined,
        });
    });

    afterAll(async () => {
        await probe?.app.close();
    });

    it('emits no allow-origin header at all — and specifically never `*`', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, { headers: { Origin: 'https://commise.app' } });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    // ⛔ MUTATION GUARD for `origin: []` → `origin: false`. Both omit allow-origin, so the assertion above
    // cannot tell them apart; only the middleware's PRESENCE can. `false` short-circuits `middlewareWrapper`
    // to `next()`, which leaves `Vary` unset.
    it('still runs the CORS middleware — a `Vary: Origin` denial, not a bypassed one', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, { headers: { Origin: 'https://commise.app' } });

        expect(res.headers.get('vary')).toContain('Origin');
    });

    // ⛔ MUTATION GUARD, second half: with `false` the preflight falls through to Express's default `OPTIONS`
    // handler, which answers `200` with an `Allow` header instead of a CORS `204`.
    it('answers the preflight itself with 204 and no Allow header', async () => {
        const res = await preflight(probe.baseUrl, 'https://commise.app');

        expect(res.status).toBe(204);
        expect(res.headers.get('allow')).toBeNull();
    });

    it('still serves the request itself — CORS is a browser-enforced boundary, not an authz check', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, { headers: { Origin: 'https://commise.app' } });

        expect(res.status).toBe(200);
    });
});

describe('CORS response headers — the prod (exact-list) environment', () => {
    let probe: ProbeApp;

    beforeAll(async () => {
        probe = await bootWithPolicy({
            nodeEnv: 'production',
            authorizedPartiesRaw: 'https://commise.app, https://www.commise.app',
            previewBaseDomain: undefined,
            previewMode: undefined,
        });
    });

    afterAll(async () => {
        await probe?.app.close();
    });

    it('echoes a listed origin', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, { headers: { Origin: 'https://www.commise.app' } });

        expect(res.headers.get('access-control-allow-origin')).toBe('https://www.commise.app');
    });

    it('refuses an unlisted origin, including a preview subdomain', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, {
            headers: { Origin: 'https://pr-73.sandbox.commise.app' },
        });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
});

describe('CORS response headers — the local (loopback) environment', () => {
    let probe: ProbeApp;

    beforeAll(async () => {
        probe = await bootWithPolicy({
            nodeEnv: 'development',
            authorizedPartiesRaw: undefined,
            previewBaseDomain: undefined,
            previewMode: undefined,
        });
    });

    afterAll(async () => {
        await probe?.app.close();
    });

    it('echoes the local web app origin', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, { headers: { Origin: 'http://localhost:3000' } });

        expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    });

    // ⛔ MUTATION GUARD for the loopback matcher's `$` anchor: an unanchored pattern admits this host.
    it('refuses a look-alike host that merely starts with localhost', async () => {
        const res = await fetch(`${probe.baseUrl}/probe`, {
            headers: { Origin: 'http://localhost.evil.example' },
        });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
});
