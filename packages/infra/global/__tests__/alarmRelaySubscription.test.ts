// @vitest-environment node
/**
 * The mirrored `alarmRelaySubscription.ts` module (this is the copy in `lib/platform/`; `mirroredModuleParity.test.ts`
 * holds every other copy identical to it, and each service's own suite proves its synthesized stack).
 *
 * What it must do to a stack that owns an alarm topic (ADR-0062):
 *
 *  - subscribe the relay to the topic, with ONE invoke permission scoped to THAT topic (a permission without a
 *    `SourceArn` lets any topic in the account invoke the relay);
 *  - make every alarm's OK transition go where its ALARM transition goes, because an OK that is not forwarded leaves
 *    the relay unable to say an incident ended;
 *  - leave an alarm with no action alone (it has no ALARM route to mirror).
 */
import {
    Aspects,
    Duration,
    Stack,
    aws_cloudwatch as cloudwatch,
    aws_sns as sns,
    aws_cloudwatch_actions as actions,
} from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import {
    AlarmTransitionsRelayed,
    importAlarmRelayArn,
    relayAlarmTransitions,
} from '../lib/platform/alarmRelaySubscription.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };
const RELAY_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:kitchensink-alarm-relay-prod-fn';

/** A stack with two topics and three alarms: one on each topic, one with no action. */
function synth(): Template {
    const stack = new Stack(testApp(), 'Host', { env });
    const first = new sns.Topic(stack, 'FirstTopic');
    const second = new sns.Topic(stack, 'SecondTopic');
    const metric = new cloudwatch.Metric({ namespace: 'Test/Ns', metricName: 'M', period: Duration.minutes(5) });
    const make = (id: string): cloudwatch.Alarm =>
        new cloudwatch.Alarm(stack, id, {
            metric,
            threshold: 1,
            evaluationPeriods: 1,
        });

    make('OnFirst').addAlarmAction(new actions.SnsAction(first));
    make('OnSecond').addAlarmAction(new actions.SnsAction(second));
    make('Silent');

    relayAlarmTransitions(stack, first, RELAY_ARN);
    relayAlarmTransitions(stack, second, RELAY_ARN);

    return Template.fromStack(stack);
}

describe('relayAlarmTransitions', () => {
    const template = synth();

    it('subscribes the relay to each topic, by the lambda protocol, at the relay’s ARN', () => {
        const subscriptions = Object.values(template.findResources('AWS::SNS::Subscription')).map(
            (resource) => resource.Properties,
        );

        expect(subscriptions).toHaveLength(2);

        for (const subscription of subscriptions) {
            expect(subscription).toMatchObject({ Protocol: 'lambda', Endpoint: RELAY_ARN });
        }

        const topics = Object.keys(template.findResources('AWS::SNS::Topic')).sort();

        expect(topics).toHaveLength(2);
        expect(subscriptions.map((subscription) => subscription.TopicArn)).toEqual(
            expect.arrayContaining(topics.map((id) => ({ Ref: id }))),
        );
    });

    it('⛔ grants sns.amazonaws.com invoke on the relay once per topic, each scoped to THAT topic’s ARN', () => {
        const permissions = Object.values(template.findResources('AWS::Lambda::Permission')).map(
            (resource) => resource.Properties,
        );

        expect(permissions).toHaveLength(2);

        for (const permission of permissions) {
            expect(permission).toMatchObject({
                Action: 'lambda:InvokeFunction',
                FunctionName: RELAY_ARN,
                Principal: 'sns.amazonaws.com',
            });
        }

        const sourceArns = permissions.map((permission) => JSON.stringify(permission.SourceArn));

        expect(new Set(sourceArns).size).toBe(2);
        expect(sourceArns.every((arn) => /FirstTopic|SecondTopic/u.test(arn))).toBe(true);
    });

    it('sets every alarm’s OKActions to its AlarmActions', () => {
        const alarms = template.findResources('AWS::CloudWatch::Alarm');
        const withActions = Object.values(alarms).filter((alarm) => alarm.Properties.AlarmActions !== undefined);

        expect(withActions).toHaveLength(2);

        for (const alarm of withActions) {
            expect(alarm.Properties.OKActions).toEqual(alarm.Properties.AlarmActions);
        }
    });

    it('leaves an alarm with no action alone: it has no ALARM route to mirror', () => {
        const silent = Object.entries(template.findResources('AWS::CloudWatch::Alarm')).find(([id]) =>
            id.startsWith('Silent'),
        );

        expect(silent?.[1].Properties.AlarmActions).toBeUndefined();
        expect(silent?.[1].Properties.OKActions).toBeUndefined();
    });

    it('adds the aspect once per stack, however many topics are subscribed', () => {
        const stack = new Stack(testApp(), 'Counted', { env });

        relayAlarmTransitions(stack, new sns.Topic(stack, 'T'), RELAY_ARN);
        relayAlarmTransitions(stack, new sns.Topic(stack, 'U'), RELAY_ARN);
        relayAlarmTransitions(stack, new sns.Topic(stack, 'V'), RELAY_ARN);

        expect(Aspects.of(stack).all.filter((aspect) => aspect instanceof AlarmTransitionsRelayed)).toHaveLength(1);
    });
});

describe('importAlarmRelayArn', () => {
    const resolve = (stage: string): unknown => {
        const stack = new Stack(testApp(), `Imp${stage.replace(/[^a-z0-9]/gu, '')}`, { env });

        return stack.resolve(importAlarmRelayArn(stage));
    };

    it('imports the PROD relay’s export for prod', () => {
        expect(resolve('prod')).toEqual({ 'Fn::ImportValue': 'kitchensink-alarm-relay-prod:AlarmRelayFunctionArn' });
    });

    it.each(['sandbox', 'pr-91', 'dev'])(
        'imports the SANDBOX relay’s export for %s: one relay per base stage',
        (stage) => {
            expect(resolve(stage)).toEqual({
                'Fn::ImportValue': 'kitchensink-alarm-relay-sandbox:AlarmRelayFunctionArn',
            });
        },
    );
});
