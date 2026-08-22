/**
 * ARCH-001 — REAL Clerk JWT verification integration test (real Nest app + Docker Postgres, genuinely
 * signed RS256 tokens, no dev-auth bypass).
 *
 * Every OTHER integration/e2e spec in this suite authenticates via `bootRecipeApp({ devAuthUserId })`
 * (`RECIPE_DEV_AUTH_USER_ID`), which short-circuits `AuthMiddleware` straight to a fixed dev Principal —
 * by design, so the specs that exist to prove recipe/photo/collection BEHAVIOR don't also have to mint
 * tokens. That convenience is exactly the gap this file closes: it is the ONLY place in the suite that
 * boots the app with NO dev bypass and drives requests through the REAL
 * `ClerkAuthService.verify` → `@kitchensink/clerk-verify` `verifyToken` → `@clerk/backend` `verifyToken`
 * chain, against genuinely RSA-signed tokens (`tests/support/jwt.ts`, mirroring
 * `@kitchensink/food-service`'s T-190 e2e helper — see that module's docstring for why the ~90-line
 * hermetic minter is duplicated here rather than shared: it is test-only code inside each service's own
 * `tests/` tree, and workspace boundaries forbid a relative import across them).
 *
 * `src/auth/__tests__/clerkAuth.service.test.ts` (unit) already pins the wrapper's contract against a
 * MOCKED `verifyToken`. What only a real key + a real signature can prove — and what is proven below —
 * is that the WIRING is real: a token signed by a DIFFERENT key than the configured `CLERK_JWT_KEY` is
 * cryptographically rejected (not merely "the mock said so"), an out-of-allowlist `azp` is rejected, an
 * expired token is rejected, and a genuinely valid token flows all the way through `AuthMiddleware` into
 * `req.principal` and is observable on a created resource's `ownerId` — never the dev-bypass owner every
 * other spec uses.
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';
import { generateClerkKeypair, mintToken } from '../../../tests/support/jwt.js';

/** The `azp` this suite configures as the ONLY authorized party. */
const AUTHORIZED_AZP = 'https://recipes.example.com';
/** An `azp` deliberately absent from `CLERK_AUTHORIZED_PARTIES`. */
const UNAUTHORIZED_AZP = 'https://evil.example.com';
/** The app-user ULID a valid token carries as `external_id` — the REQ-IF-007 owner key. */
const VALID_OWNER_ULID = '01JCLERKVERIFYOWNER00001AA';

const MINIMAL_RECIPE_PAYLOAD = {
    title: 'Clerk Verification Integration Recipe',
    servings: 2,
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    totalTimeMinutes: 15,
    tags: ['integration'],
    dietaryFlags: [],
    ingredients: [
        {
            ingredientId: '00000000-0000-4000-8000-0000000000aa',
            name: 'Flour',
            quantity: { kind: 'exact', value: 1 },
            unit: 'cup',
        },
    ],
    steps: [{ instruction: 'Mix.' }],
};

interface RecipeBody {
    id: string;
    ownerId: string;
}

describe.skipIf(!hasDatabaseUrl)('ClerkAuthService real JWT verification (ARCH-001 integration)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    // The keypair the SERVICE is configured to trust (`CLERK_JWT_KEY` below). A SEPARATE, unrelated
    // keypair signs the "wrong key" token — the two must never be the same pair.
    const trustedKeypair = generateClerkKeypair();
    const untrustedKeypair = generateClerkKeypair();

    beforeAll(async () => {
        // Defensively clear the dev-bypass var: every sibling integration file that ran earlier in this
        // (serial, `fileParallelism: false`) run booted its own app via `devAuthUserId`, which sets
        // `RECIPE_DEV_AUTH_USER_ID` on `process.env`. This suite exists specifically to exercise the REAL
        // verification path, so it must never silently short-circuit through a bypass a prior file left
        // behind.
        delete process.env['RECIPE_DEV_AUTH_USER_ID'];

        // Set BEFORE bootRecipeApp, which reads env when it dynamically imports AppModule. Setting these
        // directly (not via `bootRecipeApp`'s `devAuthUserId` option) means the harness's own
        // `envDefaults` placeholder key/azp — `setDefault` only applies when a key is ABSENT — never wins.
        process.env['CLERK_JWT_KEY'] = trustedKeypair.publicKeyPem;
        process.env['CLERK_AUTHORIZED_PARTIES'] = AUTHORIZED_AZP;

        booted = await bootRecipeApp();
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted?.close();
    });

    /** `GET /api/v1/recipes` with the given `Authorization` header value (or none). */
    async function listRecipes(authorization?: string): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/recipes`, {
            headers: authorization !== undefined ? { authorization } : {},
        });
    }

    it('rejects a request with NO bearer token — 401', async () => {
        const res = await listRecipes();
        expect(res.status).toBe(401);
    });

    it('rejects a structurally invalid bearer token — 401', async () => {
        const res = await listRecipes('Bearer not-a-jwt-at-all');
        expect(res.status).toBe(401);
    });

    it('rejects a token signed by a key OTHER than the configured CLERK_JWT_KEY — 401 (cryptographic rejection, not a mock)', async () => {
        const wrongKeyToken = mintToken(untrustedKeypair.privateKeyPem, {
            sub: 'user_wrong_key',
            azp: AUTHORIZED_AZP,
            externalId: VALID_OWNER_ULID,
        });

        const res = await listRecipes(`Bearer ${wrongKeyToken}`);
        expect(res.status).toBe(401);
    });

    it('rejects a correctly-signed token whose azp is OUTSIDE the authorized-parties allowlist — 401', async () => {
        const wrongAzpToken = mintToken(trustedKeypair.privateKeyPem, {
            sub: 'user_wrong_azp',
            azp: UNAUTHORIZED_AZP,
            externalId: VALID_OWNER_ULID,
        });

        const res = await listRecipes(`Bearer ${wrongAzpToken}`);
        expect(res.status).toBe(401);
    });

    it('rejects a correctly-signed, correctly-authorized token that has EXPIRED — 401', async () => {
        const expiredToken = mintToken(trustedKeypair.privateKeyPem, {
            sub: 'user_expired',
            azp: AUTHORIZED_AZP,
            externalId: VALID_OWNER_ULID,
            expiresInSeconds: -60,
        });

        const res = await listRecipes(`Bearer ${expiredToken}`);
        expect(res.status).toBe(401);
    });

    it('rejects a genuinely valid token that carries NO external_id — the REQ-IF-007 fail-closed owner-key gate', async () => {
        const noOwnerToken = mintToken(trustedKeypair.privateKeyPem, {
            sub: 'user_no_external_id',
            azp: AUTHORIZED_AZP,
            // externalId omitted — verifyClerkToken leaves userId undefined; AuthMiddleware must reject
            // rather than fall back to `sub`.
        });

        const res = await listRecipes(`Bearer ${noOwnerToken}`);
        expect(res.status).toBe(401);
    });

    it('accepts a genuinely valid, correctly-signed, correctly-authorized token and populates the REAL verified principal', async () => {
        const validToken = mintToken(trustedKeypair.privateKeyPem, {
            sub: 'user_valid',
            azp: AUTHORIZED_AZP,
            externalId: VALID_OWNER_ULID,
        });

        // A 200 alone would not distinguish "verification ran" from "verification was skipped" — the
        // owner-scoped WRITE below proves `req.principal.userId` was genuinely populated from THIS
        // token's `external_id`, not a dev-bypass constant (no other spec in this file, or the wider
        // integration suite, ever authenticates as `VALID_OWNER_ULID`).
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { authorization: `Bearer ${validToken}`, 'content-type': 'application/json' },
            body: JSON.stringify(MINIMAL_RECIPE_PAYLOAD),
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as RecipeBody;
        expect(created.ownerId).toBe(VALID_OWNER_ULID);

        // The SAME token, on a read, sees the recipe it just (verifiably) owns.
        const listRes = await listRecipes(`Bearer ${validToken}`);
        expect(listRes.status).toBe(200);
        const listed = (await listRes.json()) as { data: RecipeBody[] };
        expect(listed.data.some((recipe) => recipe.id === created.id)).toBe(true);
    });
});
