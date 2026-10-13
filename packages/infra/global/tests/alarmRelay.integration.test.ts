// @vitest-environment node
/**
 * The alarm relay's real `handler` against a local HTTP stand-in for Sentry's ingest endpoint (ADR-0062).
 *
 * The unit suite drives the failure POLICY with an injected `postEnvelope`; this one drives the real transport: the
 * production entry point reads `SENTRY_DSN` and `STAGE` from the environment, posts with `fetch`, and must fail the
 * invocation for every way Sentry can refuse to take an alarm. No real Sentry is contacted: the DSN points at a
 * loopback server, so this proves the wire shape and the failure behaviour and nothing about Sentry itself.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { SNSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handler, RELAY_POST_DEADLINE_MS } from '../src/alarmRelay/handler.js';

const TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:kitchensink-food-prod-FoodAlarmTopic';

const alarm = (state: 'ALARM' | 'OK'): string =>
    JSON.stringify({
        AlarmName: 'kitchensink-food-failed-backlog-prod',
        NewStateValue: state,
        OldStateValue: state === 'ALARM' ? 'OK' : 'ALARM',
        NewStateReason: 'Threshold Crossed',
        StateChangeTime: '2026-10-13T12:05:00.000+0000',
    });

const eventOf = (...messages: string[]): SNSEvent =>
    ({
        Records: messages.map((Message) => ({ Sns: { Message, TopicArn: TOPIC_ARN } })),
    }) as unknown as SNSEvent;

interface Captured {
    readonly url: string | undefined;
    readonly headers: IncomingMessage['headers'];
    readonly body: string;
}

let server: Server | undefined;
let captured: Captured[] = [];
let answer: number | 'stall' = 200;

beforeEach(async () => {
    captured = [];
    answer = 200;
    server = createServer((request, response) => {
        const chunks: Buffer[] = [];

        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            captured.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });

            if (answer !== 'stall') {
                response.statusCode = answer;
                response.end('{}');
            }
        });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));

    const address = server?.address() as AddressInfo | undefined;

    if (address === undefined) {
        throw new Error('the stand-in Sentry server did not start');
    }

    const { port } = address;

    vi.stubEnv('SENTRY_DSN', `http://relaykey@127.0.0.1:${String(port)}/9`);
    vi.stubEnv('STAGE', 'prod');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();

    const closing = server;

    server = undefined;
    closing?.closeAllConnections();
    await new Promise<void>((resolve) => (closing === undefined ? resolve() : closing.close(() => resolve())));
});

describe('the alarm relay handler over a real HTTP transport', () => {
    it('delivers an ALARM as one fingerprinted envelope, authenticated by the DSN key', async () => {
        await expect(handler(eventOf(alarm('ALARM')))).resolves.toBeUndefined();

        expect(captured).toHaveLength(1);
        expect(captured[0]?.url).toBe('/api/9/envelope/');
        expect(captured[0]?.headers['x-sentry-auth']).toBe('Sentry sentry_version=7, sentry_key=relaykey');

        const [header, item, event] = (captured[0]?.body ?? '')
            .split('\n')
            .slice(0, 3)
            .map((line) => JSON.parse(line) as unknown);

        expect(header).toMatchObject({ sent_at: expect.any(String) });
        expect(item).toEqual({ type: 'event' });
        expect(event).toMatchObject({
            level: 'error',
            environment: 'prod',
            fingerprint: ['cloudwatch-alarm', 'prod', 'kitchensink-food-failed-backlog-prod'],
        });
    });

    it('sends nothing for an OK, and writes the structured line the drain forwards', async () => {
        await handler(eventOf(alarm('OK')));

        expect(captured).toEqual([]);
        expect(console.log).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toMatchObject({
            newState: 'OK',
            reported: false,
        });
    });

    it.each([400, 401, 429, 500, 503])('⛔ fails the invocation when Sentry answers %i', async (status) => {
        answer = status;

        await expect(handler(eventOf(alarm('ALARM')))).rejects.toThrow(/could not be delivered to Sentry/u);
    });

    it('⛔ fails the invocation when nothing is listening', async () => {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = undefined;

        await expect(handler(eventOf(alarm('ALARM')))).rejects.toThrow(/could not be delivered to Sentry/u);
    });

    it('⛔ fails the invocation when Sentry stalls past the deadline, rather than hanging until the function times out', async () => {
        answer = 'stall';

        const started = Date.now();

        await expect(handler(eventOf(alarm('ALARM')))).rejects.toThrow(/could not be delivered to Sentry/u);
        expect(Date.now() - started).toBeLessThan(RELAY_POST_DEADLINE_MS + 3_000);
    });

    it('⛔ fails the invocation when the function has no DSN', async () => {
        vi.stubEnv('SENTRY_DSN', '');

        await expect(handler(eventOf(alarm('ALARM')))).rejects.toThrow(/SENTRY_DSN/u);
        expect(captured).toEqual([]);
    });
});
