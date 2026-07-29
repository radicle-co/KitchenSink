/**
 * T029/T067 — e2e proof of the ingredient async-resolution surface through the fully ASSEMBLED recipe app
 * (`ThrottlerModule` + global guard, `AuthMiddleware`, `ApiExceptionFilter`, `ParseUUIDPipe`, real HTTP)
 * via `bootRecipeApp`. It pins the client-visible HTTP contract of the poll/candidates/resolve routes: the
 * status codes and shapes a caller actually receives.
 *
 * The external food service (003) is NOT running in the harness, so these specs deliberately drive the
 * branches that need NO food-service call — a FREEFORM (user-entered) ingredient has no linked food, so
 * `status` returns it unchanged, `candidates` is empty, and `resolve` is a no-op — plus the boundary cases
 * (missing ingredient → 404, malformed id → 400, empty `candidateIds` → 400). The food-backed happy path
 * (poll → RESOLVED with nutrition, resolve from a candidate) is proven where the food client is stubbable:
 * the service unit tests and the disambiguation integration spec. Skips when no test database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];

const CALLER = '01JINGE2E00000CALLER00000A';
const FREEFORM_NAME = 'E2E disambiguation freeform spice';
const MISSING_ID = '00000000-0000-4000-8000-0000000000ff';

describe.skipIf(!hasDatabaseUrl)('ingredient async-resolution surface (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: CALLER });
        pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    });

    afterAll(async () => {
        await pool.query('DELETE FROM ingredients WHERE lower(name) = lower($1)', [FREEFORM_NAME]);
        await pool.end();
        await booted?.close();
    });

    /** Create the shared freeform ingredient over HTTP and return its id. */
    async function createFreeform(): Promise<string> {
        const res = await fetch(`${booted.baseUrl}/v1/ingredients`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: FREEFORM_NAME }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as { id: string; isUserEntered: boolean };
        expect(body.isUserEntered).toBe(true);

        return body.id;
    }

    it('GET /{id}/status on a freeform ingredient returns it unchanged (200, no food call)', async () => {
        const id = await createFreeform();

        const res = await fetch(`${booted.baseUrl}/v1/ingredients/${id}/status`);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { id: string; foodResolutionStatus?: string };
        expect(body.id).toBe(id);
        expect(body.foodResolutionStatus).toBeUndefined();
    });

    it('GET /{id}/candidates on a freeform ingredient is an empty list (200)', async () => {
        const id = await createFreeform();

        const res = await fetch(`${booted.baseUrl}/v1/ingredients/${id}/candidates`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
    });

    it('POST /{id}/resolve on a freeform ingredient is a no-op that returns it (200)', async () => {
        const id = await createFreeform();

        const res = await fetch(`${booted.baseUrl}/v1/ingredients/${id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ candidateIds: ['cand-1'] }),
        });

        expect(res.status).toBe(200);
        expect(((await res.json()) as { id: string }).id).toBe(id);
    });

    it('POST /{id}/resolve with an empty candidateIds is a 400', async () => {
        const id = await createFreeform();

        const res = await fetch(`${booted.baseUrl}/v1/ingredients/${id}/resolve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ candidateIds: [] }),
        });

        expect(res.status).toBe(400);
    });

    it('POST /by-name with a blank name is a 400 (route is mounted; validated BEFORE any food call)', async () => {
        // The food service (003) is not in the harness, so the 202 happy path is proven at the unit +
        // integration tiers (where the food client is stubbable). Here we pin that the async-resolution ENTRY
        // POINT is actually wired into the assembled app: a mounted route validates a blank name to 400 (a
        // MISSING route would 404), and validation short-circuits before the un-stubbed food client is touched.
        const res = await fetch(`${booted.baseUrl}/v1/ingredients/by-name`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: '   ' }),
        });

        expect(res.status).toBe(400);
    });

    // ── Search Stage 2 — the blended typeahead + the catalog pick ─────────────────────────────────────
    //
    // These exercise F2 through the real assembled app with a genuinely absent food service (`FOOD_SERVICE_URL`
    // points at a port nothing listens on — see `harness.ts`), not a stub pretending to be one.
    //
    // Two degradations reach the same honest outcome here, and it is worth knowing WHICH: the harness
    // authenticates via the dev-auth bypass, so requests carry NO bearer, and since issue #120 recipe calls
    // food AS THE CALLER. With no credential to forward, `FoodCatalogGateway` degrades WITHOUT issuing a
    // request — so what these assert is "the client-visible contract holds when the catalog cannot
    // contribute", which is the point. The transport-timeout half of F2 is proven where a real bearer and a
    // real (hung, then real) HTTP server are available: the ingredient integration specs.

    it('GET /suggest still returns 200 with the LOCAL section when the food service is ABSENT (F2)', async () => {
        await createFreeform();

        const res = await fetch(`${booted.baseUrl}/v1/ingredients/suggest?q=${encodeURIComponent(FREEFORM_NAME)}`);

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            suggestions: { provenance: string; ingredient?: { id: string; name: string } }[];
            catalogAvailability: string;
        };
        // The catalog could not contribute — reported honestly, NOT as a failure…
        expect(body.catalogAvailability).toBe('unavailable');
        // …and the recipe-local section rendered in full anyway. This is the whole point of F2: a down food
        // service costs the caller the catalog section, never the typeahead.
        expect(body.suggestions.length).toBeGreaterThan(0);
        expect(body.suggestions.every((suggestion) => suggestion.provenance === 'local')).toBe(true);
        expect(body.suggestions.some((suggestion) => suggestion.ingredient?.name === FREEFORM_NAME)).toBe(true);
    });

    it('GET /suggest degrades within a BOUNDED time (never the 8s default, whichever degradation applies)', async () => {
        const startedAt = Date.now();

        const res = await fetch(`${booted.baseUrl}/v1/ingredients/suggest?q=${encodeURIComponent(FREEFORM_NAME)}`);

        expect(res.status).toBe(200);
        // Generous upper bound — the assertion is that a bound EXISTS on a per-keystroke path, not a
        // millisecond budget that would flake on CI. The default 8s food-client timeout would exceed this.
        expect(Date.now() - startedAt).toBeLessThan(5_000);
    });

    it('GET /suggest with a blank q is a 400 (route mounted, query validated)', async () => {
        const res = await fetch(`${booted.baseUrl}/v1/ingredients/suggest?q=%20%20`);

        expect(res.status).toBe(400);
    });

    it('GET /suggest with a non-numeric limit is a 400', async () => {
        const res = await fetch(`${booted.baseUrl}/v1/ingredients/suggest?q=spice&limit=abc`);

        expect(res.status).toBe(400);
    });

    it('POST /by-food with a blank foodId is a 400 (route is mounted; validated BEFORE any food call)', async () => {
        // Mirrors the `/by-name` proof: a mounted route validates to 400 (a MISSING route would 404), and
        // validation short-circuits before the un-stubbed food client is touched. The admitted-with-nutrition
        // happy path (F1) is proven at the unit + integration tiers, where the food client is stubbable.
        const res = await fetch(`${booted.baseUrl}/v1/ingredients/by-food`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ foodId: '   ' }),
        });

        expect(res.status).toBe(400);
    });

    it('POST /by-food STRIPS a caller-supplied name (the shared catalog is never client-labelled)', async () => {
        // The whitelist must drop `name` before the service sees the body. Proven negatively at the assembled
        // boundary: with only a blank `foodId`, the request is a 400 regardless of what else was sent — a DTO
        // that accepted `name` as an alternative label would not fail closed like this.
        const res = await fetch(`${booted.baseUrl}/v1/ingredients/by-food`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ foodId: '   ', name: 'Definitely not chicken' }),
        });

        expect(res.status).toBe(400);
    });

    it('GET /{id}/status for a non-existent ingredient is a 404', async () => {
        const res = await fetch(`${booted.baseUrl}/v1/ingredients/${MISSING_ID}/status`);

        expect(res.status).toBe(404);
    });

    it('GET /{id}/candidates for a malformed (non-UUID) id is a 400 (ParseUUIDPipe)', async () => {
        const res = await fetch(`${booted.baseUrl}/v1/ingredients/not-a-uuid/candidates`);

        expect(res.status).toBe(400);
    });
});
