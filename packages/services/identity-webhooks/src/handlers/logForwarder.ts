import { gunzipSync } from 'node:zlib';

import type { CloudWatchLogsEvent } from 'aws-lambda';

import { emitMetric, logger, withObservability } from '../common/observability.js';
import { cloudWatchToOtlp, parseLogDrainDsn, type OtlpLogsPayload, type ParsedCloudWatchLogs } from '../common/otlp.js';

const OTLP_TIMEOUT_MS = 5000;

const decode = (data: string): ParsedCloudWatchLogs => {
    const json = gunzipSync(Buffer.from(data, 'base64')).toString('utf8');

    return JSON.parse(json) as ParsedCloudWatchLogs;
};

/** @sideEffect performs a network POST to the Sentry OTLP-logs endpoint. */
const postOtlp = async (url: string, authHeader: string, payload: OtlpLogsPayload): Promise<void> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OTLP_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-sentry-auth': authHeader,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`OTLP ingest returned ${response.status}`);
        }
    } finally {
        clearTimeout(timeout);
    }
};

/**
 * Forward CloudWatch Logs subscription events to the Sentry log-drain project as OTLP log records.
 *
 * Fail-safe (R5): a drain failure never throws — it emits a `LogForwarderFailure` CloudWatch metric
 * (the tripwire for a silent drain outage, independent of Sentry being reachable) and a Sentry log,
 * then returns. Noise platform lines and EMF are excluded upstream by the subscription filter (U5).
 *
 * @sideEffect reads CloudWatch payloads and posts to Sentry.
 */
const innerHandler = async (event: CloudWatchLogsEvent): Promise<void> => {
    const dsn = process.env['LOG_DRAIN_DSN'];

    if (!dsn) {
        emitMetric('LogForwarderFailure', 1, { reason: 'missing_dsn' });

        return;
    }

    try {
        const parsed = decode(event.awslogs.data);

        if (!parsed.logEvents?.length) {
            return;
        }

        const { url, authHeader } = parseLogDrainDsn(dsn);
        await postOtlp(url, authHeader, cloudWatchToOtlp(parsed));
    } catch {
        // Never back-pressure the source service. Surface the failure as a metric + log only.
        emitMetric('LogForwarderFailure', 1, { reason: 'forward_error' });
        logger.error('log forwarder failed to deliver events to the drain');
    }
};

export const handler = withObservability(innerHandler);
