/**
 * Sentry for the Lambda@Edge viewer-request verifier (plan U20).
 *
 * ⛔ WHY NOT THE SDK. Two hard constraints meet here. A viewer-request function's code limit is **1 MB**, and
 * `@sentry/aws-serverless` is far larger than the verifier itself — the bundle exists at all because
 * `dist-lambda` was too big for this limit. And Lambda@Edge **cannot read environment variables**, so an SDK
 * that reads `SENTRY_DSN` at init would initialise to nothing. What is left is the part that matters: one
 * POST of one envelope to Sentry's ingest endpoint, with the DSN compiled in exactly as the Clerk key is.
 *
 * ⛔ WHY NOT THE DRAIN. ADR-0042 leaves Lambda@Edge out on purpose: a replica writes to a log group in
 * whichever region served the viewer, and no single stack can enumerate them. So this is the ONLY path by
 * which this function's failures become visible anywhere.
 *
 * ⛔ WHAT IS REPORTED, AND WHAT IS NOT. A rejected TOKEN is not a failure — it is the function doing its job,
 * on every request from every signed-out browser and every bot, and reporting it would be an issue per
 * request. What is reported is an UNEXPECTED throw: the verifier itself failing, which today returns a
 * CloudFront error to a real viewer and is recorded nowhere.
 *
 * ⛔ AND IT NEVER CHANGES THE ANSWER. The report is fire-and-forget under a deadline well inside the
 * function's own timeout, and every failure path — an unreachable Sentry, a slow one, a malformed DSN — is
 * swallowed. The verifier's decision is on the request path for every viewer; telemetry that can fail it is
 * worse than no telemetry.
 *
 * ⚠️ NO REQUEST HEADERS, NO TOKEN, NO URI. The event carries a viewer's `Authorization` header and their
 * path. Neither goes into an event: what is sent is the error's name and message, the stage, and the
 * distribution — identifiers, exactly as `@kitchensink/queue-check`'s payload rule requires.
 */

/** How long a report may take before it is abandoned. Well inside the verifier's 5-second timeout. */
export const EDGE_REPORT_DEADLINE_MS = 400;

import { parseDsn } from '../observability/sentryEnvelope.js';

/** The compiled-in DSN, substituted by `esbuild.mjs`. Empty when the build had none. */
declare const __SENTRY_EDGE_DSN__: string;

/** Identifiers that may accompany an edge report. ⛔ No free text — see the module docstring. */
export interface EdgeReportContext {
    readonly stage: string;
    readonly distributionId: string;
}

/**
 * Build the Sentry envelope for one verifier failure.
 *
 * @param error - The unexpected throwable.
 * @param context - Stage and distribution identifiers.
 * @returns The envelope body. Pure.
 */
export function buildEnvelope(error: unknown, context: EdgeReportContext): string {
    const name = error instanceof Error ? error.name : 'NonError';
    const message = error instanceof Error ? error.message : String(error);
    const header = JSON.stringify({ sent_at: new Date().toISOString() });
    const itemHeader = JSON.stringify({ type: 'event' });
    const event = JSON.stringify({
        level: 'error',
        platform: 'node',
        environment: context.stage,
        tags: { service: 'edge-verifier', distribution: context.distributionId },
        exception: { values: [{ type: name, value: message }] },
    });

    return `${header}\n${itemHeader}\n${event}\n`;
}

/**
 * Report a verifier failure, best-effort and bounded.
 *
 * @param error - The unexpected throwable.
 * @param context - Stage and distribution identifiers.
 * @param dsn - Overridable for the suite; defaults to the compiled-in value.
 * @returns Whether an envelope was sent.
 * @sideEffect Issues at most one HTTP POST.
 */
export async function reportEdgeFailure(
    error: unknown,
    context: EdgeReportContext,
    dsn: string = typeof __SENTRY_EDGE_DSN__ === 'string' ? __SENTRY_EDGE_DSN__ : '',
): Promise<boolean> {
    const target = parseDsn(dsn);

    if (target === undefined) {
        return false;
    }

    try {
        const abort = AbortSignal.timeout(EDGE_REPORT_DEADLINE_MS);

        await fetch(target.url, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-sentry-envelope',
                'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${target.key}`,
            },
            body: buildEnvelope(error, context),
            signal: abort,
        });

        return true;
    } catch {
        // ⛔ SWALLOWED, always. This sits on the request path of every viewer; a report that can fail a
        // request is strictly worse than no report. The verifier's own answer is decided before this runs.
        return false;
    }
}
