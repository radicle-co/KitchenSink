// @vitest-environment node
/**
 * The predicates in `alarmPosture.ts`, proven against templates that VIOLATE each rule and templates that comply.
 *
 * ⛔ A predicate that is only ever shown compliant input proves nothing: "no violations" is equally the answer of a
 * reader that finds no alarms at all. Every predicate here is therefore run against a violating fixture and must
 * name exactly the violator, and against a compliant fixture and must name nothing.
 */
import { describe, expect, it } from 'vitest';

import {
    alarmTopics,
    alarmsWithoutOkActions,
    customAlarmsMissingStage,
    topicsWithoutRelay,
    type CfnTemplate,
} from './alarmPosture.js';

const RELAY_IMPORT = { 'Fn::ImportValue': 'kitchensink-alarm-relay-prod:AlarmRelayFunctionArn' };
const isRelay = (endpoint: unknown): boolean => JSON.stringify(endpoint) === JSON.stringify(RELAY_IMPORT);

/** A custom-namespace alarm with plain dimensions. */
const alarm = (properties: Record<string, unknown>): { Type: string; Properties: Record<string, unknown> } => ({
    Type: 'AWS::CloudWatch::Alarm',
    Properties: properties,
});

describe('customAlarmsMissingStage', () => {
    it('names a custom-namespace alarm whose dimensions omit Stage', () => {
        const template: CfnTemplate = {
            Resources: {
                NoDimensions: alarm({ Namespace: 'Commise/Food', MetricName: 'M' }),
                WrongStage: alarm({
                    Namespace: 'Commise/Food',
                    Dimensions: [{ Name: 'Stage', Value: 'pr-4' }],
                }),
                FacetOnly: alarm({
                    Namespace: 'Commise/Food',
                    Dimensions: [{ Name: 'source', Value: 'usda' }],
                }),
            },
        };

        expect(customAlarmsMissingStage(template, 'prod')).toEqual(['FacetOnly', 'NoDimensions', 'WrongStage']);
    });

    it('accepts a custom-namespace alarm that selects Stage=<stage>, in any dimension order', () => {
        const template: CfnTemplate = {
            Resources: {
                Ok: alarm({
                    Namespace: 'Commise/Food',
                    Dimensions: [
                        { Name: 'source', Value: 'usda' },
                        { Name: 'Stage', Value: 'prod' },
                    ],
                }),
            },
        };

        expect(customAlarmsMissingStage(template, 'prod')).toEqual([]);
    });

    it('exempts an AWS-namespace alarm: the platform owns those dimensions', () => {
        const template: CfnTemplate = {
            Resources: {
                Sqs: alarm({
                    Namespace: 'AWS/SQS',
                    Dimensions: [{ Name: 'QueueName', Value: 'q' }],
                }),
            },
        };

        expect(customAlarmsMissingStage(template, 'prod')).toEqual([]);
    });

    it('reads a MULTI-QUERY alarm: a custom MetricStat without Stage is a violation, with Stage is not', () => {
        const stat = (namespace: string, dimensions: unknown[]): unknown => ({
            Id: 'q',
            MetricStat: { Metric: { Namespace: namespace, MetricName: 'M', Dimensions: dimensions }, Period: 60 },
        });
        const template: CfnTemplate = {
            Resources: {
                Bad: alarm({ Metrics: [stat('KitchenSink/IdentityWebhooks', [{ Name: 'service', Value: 'w' }])] }),
                Good: alarm({
                    Metrics: [stat('KitchenSink/IdentityWebhooks', [{ Name: 'Stage', Value: 'prod' }])],
                }),
                AwsOnly: alarm({ Metrics: [stat('AWS/Lambda', [])] }),
            },
        };

        expect(customAlarmsMissingStage(template, 'prod')).toEqual(['Bad']);
    });

    it('reads a SEARCH() expression: the stage must be a quoted filter, not merely a dimension key', () => {
        const search = (text: string): unknown => ({ Id: 's', Expression: text, ReturnData: true });
        const template: CfnTemplate = {
            Resources: {
                KeyOnly: alarm({
                    Metrics: [search("SEARCH('{Commise/Food,Stage,source} MetricName=\"X\"', 'Sum', 60)")],
                }),
                Filtered: alarm({
                    Metrics: [
                        search('SEARCH(\'{Commise/Food,Stage,source} Stage="prod" MetricName="X"\', \'Sum\', 60)'),
                    ],
                }),
                OtherStage: alarm({
                    Metrics: [search('SEARCH(\'{Commise/Food,Stage} Stage="pr-9" MetricName="X"\', \'Sum\', 60)')],
                }),
                Dimensionless: alarm({ Metrics: [search("SEARCH('{Commise/Food} MetricName=\"X\"', 'Sum', 60)")] }),
            },
        };

        expect(customAlarmsMissingStage(template, 'prod')).toEqual(['Dimensionless', 'KeyOnly', 'OtherStage']);
    });

    it('does not judge a pure math expression that references other queries, and a metric-math alarm is judged by its inputs', () => {
        const template: CfnTemplate = {
            Resources: {
                Math: alarm({
                    Metrics: [
                        {
                            Id: 'a',
                            ReturnData: false,
                            MetricStat: {
                                Metric: {
                                    Namespace: 'KitchenSink/IdentityWebhooks',
                                    MetricName: 'LogForwarderFailure',
                                    Dimensions: [{ Name: 'Stage', Value: 'prod' }],
                                },
                                Period: 60,
                            },
                        },
                        { Id: 'e', Expression: 'FILL(a,0)+FILL(a,0)', ReturnData: true },
                    ],
                }),
            },
        };

        expect(customAlarmsMissingStage(template, 'prod')).toEqual([]);
    });

    it('ignores resources that are not alarms, and an empty template', () => {
        expect(customAlarmsMissingStage({}, 'prod')).toEqual([]);
        expect(
            customAlarmsMissingStage({ Resources: { T: { Type: 'AWS::SNS::Topic', Properties: {} } } }, 'prod'),
        ).toEqual([]);
    });
});

describe('alarmTopics', () => {
    it('finds a topic an alarm acts on, a topic an EventBridge rule targets, and nothing else', () => {
        const template: CfnTemplate = {
            Resources: {
                AlarmTopic: { Type: 'AWS::SNS::Topic', Properties: {} },
                RuleTopic: { Type: 'AWS::SNS::Topic', Properties: {} },
                UnrelatedTopic: { Type: 'AWS::SNS::Topic', Properties: {} },
                A: alarm({ AlarmActions: [{ Ref: 'AlarmTopic' }] }),
                R: {
                    Type: 'AWS::Events::Rule',
                    Properties: { Targets: [{ Arn: { Ref: 'RuleTopic' }, Id: 't' }] },
                },
            },
        };

        expect(alarmTopics(template)).toEqual(['AlarmTopic', 'RuleTopic']);
    });

    it('counts a topic named only by OKActions or InsufficientDataActions, and ignores a Ref to a non-topic', () => {
        const template: CfnTemplate = {
            Resources: {
                T1: { Type: 'AWS::SNS::Topic', Properties: {} },
                T2: { Type: 'AWS::SNS::Topic', Properties: {} },
                Q: { Type: 'AWS::SQS::Queue', Properties: {} },
                A: alarm({ OKActions: [{ Ref: 'T1' }], InsufficientDataActions: [{ Ref: 'T2' }, { Ref: 'Q' }] }),
            },
        };

        expect(alarmTopics(template)).toEqual(['T1', 'T2']);
    });
});

describe('topicsWithoutRelay', () => {
    const base = (extra: Record<string, unknown>): CfnTemplate => ({
        Resources: {
            Topic: { Type: 'AWS::SNS::Topic', Properties: {} },
            A: alarm({ AlarmActions: [{ Ref: 'Topic' }] }),
            ...(extra as CfnTemplate['Resources']),
        },
    });
    const subscription = {
        Type: 'AWS::SNS::Subscription',
        Properties: { Protocol: 'lambda', TopicArn: { Ref: 'Topic' }, Endpoint: RELAY_IMPORT },
    };
    const permission = {
        Type: 'AWS::Lambda::Permission',
        Properties: {
            Action: 'lambda:InvokeFunction',
            FunctionName: RELAY_IMPORT,
            Principal: 'sns.amazonaws.com',
            SourceArn: { Ref: 'Topic' },
        },
    };

    it('passes a topic with the relay subscription AND a topic-scoped sns permission', () => {
        expect(topicsWithoutRelay(base({ Sub: subscription, Perm: permission }), isRelay)).toEqual([]);
    });

    it('names a topic with no subscription at all', () => {
        expect(topicsWithoutRelay(base({ Perm: permission }), isRelay)).toEqual(['Topic']);
    });

    it('names a topic whose subscription is a different endpoint (an email is not the relay)', () => {
        const email = {
            Type: 'AWS::SNS::Subscription',
            Properties: { Protocol: 'email', TopicArn: { Ref: 'Topic' }, Endpoint: 'a@b.c' },
        };

        expect(topicsWithoutRelay(base({ Sub: email, Perm: permission }), isRelay)).toEqual(['Topic']);
    });

    it('names a topic subscribed to the relay with no permission, or with one scoped to another topic', () => {
        const elsewhere = {
            ...permission,
            Properties: { ...permission.Properties, SourceArn: { Ref: 'Other' } },
        };
        const wrongPrincipal = {
            ...permission,
            Properties: { ...permission.Properties, Principal: 'logs.amazonaws.com' },
        };

        expect(topicsWithoutRelay(base({ Sub: subscription }), isRelay)).toEqual(['Topic']);
        expect(topicsWithoutRelay(base({ Sub: subscription, Perm: elsewhere }), isRelay)).toEqual(['Topic']);
        expect(topicsWithoutRelay(base({ Sub: subscription, Perm: wrongPrincipal }), isRelay)).toEqual(['Topic']);
    });

    it('judges a topic that only an EventBridge rule targets', () => {
        const template: CfnTemplate = {
            Resources: {
                RuleTopic: { Type: 'AWS::SNS::Topic', Properties: {} },
                R: { Type: 'AWS::Events::Rule', Properties: { Targets: [{ Arn: { Ref: 'RuleTopic' }, Id: 't' }] } },
            },
        };

        expect(topicsWithoutRelay(template, isRelay)).toEqual(['RuleTopic']);
    });
});

describe('alarmsWithoutOkActions', () => {
    it('names an alarm with actions but no OKActions, and one whose OKActions differ from its AlarmActions', () => {
        const template: CfnTemplate = {
            Resources: {
                NoOk: alarm({ AlarmActions: [{ Ref: 'T' }] }),
                Different: alarm({ AlarmActions: [{ Ref: 'T' }], OKActions: [{ Ref: 'U' }] }),
                Subset: alarm({ AlarmActions: [{ Ref: 'T' }, { Ref: 'U' }], OKActions: [{ Ref: 'T' }] }),
            },
        };

        expect(alarmsWithoutOkActions(template)).toEqual(['Different', 'NoOk', 'Subset']);
    });

    it('accepts equal action lists regardless of order, and an alarm with no actions at all', () => {
        const template: CfnTemplate = {
            Resources: {
                Equal: alarm({ AlarmActions: [{ Ref: 'T' }, { Ref: 'U' }], OKActions: [{ Ref: 'U' }, { Ref: 'T' }] }),
                Bare: alarm({}),
            },
        };

        expect(alarmsWithoutOkActions(template)).toEqual([]);
    });
});
