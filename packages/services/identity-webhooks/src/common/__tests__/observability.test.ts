import type { Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetAttributes, mockSentryLogger } = vi.hoisted(() => ({
    mockSetAttributes: vi.fn(),
    mockSentryLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@sentry/aws-serverless', () => ({
    init: vi.fn(),
    logger: mockSentryLogger,
    getIsolationScope: () => ({ setAttributes: mockSetAttributes }),
    wrapHandler: <T>(handler: T): T => handler,
}));

import { emitMetric, logger, withObservability } from '../observability.js';

const makeContext = (): Context =>
    ({
        awsRequestId: 'req-1',
        functionName: 'identity-webhook',
        functionVersion: '7',
    }) as unknown as Context;

describe('observability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('logger facade', () => {
        it('forwards purposeful logs to Sentry.logger with their attributes', () => {
            logger.info('user synced', { identityId: 'abc' });
            logger.warn('retrying', { attempt: 2 });
            logger.error('failed', { code: 'X' });

            expect(mockSentryLogger.info).toHaveBeenCalledWith('user synced', { identityId: 'abc' });
            expect(mockSentryLogger.warn).toHaveBeenCalledWith('retrying', { attempt: 2 });
            expect(mockSentryLogger.error).toHaveBeenCalledWith('failed', { code: 'X' });
        });
    });

    describe('emitMetric', () => {
        /** One emitted EMF line, parsed. */
        interface EmfLine {
            _aws: {
                CloudWatchMetrics: Array<{
                    Namespace: string;
                    Dimensions: string[][];
                    Metrics: Array<{ Name: string }>;
                }>;
            };
            [key: string]: unknown;
        }

        /** Emit one metric with `STAGE` pinned, and return the parsed line. */
        const emitted = (
            stage: string | undefined,
            facets?: Record<string, string>,
            name = 'ReconciliationDrift',
        ): EmfLine => {
            const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
            const before = process.env['STAGE'];

            if (stage === undefined) {
                delete process.env['STAGE'];
            } else {
                process.env['STAGE'] = stage;
            }

            try {
                emitMetric(name, 3, facets);

                expect(writeSpy).toHaveBeenCalledTimes(1);

                return JSON.parse(writeSpy.mock.calls[0]?.[0] as string) as EmfLine;
            } finally {
                writeSpy.mockRestore();

                if (before === undefined) {
                    delete process.env['STAGE'];
                } else {
                    process.env['STAGE'] = before;
                }
            }
        };

        it('writes an EMF payload to stdout and not to Sentry.logger', () => {
            const parsed = emitted('prod');

            expect(parsed._aws.CloudWatchMetrics[0]?.Metrics[0]?.Name).toBe('ReconciliationDrift');
            expect(mockSentryLogger.info).not.toHaveBeenCalled();
        });

        /**
         * ⛔ ADR-0062. The series used to carry no stage, so prod's alarms read the sandbox's datapoints as well.
         * The directive lists `Stage` and the line carries it, because CloudWatch discards a record whose directive
         * names a dimension the line does not have.
         */
        it('dimensions every metric by the deploy Stage', () => {
            const parsed = emitted('prod');

            expect(parsed._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['service', 'metric', 'Stage']]);
            expect(parsed['Stage']).toBe('prod');
        });

        it('reads the stage when it emits, so a preview Lambda publishes only its own series', () => {
            expect(emitted('pr-91')['Stage']).toBe('pr-91');
        });

        it('still emits, as `unknown`, when STAGE is absent: a metric with no stage is never dropped', () => {
            const parsed = emitted(undefined);

            expect(parsed['Stage']).toBe('unknown');
            expect(parsed._aws.CloudWatchMetrics[0]?.Dimensions[0]).toContain('Stage');
        });

        it('adds a facet dimension after Stage, and writes the facet as a top-level field', () => {
            const parsed = emitted('prod', { reason: 'forward_error' }, 'LogForwarderFailure');

            expect(parsed._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['service', 'metric', 'Stage', 'reason']]);
            expect(parsed['reason']).toBe('forward_error');
        });

        /**
         * CloudWatch extracts a metric only when its NAME is a top-level member of the line, and a dimension only
         * when its key is. Measured against the spec for every directive key, so a field that is declared and not
         * written fails here rather than as a series that never receives a datapoint.
         */
        it('writes the metric value and every declared dimension as top-level members of the line', () => {
            const parsed = emitted('prod', { reason: 'missing_dsn' }, 'LogForwarderFailure');
            const [directive] = parsed._aws.CloudWatchMetrics;

            expect(parsed['LogForwarderFailure']).toBe(3);

            for (const key of directive?.Dimensions[0] ?? []) {
                expect(Object.keys(parsed), key).toContain(key);
            }
        });

        it('lets no caller facet displace a reserved dimension or duplicate it in the directive', () => {
            const parsed = emitted('prod', { Stage: 'pr-1', service: 'other', metric: 'Other', reason: 'x' });

            expect(parsed['Stage']).toBe('prod');
            expect(parsed['service']).toBe('identity-webhooks');
            expect(parsed['metric']).toBe('ReconciliationDrift');
            expect(parsed._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([['service', 'metric', 'Stage', 'reason']]);
        });
    });

    describe('withObservability', () => {
        it('sets the Lambda context on the isolation scope and invokes the inner handler', async () => {
            const inner = vi.fn().mockResolvedValue('ok');
            const wrapped = withObservability(inner) as (event: unknown, context: Context) => Promise<unknown>;

            const result = await wrapped({}, makeContext());

            expect(mockSetAttributes).toHaveBeenCalledWith(
                expect.objectContaining({
                    aws_request_id: 'req-1',
                    function_name: 'identity-webhook',
                    function_version: '7',
                    serviceName: 'identity-webhooks',
                }),
            );
            expect(inner).toHaveBeenCalledOnce();
            expect(result).toBe('ok');
        });
    });
});
