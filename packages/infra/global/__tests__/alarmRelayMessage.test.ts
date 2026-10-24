// @vitest-environment node
/**
 * Reading what an alarm topic delivers: CloudWatch's alarm notification, an EventBridge ECS task-state event, or
 * something else.
 *
 * ⛔ The samples are the shapes AWS documents, written out in full rather than minimal, so the schema is held to the
 * real payload (an unknown field must not break it, a field the schema needs must be present in the real one). The
 * parser is TOTAL: a message that is not valid JSON, or valid JSON of an unexpected shape, is `unrecognised` — it is
 * never dropped and never thrown, because an alarm topic that starts delivering something new is exactly the day
 * somebody most needs to hear about it.
 */
import { describe, expect, it } from 'vitest';

import { parseTopicMessage } from '../src/alarmRelay/message.js';

const TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:kitchensink-food-prod-FoodAlarmTopic4B1E7F6D-aBcD1234';
const TOPIC_NAME = 'kitchensink-food-prod-FoodAlarmTopic4B1E7F6D-aBcD1234';

/** A CloudWatch alarm state-change notification, as SNS carries it in `Message`. */
const cloudwatchAlarm = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
        AlarmName: 'kitchensink-food-failed-backlog-prod',
        AlarmDescription: 'Foods tombstoned FAILED',
        AWSAccountId: '123456789012',
        AlarmConfigurationUpdatedTimestamp: '2026-10-13T10:00:00.000+0000',
        NewStateValue: 'ALARM',
        NewStateReason:
            'Threshold Crossed: 1 datapoint [3.0 (13/10/26 12:00:00)] was greater than the threshold (0.0).',
        StateChangeTime: '2026-10-13T12:05:00.000+0000',
        Region: 'US East (N. Virginia)',
        AlarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:kitchensink-food-failed-backlog-prod',
        OldStateValue: 'OK',
        OKActions: [],
        AlarmActions: [TOPIC_ARN],
        InsufficientDataActions: [],
        Trigger: {
            MetricName: 'food-failed-backlog',
            Namespace: 'Commise/Food',
            StatisticType: 'Statistic',
            Statistic: 'MAXIMUM',
            Unit: null,
            Dimensions: [{ value: 'prod', name: 'Stage' }],
            Period: 300,
            EvaluationPeriods: 1,
            ComparisonOperator: 'GreaterThanThreshold',
            Threshold: 0,
            TreatMissingData: 'notBreaching',
            EvaluateLowSampleCountPercentile: '',
        },
        ...overrides,
    });

/** An EventBridge `ECS Task State Change` event, as the food task-start rule publishes it. */
const ecsEvent = (detail: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
        version: '0',
        id: '6a7e8feb-b491-4cf7-a9f1-bf3703467718',
        'detail-type': 'ECS Task State Change',
        source: 'aws.ecs',
        account: '123456789012',
        time: '2026-10-13T12:00:00Z',
        region: 'us-east-1',
        resources: ['arn:aws:ecs:us-east-1:123456789012:task/FoodCluster/0123456789abcdef'],
        detail: {
            clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/FoodCluster',
            taskArn: 'arn:aws:ecs:us-east-1:123456789012:task/FoodCluster/0123456789abcdef',
            group: 'family:FoodChangeRefreshTaskDef',
            lastStatus: 'STOPPED',
            desiredStatus: 'STOPPED',
            stopCode: 'TaskFailedToStart',
            stoppedReason: 'ResourceInitializationError: the specified log group does not exist',
            ...detail,
        },
        ...overrides,
    });

describe('parseTopicMessage', () => {
    describe('a CloudWatch alarm notification', () => {
        it('reads an ALARM transition completely', () => {
            expect(parseTopicMessage(cloudwatchAlarm(), TOPIC_ARN)).toEqual({
                kind: 'cloudwatch-alarm',
                topicName: TOPIC_NAME,
                alarmName: 'kitchensink-food-failed-backlog-prod',
                description: 'Foods tombstoned FAILED',
                newState: 'ALARM',
                oldState: 'OK',
                reason: 'Threshold Crossed: 1 datapoint [3.0 (13/10/26 12:00:00)] was greater than the threshold (0.0).',
                stateChangeTime: '2026-10-13T12:05:00.000+0000',
                namespace: 'Commise/Food',
                metricName: 'food-failed-backlog',
            });
        });

        it('reads the OK transition that clears it', () => {
            const parsed = parseTopicMessage(
                cloudwatchAlarm({ NewStateValue: 'OK', OldStateValue: 'ALARM', NewStateReason: 'Back under 0.' }),
                TOPIC_ARN,
            );

            expect(parsed).toMatchObject({ kind: 'cloudwatch-alarm', newState: 'OK', oldState: 'ALARM' });
        });

        it('reads INSUFFICIENT_DATA as a state rather than refusing it', () => {
            expect(parseTopicMessage(cloudwatchAlarm({ NewStateValue: 'INSUFFICIENT_DATA' }), TOPIC_ARN)).toMatchObject(
                {
                    kind: 'cloudwatch-alarm',
                    newState: 'INSUFFICIENT_DATA',
                },
            );
        });

        it('reads a metric-math alarm, whose trigger names no single namespace or metric', () => {
            const parsed = parseTopicMessage(
                cloudwatchAlarm({
                    Trigger: {
                        Metrics: [
                            { Id: 'e1', Expression: 'FILL(m1,0)+FILL(m2,0)', ReturnData: true },
                            { Id: 'm1', MetricStat: { Metric: { Namespace: 'X', MetricName: 'Y' }, Period: 300 } },
                        ],
                        EvaluationPeriods: 3,
                    },
                }),
                TOPIC_ARN,
            );

            expect(parsed).toMatchObject({
                kind: 'cloudwatch-alarm',
                alarmName: 'kitchensink-food-failed-backlog-prod',
            });
            expect(parsed).not.toHaveProperty('namespace');
            expect(parsed).not.toHaveProperty('metricName');
        });

        it('tolerates an absent description and an unknown extra field', () => {
            const parsed = parseTopicMessage(
                cloudwatchAlarm({ AlarmDescription: undefined, SomethingNew: { nested: true } }),
                TOPIC_ARN,
            );

            expect(parsed.kind).toBe('cloudwatch-alarm');
            expect(parsed).not.toHaveProperty('description');
        });

        it.each([
            ['an unknown state', { NewStateValue: 'EXPLODED' }],
            ['an empty alarm name', { AlarmName: '' }],
            ['a missing alarm name', { AlarmName: undefined }],
            ['a non-string reason', { NewStateReason: 7 }],
        ])('treats %s as unrecognised, so it is reported rather than dropped', (_name, override) => {
            expect(parseTopicMessage(cloudwatchAlarm(override), TOPIC_ARN)).toEqual({
                kind: 'unrecognised',
                topicName: TOPIC_NAME,
            });
        });
    });

    describe('an ECS task state change', () => {
        it('reads a STOPPED task that failed to start', () => {
            expect(parseTopicMessage(ecsEvent(), TOPIC_ARN)).toEqual({
                kind: 'ecs-task-state',
                topicName: TOPIC_NAME,
                group: 'family:FoodChangeRefreshTaskDef',
                lastStatus: 'STOPPED',
                stopCode: 'TaskFailedToStart',
                stoppedReason: 'ResourceInitializationError: the specified log group does not exist',
                time: '2026-10-13T12:00:00Z',
            });
        });

        it('keeps a service-scoped group as given', () => {
            expect(parseTopicMessage(ecsEvent({ group: 'service:FoodApi' }), TOPIC_ARN)).toMatchObject({
                group: 'service:FoodApi',
            });
        });

        it('tolerates a missing stop code and reason', () => {
            const parsed = parseTopicMessage(ecsEvent({ stopCode: undefined, stoppedReason: undefined }), TOPIC_ARN);

            expect(parsed).toMatchObject({ kind: 'ecs-task-state', group: 'family:FoodChangeRefreshTaskDef' });
            expect(parsed).not.toHaveProperty('stopCode');
            expect(parsed).not.toHaveProperty('stoppedReason');
        });

        it.each([
            ['another source', { source: 'aws.ec2' }],
            ['another detail type', { 'detail-type': 'ECS Container Instance State Change' }],
            ['no detail', { detail: undefined }],
        ])('treats an event from %s as unrecognised', (_name, override) => {
            expect(parseTopicMessage(ecsEvent({}, override), TOPIC_ARN)).toEqual({
                kind: 'unrecognised',
                topicName: TOPIC_NAME,
            });
        });

        it('treats an ECS event with no group as unrecognised: a fingerprint needs one', () => {
            expect(parseTopicMessage(ecsEvent({ group: undefined }), TOPIC_ARN).kind).toBe('unrecognised');
        });
    });

    describe('anything else', () => {
        it.each([
            ['bad JSON', '{not json'],
            ['an empty string', ''],
            ['a bare string', '"hello"'],
            ['null', 'null'],
            ['an array', '[1,2]'],
            ['an empty object', '{}'],
            ['a number', '42'],
        ])('is unrecognised for %s', (_name, raw) => {
            expect(parseTopicMessage(raw, TOPIC_ARN)).toEqual({ kind: 'unrecognised', topicName: TOPIC_NAME });
        });

        it('names the topic by the last segment of its ARN, and tolerates an ARN with no segments', () => {
            expect(parseTopicMessage('{}', 'arn:aws:sns:us-east-1:1:plain-topic')).toMatchObject({
                topicName: 'plain-topic',
            });
            expect(parseTopicMessage('{}', 'weird')).toMatchObject({ topicName: 'weird' });
            expect(parseTopicMessage('{}', '')).toMatchObject({ topicName: 'unknown' });
        });
    });
});
