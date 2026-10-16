/**
 * The template reader behind `lambdaRolesCoverTheirSdkCalls`, held to the shapes it must NOT quietly misread: each
 * case is a role or handler the guard cannot judge, and the contract is that it throws naming it rather than
 * reporting a green over a policy it did not read.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    admits,
    handlerModule,
    handlerSource,
    lambdaFunctionsOf,
    missingFrom,
    resolvedText,
    type CfnTemplate,
} from './lambdaRoleReach.js';

const env = { account: '123456789012', region: 'us-east-1' };
const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BASIC = {
    'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole']],
};

const roleWith = (extra: Record<string, unknown> = {}): CfnTemplate['Resources'] => ({
    Fn: {
        Type: 'AWS::Lambda::Function',
        Properties: { Handler: 'a/b.handler', Runtime: 'nodejs24.x', Role: { 'Fn::GetAtt': ['Role', 'Arn'] } },
    },
    Role: { Type: 'AWS::IAM::Role', Properties: { ManagedPolicyArns: [BASIC], ...extra } },
});

describe('lambdaFunctionsOf', () => {
    it('gathers inline role policies AND attached policies, resolving pseudo-parameters in resources', () => {
        const template: CfnTemplate = {
            Resources: {
                ...roleWith({
                    Policies: [
                        {
                            PolicyDocument: {
                                Statement: [
                                    { Effect: 'Allow', Action: 'sqs:SendMessage', Resource: 'arn:aws:sqs:*:*:q' },
                                ],
                            },
                        },
                    ],
                }),
                Attached: {
                    Type: 'AWS::IAM::Policy',
                    Properties: {
                        Roles: [{ Ref: 'Role' }],
                        PolicyDocument: {
                            Statement: [
                                {
                                    Effect: 'Allow',
                                    Action: 'sns:Publish',
                                    Resource: { 'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':sns:x']] },
                                },
                            ],
                        },
                    },
                },
                Elsewhere: {
                    Type: 'AWS::IAM::Policy',
                    Properties: {
                        Roles: [{ Ref: 'SomeOtherRole' }],
                        PolicyDocument: { Statement: [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }] },
                    },
                },
            },
        };
        const [fn] = lambdaFunctionsOf(template, env);

        expect(fn?.handler).toBe('a/b.handler');
        expect(fn?.statements.map((s) => s.Action)).toEqual(['sqs:SendMessage', 'sns:Publish']);
        expect(fn?.statements[1]?.Resource).toEqual(['arn:aws:sns:x']);
    });

    it('refuses a role carrying a managed policy it has not read, naming the policy', () => {
        const template: CfnTemplate = {
            Resources: roleWith({ ManagedPolicyArns: [BASIC, 'arn:aws:iam::aws:policy/AdministratorAccess'] }),
        };

        expect(() => lambdaFunctionsOf(template, env)).toThrow(/AdministratorAccess/u);
    });

    it('refuses a function whose role is not in its own template', () => {
        const template: CfnTemplate = {
            Resources: {
                Fn: {
                    Type: 'AWS::Lambda::Function',
                    Properties: { Handler: 'a.handler', Runtime: 'x', Role: 'arn:aws:iam::1:role/r' },
                },
            },
        };

        expect(() => lambdaFunctionsOf(template, env)).toThrow(/no execution role in its own template/u);
    });

    it('refuses a handler that is an intrinsic rather than guessing what runs', () => {
        const template: CfnTemplate = {
            Resources: {
                ...roleWith(),
                Fn: {
                    Type: 'AWS::Lambda::Function',
                    Properties: { Handler: { Ref: 'P' }, Runtime: 'x', Role: { 'Fn::GetAtt': ['Role', 'Arn'] } },
                },
            },
        };

        expect(() => lambdaFunctionsOf(template, env)).toThrow(/Fn\.Handler is not a literal string/u);
    });
});

describe('resolvedText', () => {
    it('fills Fn::Sub pseudo-parameters and leaves any other reference as a placeholder', () => {
        expect(
            resolvedText({ 'Fn::Sub': 'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${AWS::Region}' }, env),
        ).toBe('arn:aws:iam::123456789012:role/us-east-1');
        expect(resolvedText({ 'Fn::GetAtt': ['Q', 'Arn'] }, env)).toMatch(/^<.*Fn::GetAtt.*>$/u);
    });
});

describe('admits / missingFrom', () => {
    const statements = [{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: ['<{"Fn::GetAtt":["Q","Arn"]}>'] }];

    it('admits an action the role allows on some resource when the call names none, and reports one it does not', () => {
        expect(admits(statements, { action: 'sqs:SendMessage', site: 'x:1' }, env)).toBe(true);
        expect(missingFrom(statements, [{ action: 'sqs:DeleteMessage', site: 'h.ts:9' }], env)).toEqual([
            'sqs:DeleteMessage (h.ts:9)',
        ]);
    });

    it('evaluates a call that names its resource ON that resource, so a grant on another does not admit it', () => {
        expect(
            admits(
                [
                    {
                        Effect: 'Allow',
                        Action: 'cloudformation:ListStacks',
                        Resource: ['arn:aws:cloudformation:us-east-1:1:stack/x/*'],
                    },
                ],
                {
                    action: 'cloudformation:ListStacks',
                    evaluatedOn: 'arn:aws:cloudformation:{region}:{account}:stack/*/*',
                    site: 's',
                },
                env,
            ),
        ).toBe(false);
    });
});

describe('handler → source', () => {
    it('reads the module before the LAST dot', () => {
        expect(handlerModule('handlers/a.handler')).toBe('handlers/a');
        expect(() => handlerModule('nodot')).toThrow(/not a <module>.<export>/u);
    });

    it('maps to src/<module>.ts under the package, honours an override, and throws when nothing answers', () => {
        expect(handlerSource(PACKAGE_DIR, 'sandbox-scheduler/handler.handler', {})).toBe(
            path.join(PACKAGE_DIR, 'src/sandbox-scheduler/handler.ts'),
        );
        expect(
            handlerSource(PACKAGE_DIR, 'handler.handler', { 'handler.handler': 'src/edge-verifier/handler.ts' }),
        ).toBe(path.join(PACKAGE_DIR, 'src/edge-verifier/handler.ts'));
        expect(() => handlerSource(PACKAGE_DIR, 'nowhere/at-all.handler', {})).toThrow(/does not exist/u);
    });
});
