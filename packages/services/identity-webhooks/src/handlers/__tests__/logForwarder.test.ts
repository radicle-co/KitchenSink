import { gzipSync } from 'node:zlib';

import type { CloudWatchLogsEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmitMetric, mockLogger } = vi.hoisted(() => ({
    mockEmitMetric: vi.fn(),
    mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../common/observability.js', () => ({
    emitMetric: mockEmitMetric,
    logger: mockLogger,
    withObservability: <T>(fn: T): T => fn,
}));

import { handler as rawHandler } from '../logForwarder.js';

const handler = rawHandler as unknown as (event: CloudWatchLogsEvent) => Promise<void>;

const decodedFixture = {
    owner: '1',
    logGroup: '/aws/lambda/x',
    logStream: 'stream-1',
    subscriptionFilters: ['forward-app-logs'],
    messageType: 'DATA_MESSAGE',
    logEvents: [{ id: '1', timestamp: 1000, message: 'hello' }],
};

const makeEvent = (decoded: object): CloudWatchLogsEvent =>
    ({ awslogs: { data: gzipSync(Buffer.from(JSON.stringify(decoded))).toString('base64') } }) as CloudWatchLogsEvent;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.clearAllMocks();
    process.env['LOG_DRAIN_DSN'] = 'https://abc@o1.ingest.us.sentry.io/42';
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('log-forwarder', () => {
    it('decodes the payload and POSTs OTLP to the drain endpoint', async () => {
        await handler(makeEvent(decodedFixture));

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/integration/otlp/v1/logs');
        expect((init.headers as Record<string, string>)['x-sentry-auth']).toBe('sentry sentry_key=abc');
        expect(mockEmitMetric).not.toHaveBeenCalled();
    });

    it('emits a failure metric and does not throw on a non-200 response', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

        await expect(handler(makeEvent(decodedFixture))).resolves.toBeUndefined();
        expect(mockEmitMetric).toHaveBeenCalledWith('LogForwarderFailure', 1, { reason: 'forward_error' });
    });

    it('emits a failure metric on a malformed payload without throwing', async () => {
        const bad = { awslogs: { data: 'not-base64-gzip' } } as unknown as CloudWatchLogsEvent;

        await expect(handler(bad)).resolves.toBeUndefined();
        expect(mockEmitMetric).toHaveBeenCalledWith('LogForwarderFailure', 1, { reason: 'forward_error' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips and flags when LOG_DRAIN_DSN is missing', async () => {
        delete process.env['LOG_DRAIN_DSN'];

        await handler(makeEvent(decodedFixture));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(mockEmitMetric).toHaveBeenCalledWith('LogForwarderFailure', 1, { reason: 'missing_dsn' });
    });
});
