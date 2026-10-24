// @vitest-environment node
/**
 * The alarm relay handler: what it reports, what it only logs, and when it FAILS.
 *
 * ⛔ THE RELAY'S ONE JOB IS NOT TO DROP AN ALARM. Every path where Sentry did not take the report must END IN A THROW,
 * because a throw is what makes Lambda retry and then park the event in the failure queue whose depth is alarmed. The
 * silent-no-op reporter swallows a failed report by design (a failed report must not fail a deploy); here that same
 * behaviour would be the defect. Each failure shape below is therefore asserted to throw: a 5xx, a timeout, no DSN.
 *
 * `postEnvelope` is injected, so these cases drive the policy; the transport behaviour (a real 5xx, a real stalled
 * socket) is exercised against a local HTTP server in `tests/alarmRelay.integration.test.ts`.
 */
import type { SNSEvent, SNSEventRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

import { relayAlarmMessages, type RelayDependencies } from '../src/alarmRelay/handler.js';

const DSN = 'https://abc123@o1.ingest.sentry.io/456';
const TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:kitchensink-food-prod-FoodAlarmTopic';
const NOW = new Date('2026-10-13T12:06:00.000Z');

const alarmMessage = (state: 'ALARM' | 'OK'): string =>
    JSON.stringify({
        AlarmName: 'kitchensink-food-failed-backlog-prod',
        NewStateValue: state,
        OldStateValue: state === 'ALARM' ? 'OK' : 'ALARM',
        NewStateReason: 'Threshold Crossed',
        StateChangeTime: '2026-10-13T12:05:00.000+0000',
        Trigger: { Namespace: 'Commise/Food', MetricName: 'food-failed-backlog' },
    });

const ecsMessage = JSON.stringify({
    source: 'aws.ecs',
    'detail-type': 'ECS Task State Change',
    time: '2026-10-13T12:00:00Z',
    detail: { group: 'family:FoodChangeRefreshTaskDef', lastStatus: 'STOPPED', stopCode: 'TaskFailedToStart' },
});

/** An SNS event of the given messages, all on one topic. */
const eventOf = (...messages: string[]): SNSEvent =>
    ({
        Records: messages.map(
            (Message): SNSEventRecord =>
                ({
                    EventSource: 'aws:sns',
                    EventVersion: '1.0',
                    EventSubscriptionArn: `${TOPIC_ARN}:sub`,
                    Sns: { Message, TopicArn: TOPIC_ARN, Type: 'Notification' },
                }) as SNSEventRecord,
        ),
    }) as SNSEvent;

/** Dependencies with a recording `postEnvelope` that answers `answer`. */
function deps(answer: boolean | ((body: string) => boolean) = true, dsn = DSN) {
    const posted: { url: string; body: string; deadlineMs: number }[] = [];
    const lines: string[] = [];
    const dependencies: RelayDependencies = {
        dsn,
        stage: 'prod',
        now: () => NOW,
        log: (line) => lines.push(line),
        postEnvelope: vi.fn((target, body, deadlineMs) => {
            posted.push({ url: target.url, body, deadlineMs });

            return Promise.resolve(typeof answer === 'function' ? answer(body) : answer);
        }),
    };

    return { dependencies, posted, lines };
}

/** The event inside a posted envelope. */
const eventIn = (body: string): { fingerprint: string[]; environment: string } =>
    JSON.parse(body.split('\n')[2] as string) as { fingerprint: string[]; environment: string };

describe('reporting', () => {
    it('reports an ALARM as a Sentry issue, to the DSN’s ingest endpoint, within a bounded time', async () => {
        const { dependencies, posted } = deps();

        await expect(relayAlarmMessages(eventOf(alarmMessage('ALARM')), dependencies)).resolves.toBeUndefined();

        expect(posted).toHaveLength(1);
        expect(posted[0]?.url).toBe('https://o1.ingest.sentry.io/api/456/envelope/');
        expect(posted[0]?.deadlineMs).toBeGreaterThan(0);
        expect(posted[0]?.deadlineMs).toBeLessThanOrEqual(10_000);
        expect(eventIn(posted[0]?.body as string)).toMatchObject({
            environment: 'prod',
            fingerprint: ['cloudwatch-alarm', 'prod', 'kitchensink-food-failed-backlog-prod'],
        });
    });

    it('reports an ECS task event as a Sentry issue', async () => {
        const { dependencies, posted } = deps();

        await relayAlarmMessages(eventOf(ecsMessage), dependencies);

        expect(posted.map((entry) => eventIn(entry.body).fingerprint)).toEqual([
            ['ecs-task-failed-to-start', 'prod', 'family:FoodChangeRefreshTaskDef'],
        ]);
    });

    it('reports a message it cannot read, rather than dropping it', async () => {
        const { dependencies, posted } = deps();

        await relayAlarmMessages(eventOf('not json at all'), dependencies);

        expect(posted.map((entry) => eventIn(entry.body).fingerprint)).toEqual([
            ['alarm-topic-unrecognised', 'prod', 'kitchensink-food-prod-FoodAlarmTopic'],
        ]);
    });

    it('⛔ posts NOTHING for an OK, but still says so on the drain: an OK is not an issue to open', async () => {
        const { dependencies, posted, lines } = deps();

        await relayAlarmMessages(eventOf(alarmMessage('OK')), dependencies);

        expect(posted).toEqual([]);
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0] as string)).toMatchObject({
            alarmName: 'kitchensink-food-failed-backlog-prod',
            newState: 'OK',
            oldState: 'ALARM',
            reported: false,
        });
    });

    it('logs exactly one structured line per record, before and regardless of the report', async () => {
        const { dependencies, lines } = deps();

        await relayAlarmMessages(eventOf(alarmMessage('ALARM'), alarmMessage('OK'), ecsMessage), dependencies);

        const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);

        expect(parsed).toHaveLength(3);
        expect(parsed.map((line) => line['kind'])).toEqual(['cloudwatch-alarm', 'cloudwatch-alarm', 'ecs-task-state']);
        expect(parsed.map((line) => line['reported'])).toEqual([true, false, true]);
        expect(parsed.every((line) => line['stage'] === 'prod' && typeof line['message'] === 'string')).toBe(true);
    });

    it('does nothing for an event with no records', async () => {
        const { dependencies, posted, lines } = deps();

        await relayAlarmMessages({ Records: [] }, dependencies);

        expect(posted).toEqual([]);
        expect(lines).toEqual([]);
    });
});

describe('⛔ failing: an alarm that did not reach Sentry must make the invocation fail', () => {
    it.each([
        ['a 5xx or a refusal', () => false],
        ['a timeout', () => false],
    ])('throws when postEnvelope answers false for %s', async (_name, answer) => {
        const { dependencies } = deps(answer);

        await expect(relayAlarmMessages(eventOf(alarmMessage('ALARM')), dependencies)).rejects.toThrow(
            /could not be delivered to Sentry/u,
        );
    });

    it('throws when postEnvelope itself rejects', async () => {
        const { dependencies } = deps();

        const failing: RelayDependencies = {
            ...dependencies,
            postEnvelope: vi.fn(() => Promise.reject(new Error('socket hang up'))),
        };

        await expect(relayAlarmMessages(eventOf(alarmMessage('ALARM')), failing)).rejects.toThrow(
            /could not be delivered to Sentry/u,
        );
    });

    it.each([
        ['an empty DSN', ''],
        ['a malformed DSN', 'not-a-dsn'],
    ])(
        'throws without posting when it has %s: a relay with nowhere to send must not look healthy',
        async (_name, dsn) => {
            const { dependencies, posted } = deps(true, dsn);

            await expect(relayAlarmMessages(eventOf(alarmMessage('ALARM')), dependencies)).rejects.toThrow(
                /SENTRY_DSN/u,
            );
            expect(posted).toEqual([]);
        },
    );

    it('still tries every record when one fails, then throws once, naming how many were lost', async () => {
        let call = 0;
        const { dependencies, posted } = deps(() => {
            call += 1;

            return call !== 2;
        });

        await expect(
            relayAlarmMessages(eventOf(alarmMessage('ALARM'), ecsMessage, 'junk'), dependencies),
        ).rejects.toThrow(/1 of 3/u);
        expect(posted).toHaveLength(3);
    });

    it('does not throw for an OK-only event even with no DSN: nothing needed sending', async () => {
        const { dependencies } = deps(true, '');

        await expect(relayAlarmMessages(eventOf(alarmMessage('OK')), dependencies)).resolves.toBeUndefined();
    });
});
