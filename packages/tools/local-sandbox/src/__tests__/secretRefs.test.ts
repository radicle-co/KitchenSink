/**
 * Repo-wide guard: a container's SECRETS are part of its environment, and a local run has to supply them.
 *
 * ## Why this exists
 *
 * `discoverServiceTasks` read `ContainerDefinitions[0].Environment` and nothing else. But a value the CDK
 * considers sensitive is not in `Environment` — it is in `Secrets`, injected by ECS from Secrets Manager so
 * it never lands in the template. `FoodServiceStack` does exactly that for `USDA_API_KEY`, and
 * `food-service`'s own zod env schema REQUIRES it. So the generated container had no `USDA_API_KEY` at all
 * and the service crash-looped on its own validation:
 *
 *     ZodError: [{ "path": ["USDA_API_KEY"], "message": "expected string, received undefined" }]
 *
 * A local stack that omits a required secret is not a local stack — it is two healthy containers and one
 * restart loop. The value has to come from the same place CI gets it: Secrets Manager, resolved at startup
 * (`.github/actions/load-secrets/action.yml` is the same move for the Clerk keys).
 *
 * ## Why parsing is split from fetching
 *
 * Reading a ValueFrom is pure and exhaustively testable; calling AWS is neither. The parse answers "which
 * secret, and which JSON key inside it", and the caller supplies the fetch — so every shape below is
 * covered without a network, and the AWS client has one place to live.
 */
import { describe, expect, it } from 'vitest';

import { parseSecretRef, secretRefsOf, ssmRefsOf } from '../secretRefs.js';

describe('parseSecretRef', () => {
    it('reads a literal ARN built by Fn::Join — the shape `fromSecretNameV2` emits', () => {
        // Verbatim from a real `cdk synth` of FoodServiceStack.
        const valueFrom = {
            'Fn::Join': [
                '',
                [
                    'arn:',
                    { Ref: 'AWS::Partition' },
                    ':secretsmanager:us-east-1:040663841500:secret:kitchensink/sandbox/food/usda-api-key',
                ],
            ],
        };

        expect(parseSecretRef(valueFrom)).toStrictEqual({
            secretId: 'kitchensink/sandbox/food/usda-api-key',
            jsonKey: undefined,
        });
    });

    it('reads the JSON key off a `:key::` suffix', () => {
        const valueFrom = {
            'Fn::Join': [
                '',
                [
                    'arn:',
                    { Ref: 'AWS::Partition' },
                    ':secretsmanager:us-east-1:040663841500:secret:kitchensink/sandbox/identity/keys:PUBLISHABLE_KEY::',
                ],
            ],
        };

        expect(parseSecretRef(valueFrom)).toStrictEqual({
            secretId: 'kitchensink/sandbox/identity/keys',
            jsonKey: 'PUBLISHABLE_KEY',
        });
    });

    it('answers undefined for a cross-stack import, which has no literal to read', () => {
        // ⛔ This is the DB credential shape. There is nothing to resolve — the ARN only exists once
        // DataStack is deployed — and resolving it would be WRONG anyway: the local database is the
        // postgres container, whose credentials the compose file already sets. Absence here is what lets
        // the local value win.
        const valueFrom = {
            'Fn::Join': ['', [{ 'Fn::ImportValue': 'kitchensink-data-dev:DatabaseSecretArn' }, ':username::']],
        };

        expect(parseSecretRef(valueFrom)).toBeUndefined();
    });

    it('answers undefined for a plain string that is not a secretsmanager ARN', () => {
        expect(parseSecretRef('not-an-arn')).toBeUndefined();
        expect(parseSecretRef(undefined)).toBeUndefined();
    });

    it('reads a plain-string ARN, not only the Fn::Join form', () => {
        expect(
            parseSecretRef(
                'arn:aws:secretsmanager:us-east-1:040663841500:secret:kitchensink/sandbox/food/usda-api-key',
            ),
        ).toStrictEqual({ secretId: 'kitchensink/sandbox/food/usda-api-key', jsonKey: undefined });
    });
});

describe('secretRefsOf', () => {
    it('finds every secret across every container of every task definition', () => {
        const template = {
            Resources: {
                Api: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [
                            {
                                Secrets: [
                                    {
                                        Name: 'USDA_API_KEY',
                                        ValueFrom: {
                                            'Fn::Join': [
                                                '',
                                                [
                                                    'arn:',
                                                    { Ref: 'AWS::Partition' },
                                                    ':secretsmanager:us-east-1:1:secret:kitchensink/sandbox/food/usda-api-key',
                                                ],
                                            ],
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
                NotATask: { Type: 'AWS::S3::Bucket', Properties: {} },
            },
        };

        expect(secretRefsOf(template)).toStrictEqual([
            { name: 'USDA_API_KEY', secretId: 'kitchensink/sandbox/food/usda-api-key', jsonKey: undefined },
        ]);
    });

    it('de-duplicates a secret that several task definitions share', () => {
        // ⚠️ food declares USDA_API_KEY on all three of its task definitions (api, worker, change-refresh).
        // Fetching it three times is three API calls for one value.
        const secret = {
            Name: 'USDA_API_KEY',
            ValueFrom: 'arn:aws:secretsmanager:us-east-1:1:secret:kitchensink/sandbox/food/usda-api-key',
        };
        const task = {
            Type: 'AWS::ECS::TaskDefinition',
            Properties: { ContainerDefinitions: [{ Secrets: [secret] }] },
        };

        expect(secretRefsOf({ Resources: { A: task, B: task, C: task } })).toHaveLength(1);
    });

    it('reports nothing for a template with no task definitions, rather than throwing', () => {
        expect(secretRefsOf({ Resources: {} })).toStrictEqual([]);
        expect(secretRefsOf({})).toStrictEqual([]);
        expect(secretRefsOf(undefined)).toStrictEqual([]);
    });

    it('skips a secret whose ValueFrom cannot be resolved to a literal, keeping the rest', () => {
        const template = {
            Resources: {
                Identity: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [
                            {
                                Secrets: [
                                    {
                                        Name: 'DB_PASSWORD',
                                        ValueFrom: {
                                            'Fn::Join': [
                                                '',
                                                [
                                                    { 'Fn::ImportValue': 'kitchensink-data-dev:DatabaseSecretArn' },
                                                    ':password::',
                                                ],
                                            ],
                                        },
                                    },
                                    {
                                        Name: 'USDA_API_KEY',
                                        ValueFrom:
                                            'arn:aws:secretsmanager:us-east-1:1:secret:kitchensink/sandbox/food/usda-api-key',
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };

        expect(secretRefsOf(template).map((r) => r.name)).toStrictEqual(['USDA_API_KEY']);
    });
});

describe('ssmRefsOf', () => {
    /**
     * ⛔ THE SECOND HALF OF THE SAME BUG. `ssm.StringParameter.valueForStringParameter` does not put a value
     * in the template either — it emits a CloudFormation Parameter of type
     * `AWS::SSM::Parameter::Value<String>` whose `Default` is the parameter PATH, and the container env holds
     * a `Ref` to it. So the name IS in `Environment` (unlike a secret) but the value is resolvable only at
     * deploy.
     *
     * `localImages.ts` handled that by OMITTING `CLERK_JWT_KEY`, on the stated grounds that "the schemas make
     * these optional off deployed stages". Measured: recipe-service REQUIRES it and refused to boot —
     * `ConfigValidationError: CLERK_JWT_KEY: expected string, received undefined`. The parameter is a PUBLIC
     * verification key that exists in SSM, so the fix is to read it, not to omit it.
     */
    it('resolves an env Ref through the template Parameters to the SSM path', () => {
        const template = {
            Parameters: {
                SsmParameterValueClerk: {
                    Type: 'AWS::SSM::Parameter::Value<String>',
                    Default: '/kitchensink/sandbox/clerk/jwt-public-key',
                },
            },
            Resources: {
                Api: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [
                            { Environment: [{ Name: 'CLERK_JWT_KEY', Value: { Ref: 'SsmParameterValueClerk' } }] },
                        ],
                    },
                },
            },
        };

        expect(ssmRefsOf(template)).toStrictEqual([
            { name: 'CLERK_JWT_KEY', parameterPath: '/kitchensink/sandbox/clerk/jwt-public-key' },
        ]);
    });

    it('ignores a Ref to a parameter that is not an SSM lookup', () => {
        // ⚠️ `BootstrapVersion` is also `AWS::SSM::Parameter::Value<String>`, but nothing reads it as env.
        // The discriminator is that the env value REFERENCES it, not the parameter type alone.
        const template = {
            Parameters: { Plain: { Type: 'String', Default: 'not-ssm' } },
            Resources: {
                Api: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [{ Environment: [{ Name: 'THING', Value: { Ref: 'Plain' } }] }],
                    },
                },
            },
        };

        expect(ssmRefsOf(template)).toStrictEqual([]);
    });

    it('ignores a literal env value and an Fn::ImportValue, which are not SSM', () => {
        const template = {
            Resources: {
                Api: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [
                            {
                                Environment: [
                                    { Name: 'PLAIN', Value: 'literal' },
                                    { Name: 'IMPORTED', Value: { 'Fn::ImportValue': 'stack:Thing' } },
                                ],
                            },
                        ],
                    },
                },
            },
        };

        expect(ssmRefsOf(template)).toStrictEqual([]);
    });

    it('reports nothing for an empty or absent template rather than throwing', () => {
        expect(ssmRefsOf({ Resources: {} })).toStrictEqual([]);
        expect(ssmRefsOf(undefined)).toStrictEqual([]);
    });
});
