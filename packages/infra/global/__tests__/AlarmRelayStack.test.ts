// @vitest-environment node
/**
 * The alarm relay's stack (ADR-0062): the Lambda every alarm topic delivers to, the queue that holds what it could not
 * deliver, and the alarm that says that queue is not empty.
 *
 * ⛔ Each property below is one a reviewer would otherwise have to take on trust, because none of them fails at deploy:
 *
 *  - NO VPC. The relay reaches Sentry over the public internet; a VPC attachment would make it a consumer of the NAT
 *    instance (ADR-0004) for nothing.
 *  - AN EXPLICIT LOG ROLE, not the managed basic-execution policy (cdk-nag IAM4), scoped to its own log group.
 *  - THE FAILURE QUEUE, because Lambda retries an asynchronous invocation twice and then discards the event unless a
 *    destination keeps it — the failed-delivery policy in `handler.ts` is only worth anything if the event survives it.
 *  - THE DEPTH ALARM, gated on the stage's alarm switch like every other alarm.
 *  - THE EXPORT, which every consumer imports; once imported the function cannot be replaced without detaching them.
 */
import { Match, Template } from 'aws-cdk-lib/assertions';
import { NODE_LAMBDA_RUNTIME } from '@radicle-co/infra-shared/security';
import { describe, expect, it } from 'vitest';

import { AlarmRelayStack } from '../lib/platform/AlarmRelayStack.js';
import { testApp } from './testApp.js';

const env = { account: '123456789012', region: 'us-east-1' };
const FORWARDER_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:log-forwarder';

/** Synthesize the relay stack. */
function synth(options: { alarmsEnabled?: boolean; logForwarderArn?: string; stage?: string } = {}): Template {
    const stage = options.stage ?? 'prod';
    const stack = new AlarmRelayStack(testApp(), `AlarmRelay-${stage}`, {
        env,
        stackName: `kitchensink-alarm-relay-${stage}`,
        stage,
        alarmsEnabled: options.alarmsEnabled ?? true,
        alertEmail: 'ops@example.com',
        ...(options.logForwarderArn === undefined ? {} : { logForwarderArn: options.logForwarderArn }),
    });

    return Template.fromStack(stack);
}

/** The relay function's properties. */
function relayFunction(template: Template): Record<string, unknown> {
    const functions = Object.values(template.findResources('AWS::Lambda::Function'));

    expect(functions).toHaveLength(1);

    return functions[0]?.Properties as Record<string, unknown>;
}

describe('the relay function', () => {
    const template = synth();
    const properties = relayFunction(template);

    it('is a small arm64 Node function with a short deadline', () => {
        expect(properties).toMatchObject({
            Runtime: NODE_LAMBDA_RUNTIME.name,
            Architectures: ['arm64'],
            MemorySize: 128,
            Timeout: 30,
        });
    });

    it('runs the alarm-relay handler (or the throwing placeholder when the bundle is absent)', () => {
        expect(properties['Handler']).toMatch(/^(index|alarmRelay\/handler)\.handler$/u);
    });

    it('⛔ is NOT in a VPC: it is not a NAT consumer (ADR-0004)', () => {
        expect(properties['VpcConfig']).toBeUndefined();
    });

    it('is told its stage and reads its Sentry DSN from the platform parameter of its base stage', () => {
        const variables = (properties['Environment'] as { Variables: Record<string, unknown> }).Variables;

        expect(variables['STAGE']).toBe('prod');
        expect(variables['SENTRY_DSN']).toBeDefined();
        template.hasParameter('*', {
            Type: 'AWS::SSM::Parameter::Value<String>',
            Default: '/kitchensink/prod/sentry/platform-dsn',
        });
    });

    it('reads the SANDBOX platform DSN for every non-prod stage', () => {
        synth({ stage: 'sandbox' }).hasParameter('*', {
            Type: 'AWS::SSM::Parameter::Value<String>',
            Default: '/kitchensink/sandbox/sentry/platform-dsn',
        });
    });

    it('has a one-month, template-owned log group, and writes to it', () => {
        template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 30 });
        expect(JSON.stringify(properties['LoggingConfig'])).toContain('AlarmRelayLogGroup');
    });
});

describe('⛔ its role', () => {
    const template = synth();

    it('attaches no AWS-managed policy (IAM4)', () => {
        for (const role of Object.values(template.findResources('AWS::IAM::Role'))) {
            expect(role.Properties['ManagedPolicyArns']).toBeUndefined();
        }
    });

    it('may write logs to its own group only', () => {
        const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
            (policy) => policy.Properties.PolicyDocument.Statement as Record<string, unknown>[],
        );
        const logStatements = statements.filter((statement) =>
            [statement['Action']].flat().some((action) => String(action).startsWith('logs:')),
        );

        expect(logStatements).toHaveLength(1);
        expect([logStatements[0]?.['Action']].flat().sort()).toEqual(['logs:CreateLogStream', 'logs:PutLogEvents']);
        expect(JSON.stringify(logStatements[0]?.['Resource'])).not.toContain('"*"');
        expect(JSON.stringify(logStatements[0]?.['Resource'])).toContain('LogGroup');
    });

    it('may send to the failure queue and nothing wider', () => {
        const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
            (policy) => policy.Properties.PolicyDocument.Statement as Record<string, unknown>[],
        );
        const sqs = statements.filter((statement) =>
            [statement['Action']].flat().some((action) => String(action).startsWith('sqs:')),
        );

        expect(sqs).toHaveLength(1);
        expect([sqs[0]?.['Action']].flat()).toEqual(expect.arrayContaining(['sqs:SendMessage']));
        expect(JSON.stringify(sqs[0]?.['Resource'])).not.toContain('"*"');
    });
});

describe('the failed-delivery path', () => {
    const template = synth();

    it('retries an asynchronous invocation twice, then keeps the event in the failure queue', () => {
        template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
            MaximumRetryAttempts: 2,
            DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
        });
    });

    it('holds the event for 14 days, behind SSL only', () => {
        template.hasResourceProperties('AWS::SQS::Queue', { MessageRetentionPeriod: 1_209_600 });
        template.hasResourceProperties('AWS::SQS::QueuePolicy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
                ]),
            }),
        });
    });

    it('alarms when anything is in the queue, but only when the stage’s alarm switch is on', () => {
        template.hasResourceProperties('AWS::CloudWatch::Alarm', {
            Namespace: 'AWS/SQS',
            MetricName: 'ApproximateNumberOfMessagesVisible',
            Threshold: 1,
            ComparisonOperator: 'GreaterThanOrEqualToThreshold',
            TreatMissingData: 'notBreaching',
        });
        expect(Object.keys(synth({ alarmsEnabled: false }).findResources('AWS::CloudWatch::Alarm'))).toEqual([]);
    });
});

describe('its own alarm topic', () => {
    it('publishes over SSL only, lets CloudWatch publish for this account, and reaches a human', () => {
        const template = synth();

        template.hasResourceProperties('AWS::SNS::TopicPolicy', {
            PolicyDocument: Match.objectLike({
                Statement: Match.arrayWith([
                    Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
                    Match.objectLike({
                        Sid: 'AllowCloudWatchAlarmPublish',
                        Principal: { Service: 'cloudwatch.amazonaws.com' },
                        Condition: { StringEquals: { 'aws:SourceAccount': '123456789012' } },
                    }),
                ]),
            }),
        });
        template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' });
    });

    it('also delivers to the relay itself, so a failure-queue alarm is reported when Sentry can be reached', () => {
        const template = synth();

        template.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'lambda' });
        template.hasResourceProperties('AWS::Lambda::Permission', {
            Principal: 'sns.amazonaws.com',
            SourceArn: Match.anyValue(),
        });
        expect(
            synth({ alarmsEnabled: false }).findResources('AWS::SNS::Subscription', {
                Properties: { Protocol: 'lambda' },
            }),
        ).toEqual({});
    });
});

describe('the log drain (ADR-0042, register key `alarm-relay`)', () => {
    it('attaches a subscription filter only when the forwarder’s ARN is known', () => {
        synth({ logForwarderArn: FORWARDER_ARN }).hasResourceProperties('AWS::Logs::SubscriptionFilter', {
            DestinationArn: FORWARDER_ARN,
            FilterName: 'forward-app-logs',
        });
        expect(synth().findResources('AWS::Logs::SubscriptionFilter')).toEqual({});
    });
});

describe('the export every consumer imports', () => {
    it('is `kitchensink-alarm-relay-{stage}:AlarmRelayFunctionArn`, and the function’s ARN', () => {
        for (const stage of ['prod', 'sandbox']) {
            const outputs = synth({ stage }).toJSON()['Outputs'] as Record<
                string,
                { Export?: { Name: string }; Value: unknown }
            >;
            const exported = Object.values(outputs).find(
                (output) => output.Export?.Name === `kitchensink-alarm-relay-${stage}:AlarmRelayFunctionArn`,
            );

            expect(exported, stage).toBeDefined();
            expect(JSON.stringify(exported?.Value)).toContain('"Fn::GetAtt"');
            expect(JSON.stringify(exported?.Value)).toContain('Arn');
        }
    });
});
