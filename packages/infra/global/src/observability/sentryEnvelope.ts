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
interface IngestTarget {
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
