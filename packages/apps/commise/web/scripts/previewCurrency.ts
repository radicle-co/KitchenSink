// Does a PR's web preview serve the commit this run tests? Asked before the deployed Playwright tier runs.
//
// Run 38791689080 is why this exists. Its eight shards drove `pr-91.sandbox.commise.app` while that hostname served
// a Vercel deployment built from 249a376f1, 29 commits behind the commit under test, and seven shards went green over
// a UI they were not testing. The services have a "deployed image is CURRENT" smoke; the web preview had none.
//
// ⛔ A PUSH DOES NOT MOVE THE ALIAS (ADR-0060). Vercel builds every push, but the hostname keeps serving the
// deployment Sandbox Up last pointed it at (`createPreviewDomain.ts`). So the build being green says nothing about
// what the hostname serves — only the alias does, and that is what this reads.
//
// ⛔ WHICH COMMIT. Vercel builds the PR's BRANCH, so a preview's `meta.githubCommitSha` is a head commit and never
// the `refs/pull/N/merge` commit a `pull_request` run checks out. The head sha is therefore the only one a preview
// can match, and the caller passes it. Residual, stated: the specs run from the merge ref, so a base-branch change to
// a spec is tested against a UI built without that base change.
//
// ⛔ FAILS CLOSED. Anything other than a READY deployment of OUR project whose commit equals the expected one is not
// `current`: a Vercel error, a missing alias, a missing commit, another project's alias. The sandbox IS up when
// this runs (the tier is skipped upstream when it is not), so "cannot tell" is a red, never a skip.
//
// @pattern Specification — `judgePreviewCurrency` is a pure predicate over one reading
// @pattern Adapter — `readServedDeployment` over Vercel's alias and deployment reads, behind the shared `HttpSender`
import { z } from 'zod';

import {
    PreviewScopeError,
    previewHostForPrToken,
    requireEnv,
    requirePreviewHost,
    vercelApiUrl,
    type HttpSender,
    type VercelProjectConfig,
} from './previewDomainScope';

/** A full git commit sha. A short one could match more than one commit, so it is never accepted. */
const COMMIT_SHA = /^[0-9a-f]{40}$/u;

/** What the hostname serves, as Vercel reports it — or why that could not be read. */
export type ServedDeploymentReading =
    | {
          readonly kind: 'read';
          readonly deploymentId: string;
          readonly projectId: string;
          readonly readyState: string;
          readonly commitSha: string | undefined;
      }
    | { readonly kind: 'failed'; readonly reason: string };

/** The answer. Only `current` lets the deployed web tier run. */
export type PreviewCurrencyVerdict =
    | { readonly kind: 'current'; readonly host: string; readonly deploymentId: string; readonly sha: string }
    | {
          readonly kind: 'stale';
          readonly host: string;
          readonly deploymentId: string;
          readonly servedSha: string;
          readonly expectedSha: string;
      }
    | { readonly kind: 'unverifiable'; readonly host: string; readonly reason: string };

/**
 * `GET /v4/aliases/{host}` — the fields this check reads.
 *
 * @unparsedBoundary Vercel is a third-party API we do not serve (ADR-0014, CODING_STANDARDS §15.3), so the shape is
 *   validated here, at the boundary, rather than declared as a contract of ours.
 */
const aliasSchema = z.object({ deploymentId: z.string().min(1), projectId: z.string().min(1) });

/** `GET /v13/deployments/{id}` — the fields this check reads. `meta` is absent on a deployment not made from git. */
const deploymentSchema = z.object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    readyState: z.string(),
    meta: z.object({ githubCommitSha: z.string().optional() }).optional(),
});

/**
 * The preview host this run drives, from its stage — and the proof that the origin Playwright is handed names it.
 *
 * The two arrive separately (the stage and the resolved `web_origin`). If they disagreed, this would check one host
 * while the suite drove another, so a disagreement is refused. Pure.
 *
 * @param prToken - The run's target stage, `pr-{N}`.
 * @param previewZone - `sandbox.<domain>`.
 * @param webOrigin - The origin the deployed web tier drives.
 * @returns The host, `pr-{N}.<zone>`.
 * @throws PreviewScopeError When the stage is not a preview, or the origin is not `https://` that exact host.
 */
export function previewHostForRun(prToken: string, previewZone: string, webOrigin: string): string {
    const host = previewHostForPrToken(prToken, previewZone);
    let origin: URL;

    try {
        origin = new URL(webOrigin);
    } catch {
        throw new PreviewScopeError(`preview-currency: the web origin '${webOrigin}' is not a URL`);
    }

    if (origin.protocol !== 'https:' || origin.host !== host || (origin.pathname !== '/' && origin.pathname !== '')) {
        throw new PreviewScopeError(
            `preview-currency: the web origin '${webOrigin}' is not https://${host}, the preview of ${prToken} — this check would read a different host than the suite drives`,
        );
    }

    return host;
}

/**
 * GET one Vercel resource and parse it, turning every way that can fail into a reason.
 *
 * @sideEffect One HTTPS request to the Vercel API.
 */
async function getParsed<T>(
    http: HttpSender,
    config: VercelProjectConfig,
    path: string,
    what: string,
    schema: z.ZodType<T>,
): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }> {
    let status: number;
    let text: string;

    try {
        const response = await http(vercelApiUrl(path, config), {
            method: 'GET',
            headers: { Authorization: `Bearer ${config.token}` },
        });

        status = response.status;
        text = await response.text();

        if (!response.ok) {
            return { ok: false, reason: `the ${what} read answered ${status}` };
        }
    } catch (error) {
        return {
            ok: false,
            reason: `the ${what} read did not complete (${error instanceof Error ? error.message : 'unknown error'})`,
        };
    }

    let body: unknown;

    try {
        body = JSON.parse(text);
    } catch {
        return { ok: false, reason: `the ${what} read answered ${status} with a body that is not JSON` };
    }

    const parsed = schema.safeParse(body);

    return parsed.success
        ? { ok: true, value: parsed.data }
        : { ok: false, reason: `the ${what} read answered ${status} without the fields this check needs` };
}

/**
 * Which deployment the preview hostname serves: its alias, then the deployment that alias names.
 *
 * @param http - `fetch`, or a double.
 * @param config - Vercel token, project and team.
 * @param host - The `pr-{N}.<zone>` host — re-asserted here, never trusted.
 * @param previewZone - The zone the host must sit DIRECTLY under.
 * @returns The reading, or why it could not be made. Never throws for a Vercel failure.
 * @throws PreviewScopeError When `host` is not `pr-{N}` directly under `previewZone`.
 * @sideEffect Two HTTPS reads against the Vercel API.
 */
export async function readServedDeployment(
    http: HttpSender,
    config: VercelProjectConfig,
    host: string,
    previewZone: string,
): Promise<ServedDeploymentReading> {
    const scoped = requirePreviewHost(host, previewZone);

    const alias = await getParsed(http, config, `/v4/aliases/${encodeURIComponent(scoped)}`, 'alias', aliasSchema);

    if (!alias.ok) {
        return { kind: 'failed', reason: alias.reason };
    }

    const deployment = await getParsed(
        http,
        config,
        `/v13/deployments/${encodeURIComponent(alias.value.deploymentId)}`,
        'deployment',
        deploymentSchema,
    );

    if (!deployment.ok) {
        return { kind: 'failed', reason: deployment.reason };
    }

    if (deployment.value.id !== alias.value.deploymentId) {
        return {
            kind: 'failed',
            reason: `the alias names ${alias.value.deploymentId} but Vercel answered for ${deployment.value.id}`,
        };
    }

    return {
        kind: 'read',
        deploymentId: deployment.value.id,
        projectId: alias.value.projectId,
        readyState: deployment.value.readyState,
        commitSha: deployment.value.meta?.githubCommitSha,
    };
}

/**
 * Whether the preview serves the commit under test. Pure.
 *
 * @param input - The host, the expected head commit, our Vercel project, and what Vercel reported.
 * @returns `current` only for a READY deployment of our project built from exactly that commit.
 */
export function judgePreviewCurrency(input: {
    readonly host: string;
    readonly expectedSha: string;
    readonly projectId: string;
    readonly reading: ServedDeploymentReading;
}): PreviewCurrencyVerdict {
    const { host, reading } = input;
    const expectedSha = input.expectedSha.trim().toLowerCase();

    if (!COMMIT_SHA.test(expectedSha)) {
        return { kind: 'unverifiable', host, reason: `the commit under test '${input.expectedSha}' is not a full sha` };
    }

    if (reading.kind === 'failed') {
        return { kind: 'unverifiable', host, reason: reading.reason };
    }

    if (reading.projectId !== input.projectId) {
        return {
            kind: 'unverifiable',
            host,
            reason: `the alias belongs to Vercel project ${reading.projectId}, not ${input.projectId}`,
        };
    }

    if (reading.readyState !== 'READY') {
        return {
            kind: 'unverifiable',
            host,
            reason: `the deployment it serves, ${reading.deploymentId}, is ${reading.readyState}, not READY`,
        };
    }

    const servedSha = (reading.commitSha ?? '').trim().toLowerCase();

    if (!COMMIT_SHA.test(servedSha)) {
        return {
            kind: 'unverifiable',
            host,
            reason: `the deployment it serves, ${reading.deploymentId}, records no full commit sha (meta.githubCommitSha is '${reading.commitSha ?? ''}')`,
        };
    }

    if (servedSha !== expectedSha) {
        return { kind: 'stale', host, deploymentId: reading.deploymentId, servedSha, expectedSha };
    }

    return { kind: 'current', host, deploymentId: reading.deploymentId, sha: servedSha };
}

/**
 * The whole check: refuse a bad expected sha before asking anything, then read and judge.
 *
 * @param http - `fetch`, or a double.
 * @param options - The stage, zone, origin, expected commit and Vercel project.
 * @returns The verdict.
 * @throws PreviewScopeError When the stage or origin is outside the preview scope.
 * @sideEffect Up to two HTTPS reads against the Vercel API.
 */
export async function checkPreviewCurrency(
    http: HttpSender,
    options: {
        readonly prToken: string;
        readonly previewZone: string;
        readonly webOrigin: string;
        readonly expectedSha: string;
        readonly vercel: VercelProjectConfig;
    },
): Promise<PreviewCurrencyVerdict> {
    const host = previewHostForRun(options.prToken, options.previewZone, options.webOrigin);

    if (!COMMIT_SHA.test(options.expectedSha.trim().toLowerCase())) {
        return {
            kind: 'unverifiable',
            host,
            reason: `the commit under test '${options.expectedSha}' is not a full sha`,
        };
    }

    const reading = await readServedDeployment(http, options.vercel, host, options.previewZone);

    return judgePreviewCurrency({
        host,
        expectedSha: options.expectedSha,
        projectId: options.vercel.projectId,
        reading,
    });
}

/**
 * The log line for a verdict — a GitHub `::error::` for anything but `current`. Pure.
 *
 * @param verdict - The verdict.
 * @param prToken - The stage, for the remedy.
 * @returns One line.
 */
export function describeVerdict(verdict: PreviewCurrencyVerdict, prToken: string): string {
    switch (verdict.kind) {
        case 'current':
            return `the web preview https://${verdict.host} serves ${verdict.deploymentId}, built from ${verdict.sha} — the commit under test`;
        case 'stale':
            return (
                `::error::the web preview https://${verdict.host} serves Vercel deployment ${verdict.deploymentId}, ` +
                `built from ${verdict.servedSha}, but this run tests ${verdict.expectedSha}, so the deployed web tier ` +
                `would prove nothing about this commit's UI. A push does not move the preview alias (ADR-0060): wait ` +
                `for this commit's Vercel preview build to finish, press Sandbox Up for ${prToken} to point the alias ` +
                `at it, then re-run this job.`
            );
        case 'unverifiable':
            return (
                `::error::cannot tell which commit the web preview https://${verdict.host} serves — ${verdict.reason}. ` +
                `The sandbox is up, so this fails rather than skips: the deployed web tier would run over a UI nobody ` +
                `can name. If the preview is simply behind, press Sandbox Up for ${prToken} once this commit's Vercel ` +
                `build has finished (ADR-0060).`
            );
    }
}

/**
 * CLI entry: `PR_TOKEN`, `PREVIEW_ZONE`, `WEB_ORIGIN`, `EXPECTED_COMMIT_SHA`, `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` and
 * (optional) `VERCEL_TEAM_ID`. Exits 1 on anything but `current`.
 *
 * @sideEffect Reads the Vercel API and writes the verdict to stdout.
 */
async function main(): Promise<void> {
    const prToken = requireEnv('PR_TOKEN');
    const verdict = await checkPreviewCurrency(globalThis.fetch, {
        prToken,
        previewZone: requireEnv('PREVIEW_ZONE'),
        webOrigin: requireEnv('WEB_ORIGIN'),
        expectedSha: process.env['EXPECTED_COMMIT_SHA'] ?? '',
        vercel: {
            token: requireEnv('VERCEL_TOKEN'),
            projectId: requireEnv('VERCEL_PROJECT_ID'),
            teamId: process.env['VERCEL_TEAM_ID'],
        },
    });

    console.log(describeVerdict(verdict, prToken));

    if (verdict.kind !== 'current') {
        process.exit(1);
    }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err: unknown) => {
        console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
}
