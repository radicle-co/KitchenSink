import { describe, expect, it } from 'vitest';

import { cloudWatchToOtlp, parseLogDrainDsn, sanitizeAccessLogMessage, stageFromLogGroup } from '../otlp.js';

describe('otlp', () => {
    describe('parseLogDrainDsn', () => {
        it('derives the OTLP endpoint and auth header from a DSN', () => {
            const target = parseLogDrainDsn('https://abc123@o863367.ingest.us.sentry.io/4511549304930304');

            expect(target.url).toBe(
                'https://o863367.ingest.us.sentry.io/api/4511549304930304/integration/otlp/v1/logs',
            );
            expect(target.authHeader).toBe('sentry sentry_key=abc123');
        });

        it('throws on a DSN with no project id', () => {
            expect(() => parseLogDrainDsn('https://abc123@o1.ingest.us.sentry.io/')).toThrow();
        });
    });

    describe('cloudWatchToOtlp', () => {
        it('maps each event to a record with source attributes, ns timestamps, and severity', () => {
            const payload = cloudWatchToOtlp({
                logGroup: '/aws/lambda/x',
                logStream: 'stream-1',
                logEvents: [
                    { timestamp: 1000, message: 'hello' },
                    { timestamp: 2000, message: 'ERROR boom' },
                ],
            });

            const records = payload.resourceLogs[0]?.scopeLogs[0]?.logRecords ?? [];
            expect(records).toHaveLength(2);
            expect(records[0]?.timeUnixNano).toBe('1000000000');
            expect(records[0]?.attributes.find((a) => a.key === 'log_group')?.value.stringValue).toBe('/aws/lambda/x');
            expect(records[0]?.attributes.find((a) => a.key === 'log_stream')?.value.stringValue).toBe('stream-1');
            expect(records[1]?.severityText).toBe('ERROR');
        });

        it('tags the resource and each record with the stage derived from the log group', () => {
            const payload = cloudWatchToOtlp({
                logGroup: 'kitchensink-identity-webhooks-prod-WebhooksLogGroupA05F4FC6-mlSeUWgcNEJf',
                logStream: 'stream-1',
                logEvents: [{ timestamp: 1000, message: 'hello' }],
            });

            const resourceAttrs = payload.resourceLogs[0]?.resource.attributes ?? [];
            const record = payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];

            expect(resourceAttrs.find((a) => a.key === 'deployment.environment')?.value.stringValue).toBe('prod');
            expect(record?.attributes.find((a) => a.key === 'sentry.environment')?.value.stringValue).toBe('prod');
        });
    });

    describe('stageFromLogGroup', () => {
        it('extracts the stage from identity log group names', () => {
            expect(stageFromLogGroup('kitchensink-identity-service-prod-IdentityServiceLogGroup4DD93B61-0yC')).toBe(
                'prod',
            );
            expect(stageFromLogGroup('kitchensink-identity-webhooks-dev-WebhooksLogGroupA05F4FC6-Rwj')).toBe('dev');
            expect(stageFromLogGroup('kitchensink-identity-webhooks-pr-15-WebhooksLogGroupA05F4FC6-x')).toBe('pr-15');
        });

        it('falls back to unknown for unrecognized groups', () => {
            expect(stageFromLogGroup('/aws/lambda/some-other-function')).toBe('unknown');
        });
    });

    describe('sanitizeAccessLogMessage', () => {
        it('redacts sensitive keys and id path segments in a JSON access log', () => {
            const message = JSON.stringify({
                ip: '1.2.3.4',
                caller: 'someone',
                resourcePath: '/users/550e8400-e29b-41d4-a716-446655440000/avatar',
                status: '200',
            });

            const out = JSON.parse(sanitizeAccessLogMessage(message)) as Record<string, string>;

            expect(out['ip']).toBe('[redacted]');
            expect(out['caller']).toBe('[redacted]');
            expect(out['resourcePath']).toBe('/users/:id/avatar');
            expect(out['status']).toBe('200');
        });

        it('passes non-JSON messages through unchanged', () => {
            expect(sanitizeAccessLogMessage('plain log line')).toBe('plain log line');
        });
    });
});
