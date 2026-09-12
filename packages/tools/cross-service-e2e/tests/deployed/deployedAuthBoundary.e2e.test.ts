/**
 * ⛔ THE AUTHORIZATION BOUNDARY OF A **DEPLOYED** SERVICE, asserted from outside it.
 *
 * ## Why this suite exists, and why it is the shape it is
 *
 * Every other tier proves this against a service the runner itself booted, with an environment the runner
 * itself wrote. None of them can see the deployed artefact: `recipe-service` reads `CLERK_JWT_KEY`,
 * `CLERK_AUTHORIZED_PARTIES` and `RECIPE_DEV_AUTH_USER_ID` from a stage's own configuration, so an
 * unverified key, a missing one, or a dev-auth bypass that survived into a stage is invisible to a green
 * unit, integration, e2e and linkage suite alike — and visible here on the first request.
 *
 * `auth.middleware.ts` is installed with `.forRoutes('*')`, excluding only the health probes and the
 * service-principal erasure route. That is the invariant: **a caller with no credential, or a forged one,
 * gets nothing.** This suite states it against the running stage.
 *
 * ## Why every assertion is a READ, and why there are no writes
 *
 * These specs run against **production** as well as a per-PR sandbox — that is the point of them, and it is
 * an owner ruling ("End to end tests should always run against production"). Production rows are real
 * users' data and the production Clerk tenant is not a test fixture, so this tier is non-destructive **by
 * construction**: unauthenticated `GET`s only, no `POST`/`PATCH`/`DELETE`, no Clerk user creation, no
 * account-erasure route (`/api/v1/internal/account/erasure` is deliberately NOT probed — it is the one path
 * outside the Clerk middleware, it is destructive, and its own `ServiceErasureGuard` is not something to
 * rehearse against a live tenant).
 *
 * ## ⚠️ What this suite deliberately CANNOT prove — the standing gap, stated rather than discovered later
 *
 * Nothing here exercises a SUCCESSFUL authenticated read, because a deployed stage verifies the stage's own
 * Clerk instance and this repository has no seam that mints a token that stage will accept: the linkage
 * tier's `mintLinkageCredentials.ts` mints a throwaway keypair the deployed services do not trust, and
 * recipe-service serves no unauthenticated route at all. Closing that needs a deployed-stage credential
 * (a real Clerk user + session token for the stage's instance), which also brings the shared-dev-instance
 * fixture collision `heavy-e2e.yml`'s header records. Until that seam exists, the READ paths of a deployed
 * service are unprovable from CI and this suite says so instead of pretending otherwise.
 *
 * ## Configuration
 *
 * `DEPLOYED_RECIPE_URL` and `DEPLOYED_FOOD_URL` are REQUIRED, with no defaults. A missing one throws rather
 * than skipping: a tier that quietly passes when its subject is absent is the failure the whole deployed
 * tier exists to remove. Deciding whether anything is deployed is the CALLER's job — `deployed-e2e.yml`
 * asks `deploy-gate.sh` and skips the job — so by the time these specs run, absence IS a failure.
 */
import { describe, expect, it } from 'vitest';

/**
 * Read a required environment value, or throw naming it.
 *
 * @param name - The variable to read.
 * @returns Its value, with any trailing slashes removed.
 */
function requiredOrigin(name: string): string {
    const value = process.env[name];

    if (value === undefined || value.trim() === '') {
        throw new Error(
            `${name} is required. This tier drives a DEPLOYED service; without it there is nothing to ` +
                'prove, and skipping would restore exactly the blind spot it was written to close.',
        );
    }

    return value.trim().replace(/\/+$/, '');
}

const RECIPE_URL = requiredOrigin('DEPLOYED_RECIPE_URL');
const FOOD_URL = requiredOrigin('DEPLOYED_FOOD_URL');

/** What one unauthenticated probe observed. */
interface Observation {
    readonly status: number;
    /** Distinguishes the shared ALB's own `404 text/plain` from an application 404 (ADR-0003). */
    readonly contentType: string;
}

/**
 * The verdict of one authorization-boundary probe.
 *
 * A discriminated result rather than a bare boolean, because the REMEDIES differ and a log that says only
 * "failed" sends the reader to the wrong service.
 */
export type BoundaryVerdict =
    | { readonly kind: 'rejected' }
    | { readonly kind: 'unrouted' }
    | { readonly kind: 'admitted'; readonly status: number }
    | { readonly kind: 'failing'; readonly status: number }
    | { readonly kind: 'unexpected'; readonly status: number };

/**
 * Classify what a credential-less request to a protected route got back. Pure, total.
 *
 * `401`/`403` is the PASS and the ONLY pass: producing it means DNS resolved, the shared ALB matched this
 * stage's host rule, the task answered, and its auth layer ran and refused. Every other outcome is a
 * distinct defect:
 *
 *   - **`404 text/plain`** — the shared ALB's DEFAULT fixed response for a host matching no listener rule
 *     (ADR-0003). The probe never reached a service at all, so it says nothing about auth.
 *   - **`2xx`/`3xx`** — the route served, or redirected, an ANONYMOUS caller. Either the middleware is not
 *     installed in this build, or the stage carries a dev-auth bypass (`RECIPE_DEV_AUTH_USER_ID`), which
 *     `auth.middleware.ts` disables on `NODE_ENV === 'production'` and nothing else enforces.
 *   - **`5xx`** — the auth layer threw instead of refusing; a stage with an unusable `CLERK_JWT_KEY` looks
 *     like this, and it is an outage, not a rejection.
 *
 * @param observed - Status and content type of the probe.
 * @returns The verdict.
 */
export function classifyBoundary(observed: Observation): BoundaryVerdict {
    const { status, contentType } = observed;

    if (status === 401 || status === 403) {
        return { kind: 'rejected' };
    }

    if (status === 404 && contentType.includes('text/plain')) {
        return { kind: 'unrouted' };
    }

    if (status >= 200 && status < 400) {
        return { kind: 'admitted', status };
    }

    if (status >= 500) {
        return { kind: 'failing', status };
    }

    return { kind: 'unexpected', status };
}

/**
 * Render a verdict as the sentence a CI log needs.
 *
 * @param url - The URL probed.
 * @param verdict - The classification.
 * @returns One actionable line.
 */
export function explain(url: string, verdict: BoundaryVerdict): string {
    switch (verdict.kind) {
        case 'rejected':
            return `${url} refused an unauthenticated request`;
        case 'unrouted':
            return `${url} answered the shared ALB's DEFAULT 404 (text/plain) — this stage is not routed, so the probe never reached a service (ADR-0003)`;
        case 'admitted':
            return `${url} answered ${verdict.status} to an ANONYMOUS caller — the auth middleware is not protecting this route in the deployed build (a dev-auth bypass that reached a stage looks exactly like this)`;
        case 'failing':
            return `${url} answered ${verdict.status} — the auth layer threw instead of refusing; a stage with an unusable CLERK_JWT_KEY looks like this`;
        default:
            return `${url} answered an unexpected ${verdict.status}; a protected route must answer 401 or 403 without a credential`;
    }
}

/**
 * Issue one unauthenticated GET and report what came back.
 *
 * The absence of an `authorization` header is the POINT. A redirect is never followed: a `3xx` is itself a
 * finding, and following one could turn a misroute into a misleading `200` from somewhere else entirely.
 *
 * @param url - Absolute URL to probe.
 * @param headers - Extra request headers (used to send a FORGED bearer).
 * @returns The observation.
 * @sideEffect Performs a network request.
 */
async function probe(url: string, headers: Readonly<Record<string, string>> = {}): Promise<Observation> {
    const response = await fetch(url, {
        headers: { accept: 'application/json', ...headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
    });

    return { status: response.status, contentType: response.headers.get('content-type') ?? '' };
}

/**
 * A syntactically well-formed JWT signed with a key NO stage trusts.
 *
 * Well-formed on purpose: a bearer of `nonsense` can be refused by a parser, which proves nothing about
 * VERIFICATION. This one decodes cleanly to `{alg: RS256}` / `{sub: …}` and fails only at the signature,
 * so a service that parses without verifying admits it — which is the defect worth catching.
 */
const FORGED_BEARER = [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ins_forged' })).toString('base64url'),
    Buffer.from(
        JSON.stringify({
            sub: 'user_forged',
            azp: 'https://example.invalid',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
        }),
    ).toString('base64url'),
    Buffer.from('not-a-signature').toString('base64url'),
].join('.');

/** The protected READ routes probed on each service. Every one is a GET and writes nothing. */
const PROTECTED_ROUTES: readonly { readonly service: 'recipe' | 'food'; readonly path: string }[] = [
    { service: 'recipe', path: '/api/v1/recipes' },
    { service: 'recipe', path: '/api/v1/collections' },
    { service: 'recipe', path: '/api/v1/search?q=smoke' },
    { service: 'recipe', path: '/api/v1/ingredients/suggest?q=salt' },
    { service: 'food', path: '/api/v1/foods/search?query=smoke' },
];

/**
 * The origin a route's service is served from.
 *
 * @param service - Which service the route belongs to.
 * @returns Its deployed origin.
 */
function originFor(service: 'recipe' | 'food'): string {
    return service === 'recipe' ? RECIPE_URL : FOOD_URL;
}

describe('the deployed stage is serving', () => {
    it.each([
        ['recipe', RECIPE_URL],
        ['food', FOOD_URL],
    ])('%s answers /health with 200', async (_service, base) => {
        const health = await probe(`${base}/health`);

        // The caller ran this tier only because the deploy gate reported the stage "already deployed and
        // serving", so a non-200 here is a REGRESSION between that answer and this request, not an absence.
        expect(health.status).toBe(200);
    });
});

describe('⛔ every protected route refuses a caller with NO credential', () => {
    it.each(PROTECTED_ROUTES.map((route) => [`${route.service} ${route.path}`, route] as const))(
        '%s answers 401/403 unauthenticated',
        async (_label, route) => {
            const url = `${originFor(route.service)}${route.path}`;
            const verdict = classifyBoundary(await probe(url));

            expect(verdict.kind, explain(url, verdict)).toBe('rejected');
        },
    );
});

describe('⛔ every protected route refuses a FORGED bearer, so the deployed build verifies signatures', () => {
    it.each(PROTECTED_ROUTES.map((route) => [`${route.service} ${route.path}`, route] as const))(
        '%s answers 401/403 to a well-formed but unsigned token',
        async (_label, route) => {
            const url = `${originFor(route.service)}${route.path}`;
            const verdict = classifyBoundary(await probe(url, { authorization: `Bearer ${FORGED_BEARER}` }));

            expect(
                verdict.kind,
                `${explain(url, verdict)} — this bearer decodes cleanly and fails only at the signature, so ` +
                    'anything but a rejection means the stage is not VERIFYING the token it parses',
            ).toBe('rejected');
        },
    );
});
