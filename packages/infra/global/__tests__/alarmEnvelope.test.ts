// @vitest-environment node
/**
 * The Sentry envelope for one relayed alarm message (ADR-0062).
 *
 * ⛔ THE FINGERPRINT IS THE CONTRACT. Sentry groups by it, so it decides whether a recurring alarm is one issue with a
 * history or a new issue every time, and whether two different alarms are two issues or one. Changing one splits issue
 * history, which is why each is pinned here exactly, with a test that it ignores the wording and respects the stage.
 */
import { describe, expect, it } from 'vitest';

import { buildAlarmEnvelope, MAX_REPORT_CHARACTERS } from '../src/observability/alarmEnvelope.js';
import type { CloudwatchAlarmMessage, EcsTaskStateMessage, UnrecognisedMessage } from '../src/alarmRelay/message.js';

const NOW = new Date('2026-10-13T12:06:00.000Z');

const ALARM: CloudwatchAlarmMessage = {
    kind: 'cloudwatch-alarm',
    topicName: 'kitchensink-food-prod-FoodAlarmTopic',
    alarmName: 'kitchensink-food-failed-backlog-prod',
    description: 'Foods tombstoned FAILED',
    newState: 'ALARM',
    oldState: 'OK',
    reason: 'Threshold Crossed: 1 datapoint [3.0] was greater than the threshold (0.0).',
    stateChangeTime: '2026-10-13T12:05:00.000+0000',
    namespace: 'Commise/Food',
    metricName: 'food-failed-backlog',
};

const ECS: EcsTaskStateMessage = {
    kind: 'ecs-task-state',
    topicName: 'kitchensink-food-prod-FoodAlarmTopic',
    group: 'family:FoodChangeRefreshTaskDef',
    lastStatus: 'STOPPED',
    stopCode: 'TaskFailedToStart',
    stoppedReason: 'ResourceInitializationError: the specified log group does not exist',
    time: '2026-10-13T12:00:00Z',
};

const UNRECOGNISED: UnrecognisedMessage = { kind: 'unrecognised', topicName: 'kitchensink-food-prod-FoodAlarmTopic' };

interface SentryEvent {
    level?: string;
    environment?: string;
    fingerprint?: readonly string[];
    tags?: Record<string, string>;
    message?: { formatted?: string };
    platform?: string;
    timestamp?: string;
}

/** Split an envelope into its header, item header and event. */
function parts(envelope: string): { header: { sent_at?: string }; item: { type?: string }; event: SentryEvent } {
    const [header, item, event] = envelope.split('\n');

    return {
        header: JSON.parse(header as string) as { sent_at?: string },
        item: JSON.parse(item as string) as { type?: string },
        event: JSON.parse(event as string) as SentryEvent,
    };
}

describe('buildAlarmEnvelope', () => {
    it('is a well-formed three-line event envelope stamped by the injected clock', () => {
        const envelope = buildAlarmEnvelope(ALARM, 'prod', () => NOW);

        expect(envelope.endsWith('\n')).toBe(true);
        expect(envelope.split('\n')).toHaveLength(4);
        expect(parts(envelope).header.sent_at).toBe('2026-10-13T12:06:00.000Z');
        expect(parts(envelope).item.type).toBe('event');
    });

    describe('a CloudWatch alarm', () => {
        const { event } = parts(buildAlarmEnvelope(ALARM, 'prod', () => NOW));

        it('is an error-level issue in the stage’s Sentry environment', () => {
            // ⛔ `error`: Sentry's issue alert for this project is high-priority-only, and a `warning` would be
            // filed and never read. `environment` is what the alert rule filters on.
            expect(event.level).toBe('error');
            expect(event.environment).toBe('prod');
            expect(event.platform).toBe('node');
        });

        it('⛔ is fingerprinted by stage and alarm name alone', () => {
            expect(event.fingerprint).toEqual(['cloudwatch-alarm', 'prod', 'kitchensink-food-failed-backlog-prod']);
        });

        it('tags the alarm, the topic and the namespace', () => {
            expect(event.tags).toEqual({
                alarm: 'kitchensink-food-failed-backlog-prod',
                topic: 'kitchensink-food-prod-FoodAlarmTopic',
                namespace: 'Commise/Food',
            });
        });

        it('says which alarm and why, in the message', () => {
            expect(event.message?.formatted).toContain('kitchensink-food-failed-backlog-prod');
            expect(event.message?.formatted).toContain('Threshold Crossed');
            expect(event.message?.formatted).toContain('Foods tombstoned FAILED');
        });

        it('keeps the same fingerprint when only the wording of the reason changes', () => {
            const other = parts(
                buildAlarmEnvelope(
                    { ...ALARM, reason: 'a completely different 9.0', description: 'x' },
                    'prod',
                    () => NOW,
                ),
            ).event;

            expect(other.fingerprint).toEqual(event.fingerprint);
        });

        it('splits by stage: the same alarm name at another stage is another issue', () => {
            const other = parts(buildAlarmEnvelope(ALARM, 'sandbox', () => NOW)).event;

            expect(other.fingerprint).not.toEqual(event.fingerprint);
            expect(other.environment).toBe('sandbox');
        });

        it('splits by alarm: two alarms are two issues', () => {
            const other = parts(buildAlarmEnvelope({ ...ALARM, alarmName: 'another' }, 'prod', () => NOW)).event;

            expect(other.fingerprint).not.toEqual(event.fingerprint);
        });

        it('omits the namespace tag for a metric-math alarm rather than inventing one', () => {
            const { namespace: _namespace, metricName: _metricName, ...math } = ALARM;
            const tags = parts(buildAlarmEnvelope(math, 'prod', () => NOW)).event.tags;

            expect(tags).toEqual({ alarm: ALARM.alarmName, topic: ALARM.topicName });
        });
    });

    describe('an ECS task that failed to start', () => {
        const { event } = parts(buildAlarmEnvelope(ECS, 'prod', () => NOW));

        it('⛔ is fingerprinted by stage and task group', () => {
            expect(event.fingerprint).toEqual(['ecs-task-failed-to-start', 'prod', 'family:FoodChangeRefreshTaskDef']);
        });

        it('carries the stopped reason, which is the whole diagnosis', () => {
            expect(event.message?.formatted).toContain('ResourceInitializationError');
            expect(event.message?.formatted).toContain('TaskFailedToStart');
            expect(event.message?.formatted).toContain('family:FoodChangeRefreshTaskDef');
        });

        it('is an error in the stage environment, tagged with the topic and the group', () => {
            expect(event.level).toBe('error');
            expect(event.environment).toBe('prod');
            expect(event.tags).toEqual({ topic: ECS.topicName, group: 'family:FoodChangeRefreshTaskDef' });
        });

        it('copes with a missing stop code and reason', () => {
            const { stopCode: _code, stoppedReason: _reason, ...bare } = ECS;
            const bareEvent = parts(buildAlarmEnvelope(bare, 'prod', () => NOW)).event;

            expect(bareEvent.message?.formatted).toContain('family:FoodChangeRefreshTaskDef');
        });
    });

    describe('a message nobody planned for', () => {
        const { event } = parts(buildAlarmEnvelope(UNRECOGNISED, 'prod', () => NOW));

        it('⛔ is fingerprinted by stage and topic', () => {
            expect(event.fingerprint).toEqual([
                'alarm-topic-unrecognised',
                'prod',
                'kitchensink-food-prod-FoodAlarmTopic',
            ]);
        });

        it('names the topic and says it could not be read, and carries no body', () => {
            expect(event.level).toBe('error');
            expect(event.message?.formatted).toContain('kitchensink-food-prod-FoodAlarmTopic');
            expect(event.tags).toEqual({ topic: 'kitchensink-food-prod-FoodAlarmTopic' });
        });
    });

    it('bounds a runaway reason so one message cannot exceed what Sentry accepts', () => {
        const long = parts(buildAlarmEnvelope({ ...ALARM, reason: 'x'.repeat(100_000) }, 'prod', () => NOW)).event;

        expect(long.message?.formatted?.length).toBeLessThanOrEqual(MAX_REPORT_CHARACTERS);
    });
});
