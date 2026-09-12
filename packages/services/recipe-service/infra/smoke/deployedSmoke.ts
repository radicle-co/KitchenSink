/**
 * @module infra/smoke/deployedSmoke — post-deploy verification of the RUNNING recipe service.
 *
 * `cdk deploy` succeeding means the stack converged; it does not mean the service serves traffic, and it
 * certainly does not mean a BROWSER can reach it. This module is the difference between those claims. It
 * mirrors the smoke step `sandbox-identity-deploy.yml` already runs for identity, and adds the two checks
 * that identity's `/health` probe would still have missed.
 *
 * ## Why three checks and not one
 *
 * A stale, pre-CORS recipe build served `pr-73` for fifteen days while every existing signal stayed green:
 * `GET /health` answered 200 (it was running, just old), `cdk synth` exited 0 (the SSM dependency resolves
 * at deploy time), and k6 / Playwright / Maestro / integration all passed because each boots or mocks its
 * own backend. Each check below closes one of those blind spots:
 *
 * | check | catches |
 * |---|---|
 * | {@link classifyHealth} | the service is down or crash-looping |
 * | {@link classifyPreflight} | browsers cannot reach it cross-origin (CORS absent, or auth answering preflights) |
 * | {@link classifyPreflightDenied} | a path, or a whole service, that must refuse browsers has started admitting one |
 * | {@link classifyForeignPreflight} | a service that admits ANY origin, which every admit check above would pass |
 * | {@link classifyImageCurrency} | a healthy, correct, but OUT-OF-DATE build is running |
 *
 * ## Why three was still not enough — the ECOSYSTEM checks (issue #124)
 *
 * Those three interrogate ONE service in isolation, so all three stay green on a preview whose cross-service
 * wiring is broken. `RECIPE_FOOD_SERVICE_URL` is a REQUIRED prop naming `https://food-pr-{N}.commise.app`,
 * but the food deploy job used to be gated on food paths — so a recipe-only PR pointed a perfectly healthy
 * recipe service at a host that did not exist, and only the blended USDA catalog noticed, silently, as
 * `catalogAvailability: 'unavailable'`. Two more checks close that:
 *
 * | check | catches |
 * |---|---|
 * | {@link classifyDependencyWiring} | the running task is configured for the WRONG food service (or none) |
 * | {@link classifyDependencyReachability} | this PR's food service is absent, unrouted, or erroring |
 *
 * ⛔ The trap in the reachability check: `GET /api/v1/foods/search` answers **401 by design** — food requires a
 * Clerk-verified token. So "200 or bust" would fail every correctly-wired preview. A 401 from the real host
 * is PROOF (DNS, the shared-ALB host rule and food's own auth layer all had to work to produce it); a
 * transport failure, or the shared ALB's default `404 text/plain` for an unmatched host (ADR-0003), proves
 * the opposite. {@link classifyDependencyReachability} is built around that distinction.
 *
 * The classifiers are pure so they are unit-tested directly; {@link main} owns all I/O.
 */
import { parseArgs } from 'node:util';

/**
 * The path preflighted when a leg names none: the recipe service's, because this module is the recipe service's
 * smoke. Identity and food legs name their own paths (`--preflight-path`), since a recipe path on another service
 * is a claim about a route that service does not have.
 */
const DEFAULT_PREFLIGHT_PATH = '/api/v1/recipes';

/** The CANONICAL food catalog-search path this smoke probes — every endpoint lives under `/api/{version}/`. */
const FOOD_SEARCH_PATH = '/api/v1/foods/search?q=smoke';

/**
 * The same probe on the DEPRECATED bare-`v1` alias, used only as a rollout fallback.
 *
 * Food deploys independently of recipe (and the ADR-0010 gate may skip it), so a food service that predates
 * the `/api` prefix answers an app 404 on {@link FOOD_SEARCH_PATH} while still serving this alias. Probing it
 * turns that version skew into a warning instead of a false deploy failure. See ADR-0011; this constant can
 * be deleted once every stage is known to serve the canonical path.
 */
const LEGACY_FOOD_SEARCH_PATH = '/v1/foods/search?q=smoke';

/**
 * An origin no policy admits, preflighted beside the web origin. A service that reflects any origin echoes the web
 * origin too, so only a probe from an origin nobody admits can see it. `.invalid` is reserved (RFC 2606), so this can
 * never be a real caller.
 */
export const FOREIGN_PREFLIGHT_ORIGIN = 'https://evil.invalid';

/** The outcome of one smoke assertion. `reason` is written to be actionable in a CI log. */
export interface SmokeVerdict {
    readonly ok: boolean;
    readonly reason: string;
}

/** The response signals a CORS preflight returns, as a browser would see them. */
export interface PreflightObservation {
    readonly status: number;
    /** The `access-control-allow-origin` response header, if the service sent one. */
    readonly allowOrigin?: string;
}

/** The service answers at all. Pure. */
export function classifyHealth(status: number): SmokeVerdict {
    return status === 200
        ? { ok: true, reason: 'health returned 200' }
        : { ok: false, reason: `health returned ${status}, expected 200` };
}

/**
 * A browser can actually call this service from `origin`. Pure.
 *
 * A CORS preflight is an `OPTIONS` request that the browser sends **without credentials** — that is fixed by
 * the Fetch spec, not a client choice. So a service whose auth middleware runs ahead of its CORS layer
 * answers `401`, and is unreachable from every browser while remaining perfectly healthy to `curl`, k6, or
 * any server-side client. That is precisely the failure this exists to catch, so it gets its own message.
 *
 * @param origin - The web origin that must be allowed (the preview or production front end).
 * @param observed - Status + `access-control-allow-origin` from the preflight.
 */
export function classifyPreflight(origin: string, observed: PreflightObservation): SmokeVerdict {
    const { status, allowOrigin } = observed;

    if (status === 401 || status === 403) {
        return {
            ok: false,
            reason:
                `CORS preflight (OPTIONS) returned ${status} — auth is running BEFORE CORS. Browsers send ` +
                'preflights without credentials by spec, so every browser call is blocked even though the ' +
                'service is healthy to curl. Ensure the CORS layer answers OPTIONS before auth middleware.',
        };
    }

    if (status < 200 || status >= 300) {
        return { ok: false, reason: `CORS preflight (OPTIONS) returned ${status}, expected 2xx` };
    }

    if (allowOrigin === undefined || allowOrigin === '') {
        return {
            ok: false,
            reason:
                'CORS preflight carried no access-control-allow-origin header — the browser will block the ' +
                'response. Typically a build that predates the service enabling CORS.',
        };
    }

    // No policy of ours sends `*`: the shared policy's origin is always a list (ADR-0047). A `*` means the service
    // is not running that policy, and it admits every origin.
    if (allowOrigin === '*') {
        return {
            ok: false,
            reason: 'CORS preflight allowed "*", which admits every origin. The shared policy never sends it.',
        };
    }

    if (allowOrigin !== origin) {
        return {
            ok: false,
            reason: `CORS preflight allowed "${allowOrigin}" but the caller is "${origin}"`,
        };
    }

    return { ok: true, reason: `CORS preflight allows ${origin}` };
}

/**
 * The service refuses an origin nobody admits ({@link FOREIGN_PREFLIGHT_ORIGIN}). Pure.
 *
 * Stricter than {@link classifyPreflightDenied}: ANY allow-origin value fails, not only a match. The shared policy
 * either echoes an admitted origin or sends nothing, so a value here means the service is not running it. A 5xx
 * fails because it proves nothing about the policy.
 *
 * @param observed - Status + `access-control-allow-origin` from a preflight sent from the foreign origin.
 */
export function classifyForeignPreflight(observed: PreflightObservation): SmokeVerdict {
    const { status, allowOrigin } = observed;

    if (status >= 500) {
        return {
            ok: false,
            reason: `CORS preflight from ${FOREIGN_PREFLIGHT_ORIGIN} returned ${status}, so its policy cannot be read`,
        };
    }

    if (allowOrigin !== undefined && allowOrigin !== '') {
        return {
            ok: false,
            reason:
                `CORS preflight from ${FOREIGN_PREFLIGHT_ORIGIN}, an origin nothing admits, got allow-origin ` +
                `"${allowOrigin}". The service is not running the shared policy, and may admit any origin.`,
        };
    }

    return { ok: true, reason: `CORS preflight refuses ${FOREIGN_PREFLIGHT_ORIGIN}` };
}

/**
 * A browser can NOT call this path from `origin`: the service answered, and it did not admit the origin. Pure.
 *
 * Used where a path or a whole service must stay closed to browsers: a leg run with `--expect-cors deny`, or a
 * `--deny-preflight-path`. Any answer below 500 without a matching `access-control-allow-origin` is a refusal: a
 * router's 404 and an auth layer's 401 both mean the browser is blocked. A 5xx proves nothing about the policy, so it
 * fails.
 *
 * @param origin - The web origin that must NOT be admitted.
 * @param observed - Status + `access-control-allow-origin` from the preflight.
 */
export function classifyPreflightDenied(origin: string, observed: PreflightObservation): SmokeVerdict {
    const { status, allowOrigin } = observed;

    if (status >= 500) {
        return { ok: false, reason: `CORS preflight (OPTIONS) returned ${status}, so its policy cannot be read` };
    }

    if (allowOrigin === '*' || allowOrigin === origin) {
        return {
            ok: false,
            reason:
                `CORS preflight admits "${allowOrigin}" for ${origin}, but this surface must refuse browsers. ` +
                'If that change is intended, flip this leg to --expect-cors admit in the same change.',
        };
    }

    return { ok: true, reason: `CORS preflight refuses ${origin}` };
}

/**
 * What is running is what was just built. Pure.
 *
 * Health and CORS are both satisfied by a correct-but-old container, which is exactly how a service drifts
 * fifteen days behind `main` unnoticed. Comparing the running image tag to the one this deploy produced is
 * the only check that has an opinion about currency.
 *
 * @param running - Image tag currently referenced by the running task definition.
 * @param expected - Image tag this deployment pushed.
 */
export function classifyImageCurrency(running: string | undefined, expected: string): SmokeVerdict {
    if (running === undefined || running === '') {
        return { ok: false, reason: `could not determine the running image tag (expected "${expected}")` };
    }

    return running === expected
        ? { ok: true, reason: `running the freshly deployed image ${expected}` }
        : { ok: false, reason: `running STALE image "${running}", expected "${expected}"` };
}

/**
 * What one probe of a cross-service dependency observed — a discriminated union rather than a
 * `status | undefined`, because "nothing answered" and "something answered 404" are different facts with
 * different causes, and collapsing them is how a missing preview reads as a routing bug (or vice versa).
 */
export type DependencyObservation =
    | {
          readonly outcome: 'no-response';
          /** The transport failure, verbatim — DNS, connection refused, TLS, or timeout. */
          readonly detail: string;
      }
    | {
          readonly outcome: 'responded';
          readonly status: number;
          /** The `content-type` of the response, when it sent one. Distinguishes the ALB's 404 from the app's. */
          readonly contentType?: string;
      };

/**
 * Normalize an origin for comparison, or `null` when it is not an absolute http(s) URL. Pure.
 *
 * Uses the WHATWG URL parser (`URL.origin`) rather than string munging, so `https://host/`,
 * `https://HOST` and `https://host` are recognised as one origin and a bare hostname is rejected.
 */
function originOf(candidate: string): string | null {
    try {
        const parsed = new URL(candidate);

        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
    } catch {
        return null;
    }
}

/**
 * The RUNNING recipe task is configured to call THIS stage's food service. Pure.
 *
 * Reachability alone cannot see this: a preview cross-wired to the shared prod/sandbox catalog reaches a
 * perfectly healthy food service and looks like it works, while testing another stage's data and putting its
 * per-keystroke typeahead load on that stage. And the original defect was the degenerate case — the task
 * definition carried NO `FOOD_*` variables at all, because `foodServiceUrl` was optional and nothing set it.
 *
 * @param expected - The food origin this stage must call (from `foodServiceOriginForStage`).
 * @param configured - `FOOD_SERVICE_URL` as read from the running task definition.
 */
export function classifyDependencyWiring(expected: string, configured: string | undefined): SmokeVerdict {
    if (configured === undefined || configured === '') {
        return {
            ok: false,
            reason:
                `the running recipe task carries no FOOD_SERVICE_URL — it cannot reach ${expected}, so the ` +
                'ingredient typeahead can only ever report catalogAvailability: "unavailable" ' +
                '(pass RECIPE_FOOD_SERVICE_URL at deploy time)',
        };
    }

    const configuredOrigin = originOf(configured);

    if (configuredOrigin === null) {
        return {
            ok: false,
            reason: `the running recipe task's FOOD_SERVICE_URL "${configured}" is not an absolute http(s) origin`,
        };
    }

    const expectedOrigin = originOf(expected);

    if (expectedOrigin === null) {
        return { ok: false, reason: `the expected food origin "${expected}" is not an absolute http(s) origin` };
    }

    return configuredOrigin === expectedOrigin
        ? { ok: true, reason: `the running recipe task calls ${expectedOrigin}, this stage's own food service` }
        : {
              ok: false,
              reason:
                  `the running recipe task calls "${configured}" but this stage's food service is ` +
                  `"${expected}" — the preview is cross-wired to another stage's catalog`,
          };
}

/**
 * This stage's food service actually answers. Pure.
 *
 * **A 401 is the PASS.** The probe is deliberately unauthenticated, and `GET /api/v1/foods/search` requires a
 * Clerk-verified token, so `401` (or `403`) is the only correct answer — and producing it means DNS
 * resolved, the shared ALB matched this PR's host rule, and the food service's own auth layer ran. Nothing
 * short of a working, correctly-routed food service can answer that way.
 *
 * Every other outcome is a distinct failure, and the reasons keep them distinct because the remedies differ:
 *
 *   - **no response** — the host does not exist (a recipe-only PR with no food deploy: issue #124).
 *   - **`404 text/plain`** — the shared ALB's DEFAULT fixed response for a host matching no listener rule
 *     (ADR-0003): DNS resolves, but this stage's rule/target group was never created.
 *   - **`404` from the app** — routed, but the endpoint is gone: a food build older than the API recipe calls.
 *   - **`2xx`** — reachable, but it answered an UNAUTHENTICATED request, so either the auth guard is missing
 *     or this host is served by something other than the food service.
 *   - **`5xx`** — routed, but the food service is failing.
 *
 * @param dependency - The dependency's origin, named in every verdict so the log says which host was probed.
 * @param observed - What the probe saw.
 */
export function classifyDependencyReachability(
    dependency: string,
    observed: DependencyObservation,
    legacyObserved?: DependencyObservation,
): SmokeVerdict {
    // ROLLOUT SAFETY (ADR-0011). `observed` is the CANONICAL `/api/v1/foods/search` probe. Food deploys
    // independently of recipe, and the ADR-0010 deploy gate can legitimately skip food's deploy while still
    // running this smoke — so a food service that predates the `/api` prefix answers an app-level 404 on
    // canonical while still serving the deprecated `/v1` alias. Resolve that against the alias BEFORE the
    // canonical 404 becomes a verdict: the ecosystem this check exists to prove is intact, so failing the
    // deploy would be a false red. Only an app 404 (not the ALB's `text/plain` default) is a skew candidate.
    if (
        legacyObserved !== undefined &&
        observed.outcome === 'responded' &&
        observed.status === 404 &&
        !(observed.contentType ?? '').includes('text/plain')
    ) {
        const viaLegacy = classifyDependencyReachability(dependency, legacyObserved);

        if (viaLegacy.ok) {
            return {
                ok: true,
                reason:
                    `${dependency} 404s the canonical /api/v1/foods/search but answers on the DEPRECATED /v1 ` +
                    `alias — a version skew, not an outage: ${viaLegacy.reason}. The deployed food service ` +
                    'predates the /api version prefix (ADR-0011); redeploy it to retire this warning',
            };
        }
    }

    if (observed.outcome === 'no-response') {
        return {
            ok: false,
            reason:
                `${dependency} did not answer at all (${observed.detail}) — this stage has no food service, so ` +
                'the ingredient typeahead degrades to recipe-local results only (issue #124)',
        };
    }

    const { status, contentType } = observed;

    if (status === 401 || status === 403) {
        return {
            ok: true,
            reason:
                `${dependency} answered ${status} to an unauthenticated probe — the correct rejection, which ` +
                'proves DNS, the shared-ALB host rule and the food service itself are all in place',
        };
    }

    if (status === 429) {
        return {
            ok: true,
            reason:
                `${dependency} answered 429 — only the food service itself can shed load (the shared ALB has ` +
                'no such action), so the request reached it',
        };
    }

    if (status === 404) {
        return (contentType ?? '').includes('text/plain')
            ? {
                  ok: false,
                  reason:
                      `${dependency} answered the shared ALB's DEFAULT 404 (text/plain) — this stage is not ` +
                      'routed: no listener rule or target group exists for that host (ADR-0003)',
              }
            : {
                  ok: false,
                  reason:
                      `${dependency} is routed but answered 404 for /api/v1/foods/search — the deployed food ` +
                      'service predates that endpoint (a stale image), so recipe calls a route it does not serve',
              };
    }

    if (status >= 200 && status < 300) {
        return {
            ok: false,
            reason:
                `${dependency} answered ${status} to an UNAUTHENTICATED catalog search, which must require a ` +
                'Clerk-verified token — either the auth guard is missing or this host is not the food service',
        };
    }

    if (status >= 500) {
        return {
            ok: false,
            reason: `${dependency} is routed but answered ${status} — the food service is failing`,
        };
    }

    return { ok: false, reason: `${dependency} answered an unexpected ${status}; expected 401 (unauthenticated)` };
}

/** Read `access-control-allow-origin` case-insensitively (header casing is not guaranteed). */
function allowOriginOf(headers: Headers): string | undefined {
    return headers.get('access-control-allow-origin') ?? undefined;
}

/** Whether a leg's preflights must admit the web origin or refuse it. */
export type CorsExpectation = 'admit' | 'deny';

/**
 * Send one preflight as a browser at `origin` would.
 *
 * @param baseUrl - The service origin.
 * @param path - The path to preflight.
 * @param origin - The browser origin.
 * @returns The status and allow-origin the browser would see.
 * @sideEffect Performs a network request.
 */
async function sendPreflight(baseUrl: string, path: string, origin: string): Promise<PreflightObservation> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'OPTIONS',
        headers: {
            origin,
            'access-control-request-method': 'GET',
            'access-control-request-headers': 'authorization',
        },
        signal: AbortSignal.timeout(15_000),
    });

    return { status: response.status, allowOrigin: allowOriginOf(response.headers) };
}

/**
 * Preflight one path as a browser at `origin` would, and judge it.
 *
 * @param baseUrl - The service origin.
 * @param path - The path to preflight.
 * @param origin - The browser origin.
 * @param expectation - Whether the path must admit or refuse the origin.
 * @returns The verdict, its reason prefixed with the path so a log names which route failed.
 * @sideEffect Performs a network request.
 */
async function preflight(
    baseUrl: string,
    path: string,
    origin: string,
    expectation: CorsExpectation,
): Promise<SmokeVerdict> {
    const observed = await sendPreflight(baseUrl, path, origin);
    const verdict =
        expectation === 'admit' ? classifyPreflight(origin, observed) : classifyPreflightDenied(origin, observed);

    return { ok: verdict.ok, reason: `${path}: ${verdict.reason}` };
}

/**
 * Preflight one path from {@link FOREIGN_PREFLIGHT_ORIGIN}, and judge it.
 *
 * @param baseUrl - The service origin.
 * @param path - The path to preflight.
 * @returns The verdict, its reason prefixed with the path.
 * @sideEffect Performs a network request.
 */
async function foreignPreflight(baseUrl: string, path: string): Promise<SmokeVerdict> {
    const verdict = classifyForeignPreflight(await sendPreflight(baseUrl, path, FOREIGN_PREFLIGHT_ORIGIN));

    return { ok: verdict.ok, reason: `${path}: ${verdict.reason}` };
}

/** Everything the smoke run needs to know about the deployment it is verifying. */
export interface SmokeTarget {
    /** The recipe service origin, e.g. `https://recipe-pr-73.commise.app`. */
    readonly baseUrl: string;
    /**
     * The browser origin the preflights are sent from. Omit to skip every preflight.
     *
     * A browser-facing service must ADMIT it; a service that enables no CORS must REFUSE it (`expectCors: 'deny'`,
     * plan 002 S2). Which one a deploy leg owes is not a judgement call left to the caller:
     * `prodDeploySmokeDepth.test.ts` derives it from whether the service's `main.ts` enables CORS.
     */
    readonly webOrigin?: string;
    /** The paths preflighted with {@link webOrigin}; default the recipe service's own ({@link DEFAULT_PREFLIGHT_PATH}). */
    readonly preflightPaths?: readonly string[];
    /** Whether those paths must admit {@link webOrigin} (default) or refuse it. */
    readonly expectCors?: CorsExpectation;
    /** Paths that must refuse {@link webOrigin} whatever {@link expectCors} says. */
    readonly denyPreflightPaths?: readonly string[];
    /** Image tag this deploy pushed; omit to skip the currency check. */
    readonly expectedImageTag?: string;
    /** Image tag read from the running task (resolved by the caller via the AWS CLI). */
    readonly runningImageTag?: string;
    /**
     * The food origin THIS stage's recipe service must call, from `foodServiceOriginForStage`. Omit to skip
     * the two ecosystem checks entirely.
     */
    readonly foodOrigin?: string;
    /** `FOOD_SERVICE_URL` as read from the RUNNING recipe task definition. */
    readonly configuredFoodOrigin?: string;
}

/**
 * Probe the food origin once, unauthenticated, and report what happened.
 *
 * The absence of an `authorization` header is the POINT — see {@link classifyDependencyReachability}. A
 * transport failure is a legitimate observation here, not an error to propagate, so it is caught and
 * returned as data.
 *
 * @sideEffect Performs a network request.
 */
async function probeDependency(foodOrigin: string, path: string): Promise<DependencyObservation> {
    try {
        const response = await fetch(`${foodOrigin}${path}`, {
            headers: { accept: 'application/json' },
            // Never follow a redirect: a 3xx is itself a finding (see the classifier), and following one
            // could turn a misroute into a misleading 200 from somewhere else entirely.
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000),
        });

        return {
            outcome: 'responded',
            status: response.status,
            contentType: response.headers.get('content-type') ?? undefined,
        };
    } catch (error) {
        return { outcome: 'no-response', detail: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Probe the deployed service and report every verdict.
 *
 * @param target - What to probe; see {@link SmokeTarget}.
 * @returns One verdict per check, in the order they were run.
 * @sideEffect Performs network requests.
 */
export async function runSmoke(target: SmokeTarget): Promise<readonly SmokeVerdict[]> {
    const { baseUrl, webOrigin, expectedImageTag, runningImageTag, foodOrigin, configuredFoodOrigin } = target;
    const verdicts: SmokeVerdict[] = [];
    const preflightPaths = target.preflightPaths ?? [DEFAULT_PREFLIGHT_PATH];

    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(15_000) });

    verdicts.push(classifyHealth(health.status));

    // Gated the same way the ecosystem checks below are: an absent flag means "this assertion does not
    // apply to this service", not "assert it against nothing". Sending the preflight with an undefined
    // origin would produce a verdict about a browser that does not exist.
    if (webOrigin !== undefined) {
        for (const path of preflightPaths) {
            verdicts.push(await preflight(baseUrl, path, webOrigin, target.expectCors ?? 'admit'));
            // A service that reflects any origin passes the check above, because it reflects the web origin too.
            verdicts.push(await foreignPreflight(baseUrl, path));
        }

        for (const path of target.denyPreflightPaths ?? []) {
            verdicts.push(await preflight(baseUrl, path, webOrigin, 'deny'));
        }
    }

    if (expectedImageTag !== undefined) {
        verdicts.push(classifyImageCurrency(runningImageTag, expectedImageTag));
    }

    if (foodOrigin !== undefined) {
        // Wiring first: if the task is pointed at the wrong food service, the reachability verdict below is
        // about a host this deployment does not actually call, and reading them in this order says so.
        verdicts.push(classifyDependencyWiring(foodOrigin, configuredFoodOrigin));

        const canonical = await probeDependency(foodOrigin, FOOD_SEARCH_PATH);
        // Only spend a second request when canonical looks like an app-level 404, i.e. the one shape a
        // pre-`/api`-prefix food service produces. See classifyDependencyReachability for why.
        const isAppNotFound =
            canonical.outcome === 'responded' &&
            canonical.status === 404 &&
            !(canonical.contentType ?? '').includes('text/plain');
        const legacy = isAppNotFound ? await probeDependency(foodOrigin, LEGACY_FOOD_SEARCH_PATH) : undefined;

        verdicts.push(classifyDependencyReachability(foodOrigin, canonical, legacy));
    }

    return verdicts;
}

/** How the CLI is invoked, printed on misuse. */
const USAGE =
    'usage: deployedSmoke.ts --base-url <url> [--web-origin <url>] [--preflight-path <path>]...\n' +
    '                        [--deny-preflight-path <path>]... [--expect-cors admit|deny]\n' +
    '                        [--expected-image-tag <tag>] [--running-image-tag <tag>]\n' +
    '                        [--food-origin <url>] [--configured-food-origin <url>]';

/**
 * The `::error::` line a failed run ends with, naming the service by the origin it probed. Pure.
 *
 * @param baseUrl - The probed service origin.
 * @returns The annotation.
 */
export function failureAnnotation(baseUrl: string): string {
    return `::error::the DEPLOYED service at ${baseUrl} failed post-deploy verification`;
}

/**
 * Parse the CLI flags. `parseArgs` infers each flag's type from its option, so only the repeatable flags are arrays.
 *
 * @param argv - The arguments after the script name.
 * @returns The flag values.
 * @throws {TypeError} on an unknown flag or a flag missing its value (`strict`).
 */
function parseFlags(argv: readonly string[]) {
    return parseArgs({
        args: [...argv],
        strict: true,
        options: {
            'base-url': { type: 'string' },
            'web-origin': { type: 'string' },
            'preflight-path': { type: 'string', multiple: true },
            'deny-preflight-path': { type: 'string', multiple: true },
            'expect-cors': { type: 'string' },
            'expected-image-tag': { type: 'string' },
            'running-image-tag': { type: 'string' },
            'food-origin': { type: 'string' },
            'configured-food-origin': { type: 'string' },
        },
    }).values;
}

/** A repeatable flag's values, blanks dropped (a blank interpolated variable is "not supplied"). Pure. */
function many(values: readonly string[] | undefined): string[] {
    return (values ?? []).filter((entry) => entry !== '');
}

/** Treat an absent or empty flag as "not supplied" — a shell that interpolates a blank var yields `''`. */
function optional(value: string | undefined): string | undefined {
    return value === undefined || value === '' ? undefined : value;
}

/**
 * CLI entrypoint. Exits non-zero if ANY check fails, so the deploy job goes red.
 *
 * Named flags (parsed by `node:util`'s {@link parseArgs}, not hand-rolled) rather than six positionals: the
 * call sites are YAML continuation lines, where a mis-ordered positional is invisible and would silently
 * compare the wrong pair of values.
 *
 * @sideEffect Network requests, stdout, and `process.exitCode`.
 */
export async function main(argv: readonly string[]): Promise<void> {
    let values: ReturnType<typeof parseFlags>;

    try {
        values = parseFlags(argv);
    } catch (error) {
        console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
        process.exitCode = 2;

        return;
    }

    const baseUrl = optional(values['base-url']);
    const webOrigin = optional(values['web-origin']);
    const expectCors = optional(values['expect-cors']) ?? 'admit';

    if (baseUrl === undefined || (expectCors !== 'admit' && expectCors !== 'deny')) {
        console.error(USAGE);
        process.exitCode = 2;

        return;
    }

    const preflightPaths = many(values['preflight-path']);
    const verdicts = await runSmoke({
        baseUrl,
        webOrigin,
        ...(preflightPaths.length === 0 ? {} : { preflightPaths }),
        expectCors,
        denyPreflightPaths: many(values['deny-preflight-path']),
        expectedImageTag: optional(values['expected-image-tag']),
        runningImageTag: optional(values['running-image-tag']),
        foodOrigin: optional(values['food-origin']),
        configuredFoodOrigin: optional(values['configured-food-origin']),
    });

    console.log(
        `Post-deploy smoke — ${baseUrl}` +
            (webOrigin === undefined ? ' (no browser origin: preflight skipped)' : ` (browser origin ${webOrigin})`),
    );

    for (const verdict of verdicts) {
        console.log(`  ${verdict.ok ? 'OK  ' : 'FAIL'} ${verdict.reason}`);
    }

    if (verdicts.some((verdict) => !verdict.ok)) {
        console.error(`\n${failureAnnotation(baseUrl)}`);
        process.exitCode = 1;
    }
}

// Run only when invoked directly (not when imported by the unit test).
if (import.meta.url === `file://${process.argv[1]}`) {
    await main(process.argv.slice(2));
}
