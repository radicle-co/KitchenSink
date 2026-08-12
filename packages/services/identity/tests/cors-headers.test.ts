/**
 * The CORS policy's OBSERVABLE BEHAVIOUR — the actual `Access-Control-Allow-*` headers a browser receives,
 * through the real `cors` middleware Nest's `enableCors` installs.
 *
 * ⚠️ WHY THIS EXISTS SEPARATELY FROM `tests/cors.test.ts`. The option value and the emitted header are NOT
 * the same claim, and the gap between them is a live trap — though NOT the one this file used to describe.
 * `cors@2.8.6`'s `configureOrigin` does open with
 * `if (!options.origin || options.origin === '*')` → `Access-Control-Allow-Origin: *`, but that branch is
 * UNREACHABLE for a falsy static option: the package's `middlewareWrapper` tests `corsOptions.origin` first
 * and calls `next()` without touching a header when it is falsy, so `cors()` — and therefore
 * `configureOrigin` — never runs. MEASURED here, by booting the real Nest app below with each option value
 * (`ExpressAdapter.enableCors` is `this.use(cors(options))`, so this is the deployed path):
 *
 * | `origin`  | `Access-Control-Allow-Origin`    | `Vary`   | preflight |
 * | --------- | -------------------------------- | -------- | --------- |
 * | `true`    | reflects `https://evil.example`  | `Origin` | `204`     |
 * | `false`   | absent                           | absent   | `404`     |
 * | `[]`      | absent                           | `Origin` | `204`     |
 *
 * So `false` is not an open door — it is a SILENT BYPASS: the CORS middleware leaves the request path
 * entirely, and the denial becomes an accident of absence rather than this policy's decision (no
 * `Vary: Origin` for caches, and the preflight left to whatever the router does with an unrouted `OPTIONS`).
 * An empty list keeps the middleware IN the path and denies by FAILING THE MATCH.
 *
 * ⚠️ The bypassed preflight's status is the ROUTER's fallback, not a CORS behaviour, so it differs by app:
 * `404` here (this module's probe app declares only a `GET`), where `packages/services/recipe-service`
 * measured `200` + `Allow:`. Do not "reconcile" the two tables — neither is wrong, and the guard below keys
 * on the POSITIVE `204` that CORS itself produces, which holds in both.
 *
 * ⛔ THAT is why the closed-policy suite below asserts `Vary: Origin` and the `204`, not just the absence of
 * `Access-Control-Allow-Origin`. Absence is what BOTH values produce, so an absence-only assertion cannot
 * tell them apart — and it did not: swapping `[]` for `false` left this suite fully green. The `Vary` + `204`
 * pair is the observable difference, and it is what turns red now.
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

    it('emits no allow-origin header at all, for an origin no rule admits', async () => {
        const res = await fetch(`${baseUrl}/probe`, { headers: { Origin: 'https://commise.app' } });

        expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    // ⛔ MUTATION GUARD (1 of 2). Absence of `Access-Control-Allow-Origin` is what `[]` AND `false` both
    // produce, so the assertion above cannot tell them apart. `Vary: Origin` can: `cors` only emits it from
    // `configureOrigin`'s list branch, which a falsy `origin` never reaches because `middlewareWrapper`
    // short-circuits to `next()` first. Change `origin: []` to `false` in `src/config/cors.ts` and this reds.
    it('keeps the CORS middleware IN the path — `Vary: Origin` proves the denial was a decision', async () => {
        const res = await fetch(`${baseUrl}/probe`, { headers: { Origin: 'https://commise.app' } });

        expect(res.headers.get('vary')).toContain('Origin');
    });

    // ⛔ MUTATION GUARD (2 of 2). The preflight is where a browser actually checks, and WHO answers it
    // changes with the option: `cors` replies `204` (its `optionsSuccessStatus`) because it short-circuits
    // the request itself, whereas a bypassed middleware calls `next()` and leaves the router to handle an
    // `OPTIONS` it has no route for (measured: `404`). Asserted as the POSITIVE 204 rather than as the
    // bypass's status, because that status is the router's business and can change without this policy's.
    it('answers the preflight from CORS itself — a 204, not the router`s unrouted-OPTIONS fallback', async () => {
        const res = await fetch(`${baseUrl}/probe`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://commise.app',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'authorization',
            },
        });

        expect(res.status).toBe(204);
    });

    it('still serves the request itself — CORS is a browser-enforced boundary, not an authz check', async () => {
        const res = await fetch(`${baseUrl}/probe`, { headers: { Origin: 'https://commise.app' } });

        expect(res.status).toBe(200);
    });
});
