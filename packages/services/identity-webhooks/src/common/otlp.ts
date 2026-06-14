/**
 * Pure transforms for the CloudWatch -> Sentry log drain (U4).
 *
 * Shapes CloudWatch Logs subscription payloads into OTLP/JSON log records and derives the Sentry
 * OTLP ingest target from the log-drain DSN. Kept separate from the handler so the transport is
 * swappable for an OTel Collector later (KTD1) and so the mapping + scrubbing are unit-testable.
 */

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

    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (SENSITIVE_LOG_KEYS.has(key.toLowerCase())) {
            out[key] = '[redacted]';
        } else if (typeof value === 'string' && /path|resource|uri/i.test(key)) {
            out[key] = redactIdSegments(value);
        } else {
            out[key] = value;
        }
    }

    return JSON.stringify(out);
};

/**
 * Derive the deployment stage from a CloudWatch log group name. Identity log groups are named
 * `kitchensink-identity-<component>-<stage>-<...>` (e.g.
 * `kitchensink-identity-webhooks-prod-WebhooksLogGroup...`), so the stage is recoverable from the
 * source group without each service stamping it — which matters because the drain carries AWS infra
 * logs, not the app's own JSON logs. One forwarder serves every stage; this keeps the single
 * log-drain project queryable by `environment`. Falls back to `unknown` for unrecognized groups.
 */
export const stageFromLogGroup = (logGroup: string): string => {
    const match =
        /kitchensink-identity-(?:service|webhooks|data|network|domain|global)-(prod|staging|dev|test|sandbox-[a-z0-9]+|mr-[a-z0-9]+|pr-[a-z0-9]+)\b/i.exec(
            logGroup,
        );

    return match ? match[1].toLowerCase() : 'unknown';
};

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
