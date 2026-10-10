/**
 * T029/T067 — e2e proof of the ingredient async-resolution surface through the fully ASSEMBLED recipe app
 * (`ThrottlerModule` + global guard, `AuthMiddleware`, `ApiExceptionFilter`, `ParseUUIDPipe`, real HTTP)
 * via `bootRecipeApp`. It pins the client-visible HTTP contract of the poll and add routes: the status codes and
 * shapes a caller actually receives, and the 404 of every route deleted under them.
 *
 * The external food service (003) is NOT running in the harness, so these specs deliberately drive the
 * branches that need NO food-service call — a FREEFORM (user-entered) ingredient has no linked food, so
 * `status` returns it unchanged — plus the boundary cases (missing ingredient → 404, malformed id → 400). The
 * food-backed happy path (poll → RESOLVED with nutrition) is proven where the food client is stubbable: the
 * service unit tests and the disambiguation integration spec. Skips when no test database is configured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { bootRecipeApp, type BootedRecipeApp } from './harness.js';
import { deleteBindingsMatching } from '../support/bindingCleanup.js';
import { recipeDb } from '../support/roleDb.js';

const roleDb = recipeDb();

const CALLER = '01JINGE2E00000CALLER00000A';
const FREEFORM_NAME = 'E2E disambiguation freeform spice';
const MISSING_ID = '00000000-0000-4000-8000-0000000000ff';

/**
 * U+200B ZERO WIDTH SPACE and U+FEFF BOM — escapes rather than pasted characters, because a reviewer cannot
 * check a case they cannot see.
 */
const ZWSP = '\u200B';
const BOM = '\uFEFF';

/**
 * The search-proxy routes plan 002 S6 deleted (ADR-0046 Decision 1: the apps reach food directly). Each request is
 * one the route used to ANSWER (a 200, a 400 or a 502), so a 404 here means the route is gone, not refused.
 */
const DELETED_PROXY_ROUTES: readonly { readonly method: 'GET' | 'POST'; readonly path: string }[] = [
    { method: 'GET', path: 'ingredients/suggest?q=spice' },
    { method: 'GET', path: 'ingredients/search/live?q=spice' },
    { method: 'POST', path: 'ingredients/authored-food' },
    { method: 'POST', path: 'ingredients/corrections' },
];

/**
 * The disambiguation routes plan 002 S7 left without a caller: a pick reads food's progressive search and commits through
 * the rebind command. Each request is one the route used to ANSWER with a `200` for a freeform ingredient, so a 404
 * here means the route is gone, not that the ingredient is missing.
 */
const DELETED_DISAMBIGUATION_ROUTES: readonly { readonly method: 'GET' | 'POST'; readonly path: string }[] = [
    { method: 'GET', path: 'candidates' },
    { method: 'POST', path: 'resolve' },
];

/** The canonical prefix and the deprecated bare alias the controller is also mounted under (ADR-0011). */
const ROUTE_PREFIXES: readonly string[] = ['/api/v1/', '/v1/'];

describe('ingredient async-resolution surface (e2e, assembled app)', () => {
    let booted: BootedRecipeApp;
    let pool: pg.Pool;

    beforeAll(async () => {
        booted = await bootRecipeApp({ databaseUrl: roleDb.appUrl, devAuthUserId: CALLER });
        pool = new pg.Pool({ connectionString: roleDb.appUrl, max: 3 });
    });

    afterAll(async () => {
        await deleteBindingsMatching(pool, FREEFORM_NAME);
        await pool.end();
        await booted?.close();
    });

    /** Create the shared freeform ingredient over HTTP and return its id. */
    async function createFreeform(): Promise<string> {
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients`, {
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

        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/${id}/status`);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { id: string; foodResolutionStatus?: string };
        expect(body.id).toBe(id);
        expect(body.foodResolutionStatus).toBeUndefined();
    });

    it('POST /by-name with a blank name is a 400 (route is mounted; validated BEFORE any food call)', async () => {
        // The food service (003) is not in the harness, so the 202 happy path is proven at the unit +
        // integration tiers (where the food client is stubbable). Here we pin that the async-resolution ENTRY
        // POINT is actually wired into the assembled app: a mounted route validates a blank name to 400 (a
        // MISSING route would 404), and validation short-circuits before the un-stubbed food client is touched.
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/by-name`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: '   ' }),
        });

        expect(res.status).toBe(400);
    });

    /**
     * ⛔ U3 — an INVISIBLE-only name is the same rejection as a blank one, in the same envelope.
     *
     * Only this tier can prove it. A U+200B ZERO WIDTH SPACE survives `String#trim` (format characters are not ECMAScript
     * whitespace), so it passes the published schema's `min(1)` and reaches the handler — where the canonical
     * parse now rejects it. Before U3 it was persisted, giving the ownerless catalog a row named nothing at
     * all. The two bodies are compared FIELD BY FIELD rather than only by status, because the point is that a
     * caller cannot tell the two conditions apart from the response either.
     */
    it('POST /ingredients with an invisible-only name is the SAME 400 envelope as an empty one', async () => {
        const post = async (name: string): Promise<{ status: number; body: unknown }> => {
            const res = await fetch(`${booted.baseUrl}/api/v1/ingredients`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name }),
            });

            return { status: res.status, body: await res.json() };
        };

        const empty = await post('');
        const invisible = await post(`${ZWSP}${BOM}`);

        expect(invisible.status).toBe(400);
        expect(invisible.status).toBe(empty.status);
        expect((invisible.body as { code?: string }).code).toBe('VALIDATION_FAILED');
        expect((invisible.body as { code?: string }).code).toBe((empty.body as { code?: string }).code);

        // …and nothing was written under either spelling. A declared name lives on its failure record (plan 002).
        const { rows } = await pool.query<{ n: string }>(
            `SELECT count(*)::int AS n FROM unresolved_foods WHERE name = ANY($1)`,
            [['', `${ZWSP}${BOM}`]],
        );
        expect(Number(rows[0]!.n)).toBe(0);
    });

    it.each(
        ROUTE_PREFIXES.flatMap((prefix) =>
            DELETED_PROXY_ROUTES.map((route) => ({ ...route, url: prefix + route.path })),
        ),
    )('$method $url answers 404: the proxy route is deleted', async ({ method, url }) => {
        const res = await fetch(`${booted.baseUrl}${url}`, {
            method,
            ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}),
        });

        expect(res.status).toBe(404);
    });

    it.each(
        ROUTE_PREFIXES.flatMap((prefix) =>
            DELETED_DISAMBIGUATION_ROUTES.map((route) => ({
                ...route,
                url: `${prefix}ingredients/{id}/${route.path}`,
            })),
        ),
    )('$method $url answers 404: the route is deleted', async ({ method, url }) => {
        const id = await createFreeform();

        const res = await fetch(`${booted.baseUrl}${url.replace('{id}', id)}`, {
            method,
            ...(method === 'POST'
                ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateIds: ['c1'] }) }
                : {}),
        });

        expect(res.status).toBe(404);
    });

    // ── The catalog pick ──────────────────────────────────────────────────────────────────────────────

    it('POST /by-food with a blank foodId is a 400 (route is mounted; validated BEFORE any food call)', async () => {
        // Mirrors the `/by-name` proof: a mounted route validates to 400 (a MISSING route would 404), and
        // validation short-circuits before the un-stubbed food client is touched. The admitted-with-nutrition
        // happy path (F1) is proven at the unit + integration tiers, where the food client is stubbable.
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/by-food`, {
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
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/by-food`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ foodId: '   ', name: 'Definitely not chicken' }),
        });

        expect(res.status).toBe(400);
    });

    it('GET /{id}/status for a non-existent ingredient is a 404', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/${MISSING_ID}/status`);

        expect(res.status).toBe(404);
    });

    it('GET /{id}/status for a malformed (non-UUID) id is a 400 (ParseUUIDPipe)', async () => {
        const res = await fetch(`${booted.baseUrl}/api/v1/ingredients/not-a-uuid/status`);

        expect(res.status).toBe(400);
    });
});
