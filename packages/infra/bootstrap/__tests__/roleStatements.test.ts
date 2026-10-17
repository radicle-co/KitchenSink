/**
 * The resource renderer behind the boundary's "every synthesized role statement is admitted" guard.
 *
 * A role policy in a template names its resources with intrinsics (`Fn::GetAtt`, `Fn::Join`, `Fn::ImportValue`, an SSM
 * parameter reference). A guard that wants to ask "does the boundary admit this (action, resource)?" needs a concrete
 * ARN, so this file holds the rendering to the shapes the tree really writes, and holds an UNRESOLVED reference to stay
 * visible (a token) rather than silently becoming a wildcard that every pattern admits.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { emptyDerived, finalizeRoleStatements, foldCloudAssembly, toManifest } from '../scripts/deriveResourceTypes.js';

import {
    ACCOUNT_ID,
    REGION_NAME,
    buildWorld,
    renderRoleStatements,
    type StackTemplate,
} from '../src/roleStatements.js';

const stack = (stackName: string, template: StackTemplate['template']): StackTemplate => ({ stackName, template });

const policy = (resource: unknown, action: unknown = 'sqs:SendMessage'): StackTemplate['template'] => ({
    Resources: {
        Policy: {
            Type: 'AWS::IAM::Policy',
            Properties: { PolicyDocument: { Statement: [{ Effect: 'Allow', Action: action, Resource: resource }] } },
        },
    },
});

const render = (stacks: readonly StackTemplate[], index = 0) => {
    const stackUnderTest = stacks[index];

    if (stackUnderTest === undefined) {
        throw new Error('no such stack');
    }

    return renderRoleStatements(buildWorld(stacks), stackUnderTest);
};

describe('renderRoleStatements', () => {
    it('keeps only Allow statements and lists the actions as an array', () => {
        const template = {
            Resources: {
                Policy: {
                    Type: 'AWS::IAM::ManagedPolicy',
                    Properties: {
                        PolicyDocument: {
                            Statement: [
                                { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: '*' },
                                { Effect: 'Deny', Action: 'sqs:*', Resource: '*' },
                            ],
                        },
                    },
                },
            },
        };

        expect(render([stack('kitchensink-a-sandbox', template)])).toEqual([
            { actions: ['sqs:SendMessage'], resources: ['*'] },
        ]);
    });

    it('reads the inline policies of a role as well as standalone policies', () => {
        const template = {
            Resources: {
                Role: {
                    Type: 'AWS::IAM::Role',
                    Properties: {
                        Policies: [
                            {
                                PolicyDocument: {
                                    Statement: [{ Effect: 'Allow', Action: ['sqs:SendMessage'], Resource: '*' }],
                                },
                            },
                        ],
                    },
                },
            },
        };

        expect(render([stack('kitchensink-a-sandbox', template)])).toHaveLength(1);
    });

    it('renders pseudo parameters and Fn::Join', () => {
        const resource = {
            'Fn::Join': [
                '',
                [
                    'arn:',
                    { Ref: 'AWS::Partition' },
                    ':sqs:',
                    { Ref: 'AWS::Region' },
                    ':',
                    { Ref: 'AWS::AccountId' },
                    ':q',
                ],
            ],
        };

        expect(render([stack('kitchensink-a-sandbox', policy(resource))])[0]?.resources).toEqual([
            `arn:aws:sqs:${REGION_NAME}:${ACCOUNT_ID}:q`,
        ]);
    });

    it('names an unnamed queue the way CloudFormation does: stack name, logical id, then a generated suffix', () => {
        const template = {
            Resources: {
                ...policy({ 'Fn::GetAtt': ['WorkQueue', 'Arn'] }).Resources,
                WorkQueue: { Type: 'AWS::SQS::Queue' },
            },
        };

        const [statement] = render([stack('kitchensink-data-sandbox', template)]);

        expect(statement?.resources).toEqual([
            `arn:aws:sqs:${REGION_NAME}:${ACCOUNT_ID}:kitchensink-data-sandbox-WorkQueue-GENERATED`,
        ]);
    });

    it('uses an explicit name over a generated one', () => {
        const template = {
            Resources: {
                ...policy({ 'Fn::GetAtt': ['WorkQueue', 'Arn'] }).Resources,
                WorkQueue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'kitchensink-work-sandbox' } },
            },
        };

        expect(render([stack('kitchensink-data-sandbox', template)])[0]?.resources).toEqual([
            `arn:aws:sqs:${REGION_NAME}:${ACCOUNT_ID}:kitchensink-work-sandbox`,
        ]);
    });

    it('names a generated secret by its logical id alone, with no stack prefix (that is what CloudFormation does)', () => {
        const template = {
            Resources: {
                ...policy({ Ref: 'DbSecret' }, 'secretsmanager:GetSecretValue').Resources,
                DbSecret: { Type: 'AWS::SecretsManager::Secret' },
            },
        };

        expect(render([stack('kitchensink-data-sandbox', template)])[0]?.resources).toEqual([
            `arn:aws:secretsmanager:${REGION_NAME}:${ACCOUNT_ID}:secret:DbSecret-GENERATED`,
        ]);
    });

    it('names a generated state machine by its logical id alone, with no stack prefix', () => {
        const template = {
            Resources: {
                ...policy({ Ref: 'Flow' }, 'states:StartExecution').Resources,
                Flow: { Type: 'AWS::StepFunctions::StateMachine' },
            },
        };

        expect(render([stack('kitchensink-sched-sandbox', template)])[0]?.resources).toEqual([
            `arn:aws:states:${REGION_NAME}:${ACCOUNT_ID}:stateMachine:Flow-GENERATED`,
        ]);
    });

    it('lower-cases a generated bucket name', () => {
        const template = {
            Resources: {
                ...policy({ 'Fn::GetAtt': ['MediaBucket', 'Arn'] }, 's3:GetObject*').Resources,
                MediaBucket: { Type: 'AWS::S3::Bucket' },
            },
        };

        expect(render([stack('kitchensink-data-sandbox', template)])[0]?.resources).toEqual([
            'arn:aws:s3:::kitchensink-data-sandbox-mediabucket-generated',
        ]);
    });

    it('follows an Fn::ImportValue into the stack that exports it', () => {
        const exporter = stack('kitchensink-data-sandbox', {
            Resources: { Topic: { Type: 'AWS::SNS::Topic' } },
            Outputs: {
                TopicArn: { Value: { Ref: 'Topic' }, Export: { Name: 'kitchensink-data-sandbox:TopicArn' } },
            },
        });
        const importer = stack(
            'kitchensink-id-sandbox',
            policy({ 'Fn::ImportValue': 'kitchensink-data-sandbox:TopicArn' }, 'sns:Publish'),
        );

        expect(render([exporter, importer], 1)[0]?.resources).toEqual([
            `arn:aws:sns:${REGION_NAME}:${ACCOUNT_ID}:kitchensink-data-sandbox-Topic-GENERATED`,
        ]);
    });

    it('follows an SSM parameter reference to the stack that writes the parameter', () => {
        const writer = stack('kitchensink-data-sandbox', {
            Resources: {
                Table: { Type: 'AWS::DynamoDB::Table' },
                Param: {
                    Type: 'AWS::SSM::Parameter',
                    Properties: { Name: '/kitchensink/sandbox/table-arn', Value: { 'Fn::GetAtt': ['Table', 'Arn'] } },
                },
            },
        });
        const reader = stack('kitchensink-svc-sandbox', {
            Parameters: {
                SsmParameterValueTable: {
                    Type: 'AWS::SSM::Parameter::Value<String>',
                    Default: '/kitchensink/sandbox/table-arn',
                },
            },
            ...policy({ Ref: 'SsmParameterValueTable' }, 'dynamodb:PutItem'),
        });

        expect(render([writer, reader], 1)[0]?.resources).toEqual([
            `arn:aws:dynamodb:${REGION_NAME}:${ACCOUNT_ID}:table/kitchensink-data-sandbox-Table-GENERATED`,
        ]);
    });

    it('renders Fn::Sub and Fn::Select over Fn::Split', () => {
        const sub = { 'Fn::Sub': 'arn:${AWS::Partition}:sqs:${AWS::Region}:${AWS::AccountId}:q' };
        const select = { 'Fn::Select': [1, { 'Fn::Split': [':', 'a:b:c'] }] };

        expect(render([stack('kitchensink-a-sandbox', policy([sub, select]))])[0]?.resources).toEqual([
            `arn:aws:sqs:${REGION_NAME}:${ACCOUNT_ID}:q`,
            'b',
        ]);
    });

    it('renders every branch of an Fn::If, so neither can hide', () => {
        const resource = { 'Fn::If': ['Cond', 'arn:aws:sqs:*:*:a', 'arn:aws:sqs:*:*:b'] };

        expect(render([stack('kitchensink-a-sandbox', policy(resource))])[0]?.resources).toEqual([
            'arn:aws:sqs:*:*:a',
            'arn:aws:sqs:*:*:b',
        ]);
    });

    it('leaves a reference it cannot resolve as a visible token, never as a wildcard', () => {
        const [statement] = render([
            stack('kitchensink-a-sandbox', policy({ 'Fn::ImportValue': 'nobody:Exports:This' })),
        ]);

        expect(statement?.resources).toHaveLength(1);
        expect(statement?.resources[0]).toContain('UNRESOLVED');
        expect(statement?.resources[0]).not.toBe('*');
    });

    it('is stable: statements are sorted and deduplicated', () => {
        const template = {
            Resources: {
                A: {
                    Type: 'AWS::IAM::Policy',
                    Properties: {
                        PolicyDocument: {
                            Statement: [
                                { Effect: 'Allow', Action: ['sqs:SendMessage', 'sqs:GetQueueUrl'], Resource: '*' },
                                { Effect: 'Allow', Action: ['sqs:GetQueueUrl', 'sqs:SendMessage'], Resource: '*' },
                            ],
                        },
                    },
                },
            },
        };

        expect(render([stack('kitchensink-a-sandbox', template)])).toEqual([
            { actions: ['sqs:GetQueueUrl', 'sqs:SendMessage'], resources: ['*'] },
        ]);
    });
});

describe('the derivation records rendered statements', () => {
    const scratch: string[] = [];

    afterEach(() => {
        for (const directory of scratch.splice(0)) {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    function writeStack(directory: string, id: string, stackName: string, template: object): void {
        writeFileSync(
            path.join(directory, 'manifest.json'),
            JSON.stringify({
                version: '1.0.0',
                artifacts: {
                    [id]: {
                        type: 'aws:cloudformation:stack',
                        properties: { stackName, templateFile: `${id}.template.json` },
                    },
                },
            }),
        );
        writeFileSync(path.join(directory, `${id}.template.json`), JSON.stringify(template));
    }

    it('follows a reference from one app into the stack of another app folded into the same qualifier', () => {
        const exporting = mkdtempSync(path.join(tmpdir(), 'ksRoleA-'));
        const importing = mkdtempSync(path.join(tmpdir(), 'ksRoleB-'));
        scratch.push(exporting, importing);
        writeStack(exporting, 'Data', 'kitchensink-data-sandbox', {
            Resources: { Queue: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'kitchensink-work-sandbox' } } },
            Outputs: {
                QueueArn: {
                    Value: { 'Fn::GetAtt': ['Queue', 'Arn'] },
                    Export: { Name: 'kitchensink-data-sandbox:QueueArn' },
                },
            },
        });
        writeStack(
            importing,
            'Svc',
            'kitchensink-svc-sandbox',
            policy({ 'Fn::ImportValue': 'kitchensink-data-sandbox:QueueArn' }),
        );
        const derived = emptyDerived();

        foldCloudAssembly(exporting, derived);
        foldCloudAssembly(importing, derived);
        finalizeRoleStatements(derived);

        expect(derived.roleStatements).toEqual([
            {
                actions: ['sqs:SendMessage'],
                resources: [`arn:aws:sqs:${REGION_NAME}:${ACCOUNT_ID}:kitchensink-work-sandbox`],
            },
        ]);
        expect((toManifest('ksnonprod', derived) as { roleStatements: unknown[] }).roleStatements).toHaveLength(1);
    });

    it('names a nested stack so its statements are still rendered', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'ksRoleC-'));
        scratch.push(directory);
        writeStack(directory, 'Parent', 'kitchensink-parent-sandbox', {});
        writeFileSync(path.join(directory, 'Parent.nested.template.json'), JSON.stringify(policy('*')));
        const derived = emptyDerived();

        foldCloudAssembly(directory, derived);
        finalizeRoleStatements(derived);

        expect(derived.roleStatements).toHaveLength(1);
    });
});
