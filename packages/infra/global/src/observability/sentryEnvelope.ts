/**
 * The parts of a Sentry envelope POST that are not specific to what is being reported.
 *
 * ⛔ WHY THIS PACKAGE HAND-ROLLS THE PROTOCOL AT ALL, rather than taking `@sentry/aws-serverless`. Two of its
 * functions cannot have the SDK: the Lambda@Edge verifier is under a 1 MB code limit and cannot read
 * environment variables, and the platform Lambdas (`db-bootstrap`, `db-reaper`) are small custom-resource and
 * scheduled functions whose whole job is one database pass — an SDK an order of magnitude larger than the
 * handler, pulling OpenTelemetry into a CloudFormation custom resource, buys grouping and costs a cold start
 * on the critical path of a deploy. What all of them actually need is one POST of one envelope.
 *
 * ⛔ THE DSN PARSER LIVES HERE RATHER THAN IN EITHER CALLER. A Sentry DSN's shape is one piece of knowledge,
 * and two copies of it fail the way copies always fail: only one gets fixed. The ENVELOPE is not shared, on
 * purpose — the edge reports an exception and the platform reports a message, and merging those into one
 * flag-driven builder would be the wrong abstraction rather than the DRY one.
 */

/** What a Sentry DSN decomposes into for a direct envelope POST. */
export interface IngestTarget {
    readonly url: string;
    readonly key: string;
}

/**
 * Split a DSN into the ingest URL and the public key.
 *
 * ⚠️ Total: a malformed or empty DSN answers `undefined` rather than throwing. This runs on every viewer
 * request path, and a parse error in telemetry setup must never be able to fail a request.
 *
 * @param dsn - The Sentry DSN.
 * @returns The ingest target, or `undefined` when the DSN is absent or unusable. Pure.
 */
export function parseDsn(dsn: string): IngestTarget | undefined {
    try {
        const parsed = new URL(dsn);
        const projectId = parsed.pathname.replace(/^\//u, '');

        if (!parsed.username || !projectId) {
            return undefined;
        }

        return { url: `${parsed.origin}/api/${projectId}/envelope/`, key: parsed.username };
    } catch {
        return undefined;
    }
}

/**
 * POST one envelope, bounded by a deadline.
 *
 * ⛔ THE ANSWER IS EXACT AND NOTHING IS SWALLOWED INTO SILENCE: `true` only for a 2xx. `fetch` rejects on a transport
 * failure but RESOLVES for a 401, a 413 or a 429, so an expired DSN key would otherwise read as "sent" forever. It never
 * throws, so that the caller decides what a failed delivery means: the silent-no-op reporter swallows it (a failed
 * report must not fail a deploy), the alarm relay turns it into a failed invocation (a dropped alarm is the failure it
 * exists to prevent). Putting that policy here would give one of them the wrong one.
 *
 * @param target - Where to post, from {@link parseDsn}.
 * @param body - The serialized envelope.
 * @param deadlineMs - How long the whole request may take before it is abandoned.
 * @returns Whether Sentry accepted the envelope.
 * @sideEffect Issues one HTTP POST.
 */
export async function postEnvelope(target: IngestTarget, body: string, deadlineMs: number): Promise<boolean> {
    try {
        const response = await fetch(target.url, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-sentry-envelope',
                'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${target.key}`,
            },
            body,
            signal: AbortSignal.timeout(deadlineMs),
        });

        return response.ok;
    } catch {
        return false;
    }
}
