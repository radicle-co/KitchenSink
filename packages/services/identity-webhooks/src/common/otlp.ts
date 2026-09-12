/**
 * Pure transforms for the CloudWatch -> Sentry log drain (U4).
 *
 * Shapes CloudWatch Logs subscription payloads into OTLP/JSON log records and derives the Sentry
 * OTLP ingest target from the log-drain DSN. Kept separate from the handler so the transport is
 * swappable for an OTel Collector later (KTD1) and so the mapping + scrubbing are unit-testable.
 */
import { identifyLogSource } from './logDrainRegister.js';

export interface OtlpTarget {
    url: string;
    authHeader: string;
}

export interface ParsedCloudWatchLogs {
    logGroup: string;
    logStream: string;
    logEvents: Array<{ id?: string; timestamp: number; message: string }>;
}

interface OtlpAttribute {
    key: string;
    value: { stringValue: string };
}

interface OtlpLogRecord {
    timeUnixNano: string;
    severityText: string;
    body: { stringValue: string };
    attributes: OtlpAttribute[];
}

export interface OtlpLogsPayload {
    resourceLogs: Array<{
        resource: { attributes: OtlpAttribute[] };
        scopeLogs: Array<{ logRecords: OtlpLogRecord[] }>;
    }>;
}

/**
 * Derive the Sentry OTLP-logs endpoint and auth header from the log-drain DSN.
 * DSN shape: `https://<publicKey>@o<org>.ingest.<region>.sentry.io/<projectId>`.
 */
export const parseLogDrainDsn = (dsn: string): OtlpTarget => {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\/+/, '');

    if (!publicKey || !projectId) {
        throw new Error('Invalid LOG_DRAIN_DSN: missing public key or project id');
    }

    return {
        url: `${url.protocol}//${url.host}/api/${projectId}/integration/otlp/v1/logs`,
        authHeader: `sentry sentry_key=${publicKey}`,
    };
};

const attr = (key: string, value: string): OtlpAttribute => ({ key, value: { stringValue: value } });

const SENSITIVE_LOG_KEYS = new Set(['ip', 'caller', 'sourceip', 'user', 'identity', 'xforwardedfor']);

/** Path segments that identify a user/entity (UUID, ULID, or long numeric id). */
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9A-HJKMNP-TV-Z]{26}|\d{6,})$/i;

const redactIdSegments = (value: string): string =>
    value
        .split('/')
        .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
        .join('/');

/**
 * Scrub a single CloudWatch access-log line before it leaves for a third party. API Gateway's
 * `jsonWithStandardFields` includes caller IP and request paths that may embed user ids; these
 * bypass the per-SDK scrubbers, so the forwarder strips them here (security P1 / KTD8). Non-JSON
 * lines pass through unchanged.
 *
 * ⚠️ THE OUTPUT CAN CARRY A `__proto__` KEY, and that is the fix rather than a leak. These keys come from
 * a parsed LOG LINE — the most data-derived source in this repository — and rebuilding onto an object
 * LITERAL sent a field named `__proto__` to `Object.prototype`'s inherited setter, so it was silently
 * DROPPED: a sanitizer that deleted evidence instead of redacting it. It is kept as DATA now, which means
 * the line this function emits, and which the forwarder hands to a third party, may contain that key.
 * Every consumer in the path reads it with `JSON.parse`, which defines own properties and cannot be
 * polluted; one that rebuilt an object with `obj[key] = …` would be. Asserted both ways in `otlp.test.ts`.
 *
 * @param message - One raw CloudWatch log line.
 * @returns The line with sensitive fields redacted, or unchanged when it is not a JSON object. Pure.
 */
export const sanitizeAccessLogMessage = (message: string): string => {
    let parsed: unknown;

    try {
        parsed = JSON.parse(message);
    } catch {
        return message;
    }

    if (parsed === null || typeof parsed !== 'object') {
        return message;
    }

    // ⛔ `Object.fromEntries`, NOT a null-prototype accumulator. Both close the defect — a field named
    // `__proto__` reaching `Object.prototype`'s inherited setter and vanishing — but `Object.create(null)`
    // still assigns with `[[Set]]`, and CodeQL's `js/remote-property-injection` does not recognise it as a
    // sanitizer: the same fix applied to the shared scrubbers left all three alerts standing. `fromEntries`
    // uses `CreateDataProperty` and never `[[Set]]`, which satisfies the defect and the query.
    // ⚠️ `Object.assign` is the SAME sink as `out[key] = …` and is not an alternative here.
    return JSON.stringify(
        Object.fromEntries(
            Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
                if (SENSITIVE_LOG_KEYS.has(key.toLowerCase())) {
                    return [key, '[redacted]'];
                }

                if (typeof value === 'string' && /path|resource|uri/i.test(key)) {
                    return [key, redactIdSegments(value)];
                }

                return [key, value];
            }),
        ),
    );
};

/**
 * Derive the deployment stage from a CloudWatch log group name.
 *
 * ⛔ REWRITTEN (plan U15) from a single regex to the REGISTER in `logDrainRegister.ts`, because the regex was
 * wrong for two of the groups it was meant to serve and wrong SILENTLY:
 *
 *  - the identity ECS group is `/kitchensink/identity-service/<stage>` — slashes, not hyphens — so it matched
 *    nothing and every line from the service that serves real users arrived tagged `environment:unknown`;
 *  - a sandbox webhook group takes CDK's generated name, and the pattern's `sandbox-[a-z0-9]+` arm swallowed
 *    the construct id, producing an environment called `sandbox-webhookslogroup` that nobody filters on.
 *
 * ⚠️ `'unknown'` SURVIVES as the return for an unregistered group, and only here. The register itself refuses
 * to guess (`identifyLogSource` answers `undefined`), but this function's caller is a log forwarder whose
 * first duty is not to drop logs: a group nobody registered is still worth forwarding, mislabelled, rather
 * than discarded. The difference from before is that `unknown` now means "nobody registered this group",
 * never "the regex did not fit a group we own" — and `logDrainRegister.test.ts` asserts no registered group
 * produces it.
 */
export const stageFromLogGroup = (logGroup: string): string => identifyLogSource(logGroup)?.stage ?? 'unknown';

const detectSeverity = (message: string): string => {
    if (/\b(error|fatal|exception)\b/i.test(message)) {
        return 'ERROR';
    }

    if (/\bwarn(ing)?\b/i.test(message)) {
        return 'WARN';
    }

    return 'INFO';
};

/** Map a decoded CloudWatch Logs payload to an OTLP/JSON logs request, scrubbing each line. */
export const cloudWatchToOtlp = (parsed: ParsedCloudWatchLogs): OtlpLogsPayload => {
    // All events in one subscription payload come from a single log group, so the stage is constant
    // across the batch — derive it once and tag both the resource and each record.
    const environment = stageFromLogGroup(parsed.logGroup);

    const logRecords: OtlpLogRecord[] = parsed.logEvents.map((event) => ({
        timeUnixNano: String(event.timestamp * 1_000_000),
        severityText: detectSeverity(event.message),
        body: { stringValue: sanitizeAccessLogMessage(event.message) },
        attributes: [
            attr('log_group', parsed.logGroup),
            attr('log_stream', parsed.logStream),
            attr('sentry.environment', environment),
        ],
    }));

    return {
        resourceLogs: [
            {
                resource: {
                    attributes: [attr('service.name', 'cloudwatch-drain'), attr('deployment.environment', environment)],
                },
                scopeLogs: [{ logRecords }],
            },
        ],
    };
};
