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
 * | {@link classifyImageCurrency} | a healthy, correct, but OUT-OF-DATE build is running |
 *
 * The classifiers are pure so they are unit-tested directly; {@link main} owns all I/O.
 */

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

    if (allowOrigin !== '*' && allowOrigin !== origin) {
        return {
            ok: false,
            reason: `CORS preflight allowed "${allowOrigin}" but the caller is "${origin}"`,
        };
    }

    return { ok: true, reason: `CORS preflight allows ${origin}` };
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

/** Read `access-control-allow-origin` case-insensitively (header casing is not guaranteed). */
function allowOriginOf(headers: Headers): string | undefined {
    return headers.get('access-control-allow-origin') ?? undefined;
}

/**
 * Probe the deployed service and report every verdict.
 *
 * @param baseUrl - The service origin, e.g. `https://recipe-pr-73.commise.app`.
 * @param webOrigin - The front-end origin that must be CORS-allowed.
 * @param expectedImageTag - Image tag this deploy pushed; omit to skip the currency check.
 * @param runningImageTag - Image tag read from the running task (resolved by the caller via the AWS CLI).
 * @returns One verdict per check, in the order they were run.
 * @sideEffect Performs network requests.
 */
export async function runSmoke(
    baseUrl: string,
    webOrigin: string,
    expectedImageTag?: string,
    runningImageTag?: string,
): Promise<readonly SmokeVerdict[]> {
    const verdicts: SmokeVerdict[] = [];

    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(15_000) });

    verdicts.push(classifyHealth(health.status));

    const preflight = await fetch(`${baseUrl}/v1/recipes`, {
        method: 'OPTIONS',
        headers: {
            origin: webOrigin,
            'access-control-request-method': 'GET',
            'access-control-request-headers': 'authorization',
        },
        signal: AbortSignal.timeout(15_000),
    });

    verdicts.push(
        classifyPreflight(webOrigin, { status: preflight.status, allowOrigin: allowOriginOf(preflight.headers) }),
    );

    if (expectedImageTag !== undefined) {
        verdicts.push(classifyImageCurrency(runningImageTag, expectedImageTag));
    }

    return verdicts;
}

/**
 * CLI entrypoint. Exits non-zero if ANY check fails, so the deploy job goes red.
 *
 * Usage: tsx deployedSmoke.ts <baseUrl> <webOrigin> [expectedImageTag] [runningImageTag]
 *
 * @sideEffect Network requests, stdout, and `process.exitCode`.
 */
export async function main(argv: readonly string[]): Promise<void> {
    const [baseUrl, webOrigin, expectedImageTag, runningImageTag] = argv;

    if (baseUrl === undefined || webOrigin === undefined) {
        console.error('usage: deployedSmoke.ts <baseUrl> <webOrigin> [expectedImageTag] [runningImageTag]');
        process.exitCode = 2;

        return;
    }

    const verdicts = await runSmoke(baseUrl, webOrigin, expectedImageTag, runningImageTag);

    console.log(`Post-deploy smoke — ${baseUrl} (browser origin ${webOrigin})`);

    for (const verdict of verdicts) {
        console.log(`  ${verdict.ok ? 'OK  ' : 'FAIL'} ${verdict.reason}`);
    }

    if (verdicts.some((verdict) => !verdict.ok)) {
        console.error('\n::error::the DEPLOYED recipe service failed post-deploy verification');
        process.exitCode = 1;
    }
}

// Run only when invoked directly (not when imported by the unit test).
if (import.meta.url === `file://${process.argv[1]}`) {
    await main(process.argv.slice(2));
}
