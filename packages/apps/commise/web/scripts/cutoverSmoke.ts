// Cutover smoke verifier for the sandbox subdomain migration (see
// docs/architecture/decisions/0001-sandbox-front-end-addressing.md and the migration plan).
//
// Given a PR number, probes BOTH addressing forms the router serves and classifies what a browser would
// get: NXDOMAIN (DNS/router gone), Vercel SSO (bypass key missing), 404 (route not registered / app
// miss), or the app itself. Use it to de-risk each cutover step with a repeatable check instead of
// ad-hoc curls.
//
// POST-CUTOVER (2026-07-13) the SUBDOMAIN form is the pass criterion: `pr-{N}.sandbox.commise.app` must
// reach the app, and the path form is expected to MISS (it redirects into `/en/pr-{N}` and 404s), so this
// reports it as INFO rather than failing on it. That is already how the exit code behaves; only this
// comment still described the pre-cutover posture ("path form must reach the app").
//
// It probes REACHABILITY only. It cannot tell you whether a human can actually sign in: the Clerk
// handshake currently redirects previews to the bare, SSO-protected Vercel deployment host, so an
// `app` verdict here does NOT mean the preview is usable while that is open.
//
// Run: npx tsx packages/apps/commise/web/scripts/cutoverSmoke.ts <pr-number> [--base sandbox.commise.app]

/** How a probed URL resolves, from a browser's perspective. */
export type ReachabilityKind = 'app' | 'sso' | 'notfound' | 'nxdomain' | 'error';

export interface ReachabilityResult {
    /** True only when the URL reached the application (not SSO / 404 / NXDOMAIN / error). */
    readonly ok: boolean;
    readonly kind: ReachabilityKind;
    /** Human-readable one-liner for the report. */
    readonly detail: string;
}

/** The raw signals a probe collects: a thrown error's code, or the final URL + HTTP status. */
export interface ProbeSignals {
    readonly errorCode?: string;
    readonly finalUrl?: string;
    readonly status?: number;
}

const DNS_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL']);

/**
 * Classify a probe's raw signals into a reachability verdict. Pure — all network I/O happens in
 * {@link probe}; this is the decision the report and exit code hang on, so it is unit-tested directly.
 *
 * @param signals - Either an `errorCode` (fetch threw) OR a `finalUrl` + `status` (fetch resolved).
 * @returns The verdict: `ok` is true only for `kind: 'app'`.
 */
export function classifyReachability(signals: ProbeSignals): ReachabilityResult {
    if (signals.errorCode !== undefined) {
        if (DNS_ERROR_CODES.has(signals.errorCode)) {
            return { ok: false, kind: 'nxdomain', detail: `DNS did not resolve (${signals.errorCode})` };
        }

        return { ok: false, kind: 'error', detail: `request failed (${signals.errorCode})` };
    }

    const finalUrl = signals.finalUrl ?? '';
    const status = signals.status ?? 0;

    // A Vercel SSO/login landing means the protection-bypass key is missing or wrong.
    if (/vercel\.com\/(sso|login)/i.test(finalUrl)) {
        return { ok: false, kind: 'sso', detail: `Vercel deployment protection (bypass missing) → ${finalUrl}` };
    }

    if (status === 404) {
        return { ok: false, kind: 'notfound', detail: '404 — route not registered in KVS, or app miss' };
    }

    // Reached the app: a success/redirect that did NOT land on vercel.com.
    if (status >= 200 && status < 400 && !/(^|\.)vercel\.com/i.test(new URL(finalUrl || 'http://x').host)) {
        return {
            ok: true,
            kind: 'app',
            detail: `reached the app (HTTP ${status}${finalUrl ? ` at ${finalUrl}` : ''})`,
        };
    }

    return { ok: false, kind: 'error', detail: `unexpected response (HTTP ${status} at ${finalUrl})` };
}

/** Pull a network-error code from a thrown fetch error (Node puts it on `err.cause.code`). */
function errorCodeOf(err: unknown): string {
    const cause = (err as { cause?: { code?: string } } | undefined)?.cause;

    return cause?.code ?? (err as { code?: string } | undefined)?.code ?? 'UNKNOWN';
}

/**
 * Probe a single URL and classify how it resolves. Follows redirects so a Vercel SSO bounce or an app
 * sign-in redirect is observed at the FINAL hop.
 *
 * @param url - The URL to probe.
 * @param timeoutMs - Abort after this many ms (default 30s).
 * @returns The reachability verdict.
 * @sideEffect Performs a network request.
 */
export async function probe(url: string, timeoutMs = 30_000): Promise<ReachabilityResult> {
    try {
        const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });

        return classifyReachability({ finalUrl: response.url, status: response.status });
    } catch (err) {
        return classifyReachability({ errorCode: errorCodeOf(err) });
    }
}

/** Build the path-routed and subdomain URLs for a PR under a base domain. Pure. */
export function urlsForPr(pr: number, base: string): { path: string; subdomain: string } {
    return {
        path: `https://${base}/pr-${pr}/`,
        subdomain: `https://pr-${pr}.${base}/`,
    };
}

/** Which addressing form is the LIVE posture that must reach the app. Pure. */
export type ExpectedMode = 'path' | 'subdomain';

/** Parse `--expect path|subdomain` (default `subdomain`, the live posture post-cutover). Pure. */
export function parseExpectedMode(argv: readonly string[]): ExpectedMode {
    const idx = argv.indexOf('--expect');
    const value = idx >= 0 ? argv[idx + 1] : undefined;

    return value === 'path' ? 'path' : 'subdomain';
}

/**
 * CLI entrypoint: probe both forms for a PR and print a report. Exit 1 if the EXPECTED form (the live
 * addressing posture — `--expect subdomain` by default, `path` pre-cutover) does not reach the app. The
 * other form is reported for visibility; once the cutover lands, the path form 404s by design.
 *
 * @sideEffect Network requests, stdout, and process.exitCode.
 */
export async function main(argv: readonly string[]): Promise<void> {
    const positional = argv.filter((a) => !a.startsWith('--') && !Number.isNaN(Number(a)));
    const pr = Number(positional[0]);
    const baseIdx = argv.indexOf('--base');
    const base = baseIdx >= 0 ? argv[baseIdx + 1]! : 'sandbox.commise.app';
    const expected = parseExpectedMode(argv);

    if (!Number.isInteger(pr) || pr <= 0) {
        console.error('usage: cutoverSmoke.ts <pr-number> [--expect path|subdomain] [--base sandbox.commise.app]');
        process.exitCode = 2;

        return;
    }

    const { path, subdomain } = urlsForPr(pr, base);
    const [pathResult, subResult] = await Promise.all([probe(path), probe(subdomain)]);
    const label = (mode: ExpectedMode, r: ReachabilityResult): string =>
        mode === expected ? (r.ok ? 'OK  ' : 'FAIL') : 'INFO';

    console.log(`Cutover smoke — PR #${pr} (base ${base}, expecting ${expected})`);
    console.log(`  path      ${path}`);
    console.log(`            ${label('path', pathResult)} [${pathResult.kind}] ${pathResult.detail}`);
    console.log(`  subdomain ${subdomain}`);
    console.log(`            ${label('subdomain', subResult)} [${subResult.kind}] ${subResult.detail}`);

    const expectedResult = expected === 'path' ? pathResult : subResult;

    if (!expectedResult.ok) {
        console.error(`\nFAIL: the ${expected} preview does not reach the app (the live posture is broken).`);
        process.exitCode = 1;
    }
}

// Run only when invoked directly (not when imported by the unit test).
if (import.meta.url === `file://${process.argv[1]}`) {
    await main(process.argv.slice(2));
}
