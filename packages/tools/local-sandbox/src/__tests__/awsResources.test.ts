/**
 * Repo-wide guard: the AWS resources a local run must CREATE, read out of the synthesised CDK.
 *
 * ⛔ WHY THIS EXISTS. `local:up` started LocalStack and never put anything in it. Every declared bucket,
 * queue, table and topic was absent, so the services received `S3_BUCKET_PHOTOS=local-placeholder` and
 * `ACCOUNT_ERASURE_QUEUE_URL=http://localhost:1`. The endpoint and credentials worked — a real SDK call from
 * inside a container reached LocalStack and returned zero buckets — so nothing failed at startup, and the
 * first sign of trouble would have been a photo upload 500ing at run time.
 *
 * ⛔ NOTHING IS ENUMERATED. The inventory is the templates. A queue added to the CDK tomorrow is created the
 * same day, which is the rule the whole package is built on.
 *
 * ## The part that is easy to get wrong
 *
 * A container does not name a bucket directly — it holds `Fn::ImportValue` of another stack's export, and
 * that export is `{ "Ref": <logicalId> }`. `Ref` does NOT mean the same thing for every type, and using one
 * meaning for all of them is the obvious mistake:
 *
 *   - `Ref` on a bucket  → the bucket NAME
 *   - `Ref` on a queue   → the queue URL
 *   - `Ref` on a topic   → the topic ARN
 *   - `Ref` on a table   → the table NAME
 *
 * So `S3_BUCKET_PHOTOS` wants a name while `ACCOUNT_ERASURE_QUEUE_URL` wants a URL, and both arrive by the
 * identical `Ref`-through-an-export route.
 */
import { describe, expect, it } from 'vitest';

import {
    creatableResources,
    importRefsOf,
    localExportMap,
    ownRefsOf,
    refValueOf,
    resolveParameterValues,
    resolveImport,
} from '../awsResources.js';

const LOCALSTACK = { endpoint: 'http://localhost:4566', region: 'us-east-1', account: '000000000000' };

describe('creatableResources', () => {
    it('finds each supported type and keeps the declared name', () => {
        const template = {
            Resources: {
                Q: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'kitchensink-recipe-verification-dev' } },
                T: { Type: 'AWS::DynamoDB::Table', Properties: { TableName: 'kitchensink-messages-dev' } },
                P: { Type: 'AWS::SSM::Parameter', Properties: { Name: '/kitchensink/dev/thing', Value: 'v' } },
            },
        };

        // Template order, which is what the function documents — not an order this test invents.
        expect(creatableResources('Stack', template).map((r) => [r.type, r.name])).toStrictEqual([
            ['AWS::SQS::Queue', 'kitchensink-recipe-verification-dev'],
            ['AWS::DynamoDB::Table', 'kitchensink-messages-dev'],
            ['AWS::SSM::Parameter', '/kitchensink/dev/thing'],
        ]);
    });

    it('derives a stable name when the CDK left it to CloudFormation', () => {
        // ⚠️ Both buckets in `DataStack` have no `BucketName` — CDK lets CloudFormation generate one. A local
        // run still needs SOME name, and it must be the SAME name on every run or the env wiring breaks
        // between `local:up` invocations.
        const template = { Resources: { MediaBucketBCBB02BA: { Type: 'AWS::S3::Bucket', Properties: {} } } };

        const first = creatableResources('GlobaldevDatadev', template);
        const second = creatableResources('GlobaldevDatadev', template);

        expect(first[0]?.name).toBe(second[0]?.name);
        expect(first[0]?.name).toMatch(/^[a-z0-9.-]+$/u);
    });

    it('lowercases a derived bucket name, because S3 rejects uppercase', () => {
        const template = { Resources: { MediaBucketBCBB02BA: { Type: 'AWS::S3::Bucket', Properties: {} } } };

        const name = creatableResources('GlobaldevDatadev', template)[0]?.name ?? '';

        expect(name).toBe(name.toLowerCase());
    });

    it('ignores a type nothing local can create', () => {
        const template = { Resources: { D: { Type: 'AWS::CloudFront::Distribution', Properties: {} } } };

        expect(creatableResources('Stack', template)).toStrictEqual([]);
    });

    it('reports nothing for an empty or absent template rather than throwing', () => {
        expect(creatableResources('Stack', { Resources: {} })).toStrictEqual([]);
        expect(creatableResources('Stack', undefined)).toStrictEqual([]);
    });
});

describe('refValueOf', () => {
    /**
     * ⛔ `Ref` MEANS A DIFFERENT THING PER TYPE. Treating it as "the name" everywhere would hand
     * `ACCOUNT_ERASURE_QUEUE_URL` a queue name instead of a URL, and the SDK would fail on a malformed
     * endpoint rather than on anything that points at the mistake.
     */
    it('answers the bucket name for a bucket', () => {
        expect(refValueOf({ type: 'AWS::S3::Bucket', name: 'media-bucket' }, LOCALSTACK)).toBe('media-bucket');
    });

    it('answers the queue URL for a queue', () => {
        expect(refValueOf({ type: 'AWS::SQS::Queue', name: 'erasure' }, LOCALSTACK)).toBe(
            'http://localhost:4566/000000000000/erasure',
        );
    });

    it('answers the topic ARN for a topic', () => {
        expect(refValueOf({ type: 'AWS::SNS::Topic', name: 'handle-sync' }, LOCALSTACK)).toBe(
            'arn:aws:sns:us-east-1:000000000000:handle-sync',
        );
    });

    it('answers the table name for a table', () => {
        expect(refValueOf({ type: 'AWS::DynamoDB::Table', name: 'messages' }, LOCALSTACK)).toBe('messages');
    });
});

describe('localExportMap', () => {
    it('maps an export to the Ref value of the resource it names', () => {
        const template = {
            Resources: { MediaBucket: { Type: 'AWS::S3::Bucket', Properties: { BucketName: 'media' } } },
            Outputs: {
                Out: { Value: { Ref: 'MediaBucket' }, Export: { Name: 'kitchensink-data-dev:MediaBucketName' } },
            },
        };

        expect(localExportMap([{ stack: 'S', template }], LOCALSTACK)).toStrictEqual({
            'kitchensink-data-dev:MediaBucketName': 'media',
        });
    });

    it('maps a queue export to a URL, not a name', () => {
        const template = {
            Resources: { Q: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'erasure' } } },
            Outputs: { Out: { Value: { Ref: 'Q' }, Export: { Name: 'kitchensink-data-dev:DeletionQueueUrl' } } },
        };

        expect(localExportMap([{ stack: 'S', template }], LOCALSTACK)['kitchensink-data-dev:DeletionQueueUrl']).toBe(
            'http://localhost:4566/000000000000/erasure',
        );
    });

    it('maps an Fn::GetAtt Arn export to the ARN', () => {
        const template = {
            Resources: { Q: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'erasure' } } },
            Outputs: {
                Out: {
                    Value: { 'Fn::GetAtt': ['Q', 'Arn'] },
                    Export: { Name: 'kitchensink-data-dev:DeletionQueueArn' },
                },
            },
        };

        expect(localExportMap([{ stack: 'S', template }], LOCALSTACK)['kitchensink-data-dev:DeletionQueueArn']).toBe(
            'arn:aws:sqs:us-east-1:000000000000:erasure',
        );
    });

    it('skips an export whose value references something not created locally', () => {
        const template = {
            Resources: { D: { Type: 'AWS::CloudFront::Distribution', Properties: {} } },
            Outputs: { Out: { Value: { Ref: 'D' }, Export: { Name: 'stack:Dist' } } },
        };

        expect(localExportMap([{ stack: 'S', template }], LOCALSTACK)).toStrictEqual({});
    });
});

describe('importRefsOf', () => {
    /**
     * The last link. `localExportMap` says what an export resolves to locally; this says which variable
     * wanted it. Without both, the resources exist in LocalStack and the services still read
     * `local-placeholder` — the same outcome as never creating them.
     */
    it('pairs an env var with the export it imports', () => {
        const template = {
            Resources: {
                Api: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [
                            {
                                Environment: [
                                    {
                                        Name: 'S3_BUCKET_PHOTOS',
                                        Value: { 'Fn::ImportValue': 'kitchensink-data-dev:MediaBucketName' },
                                    },
                                    { Name: 'PLAIN', Value: 'literal' },
                                ],
                            },
                        ],
                    },
                },
            },
        };

        expect(importRefsOf(template)).toStrictEqual([
            { name: 'S3_BUCKET_PHOTOS', exportName: 'kitchensink-data-dev:MediaBucketName' },
        ]);
    });

    it('reports nothing for an absent template rather than throwing', () => {
        expect(importRefsOf(undefined)).toStrictEqual([]);
    });
});

describe('resolveImport — one stack per logical stack, whatever stage it synthesised under', () => {
    /**
     * ⛔ THE STAGE TOKEN IN AN EXPORT NAME IS NOISE LOCALLY, and ignoring that fact silently defeated the
     * whole resource-creation step. Measured on this repo: the global Data stack synthesises as stage `dev`
     * and exports
     *
     *     kitchensink-data-dev:MediaBucketName
     *
     * while recipe-service and food-service synthesise with `baseStage=sandbox` and import
     *
     *     kitchensink-data-sandbox:MediaBucketName
     *
     * Both name the SAME bucket — there is only one Data stack in a local run — but an exact string match
     * finds nothing, so `S3_BUCKET_PHOTOS` stayed `local-placeholder` even though the bucket had just been
     * created. identity resolved and recipe did not, purely because identity happened to synthesise under
     * the same stage token.
     *
     * ⚠️ Exact match still WINS. Falling straight to the fuzzy match would make two genuinely different
     * exports collide the moment a stack legitimately has per-stage variants.
     */
    it('prefers an exact match', () => {
        const map = { 'kitchensink-data-dev:MediaBucketName': 'exact', 'kitchensink-data:MediaBucketName': 'fuzzy' };

        expect(resolveImport('kitchensink-data-dev:MediaBucketName', map)).toBe('exact');
    });

    it('matches across a differing stage token', () => {
        const map = { 'kitchensink-data-dev:MediaBucketName': 'the-bucket' };

        expect(resolveImport('kitchensink-data-sandbox:MediaBucketName', map)).toBe('the-bucket');
    });

    it('keeps a multi-segment stack name intact, stripping only the stage', () => {
        const map = { 'kitchensink-food-service-dev:FoodEventBusName': 'bus' };

        expect(resolveImport('kitchensink-food-service-sandbox:FoodEventBusName', map)).toBe('bus');
    });

    it('does not match a different export key', () => {
        const map = { 'kitchensink-data-dev:MediaBucketName': 'the-bucket' };

        expect(resolveImport('kitchensink-data-sandbox:ArchiveBucketName', map)).toBeUndefined();
    });

    it('does not match a different stack', () => {
        const map = { 'kitchensink-data-dev:MediaBucketName': 'the-bucket' };

        expect(resolveImport('kitchensink-other-dev:MediaBucketName', map)).toBeUndefined();
    });

    it('answers undefined for a name with no colon rather than throwing', () => {
        expect(resolveImport('nonsense', { 'a:b': 'c' })).toBeUndefined();
    });
});

describe('ownRefsOf — a resource in the SAME stack is not an import', () => {
    /**
     * ⚠️ `importRefsOf` covers `Fn::ImportValue`, which is how a container names another stack's resource.
     * But a stack that owns the resource references it directly — `{ "Ref": <logicalId> }` — and those never
     * pass through an export. Measured: `FOOD_EVENT_BUS_NAME` and `MESSAGE_TABLE_NAME` stayed
     * `local-placeholder` after the import path was fixed, for exactly this reason.
     *
     * ⛔ Not to be confused with a `Ref` to a template PARAMETER, which `ssmRefsOf` handles. The
     * discriminator is whether the logical id names a resource this run creates.
     */
    it('resolves a Ref to a resource the same template declares', () => {
        const template = {
            Resources: {
                Bus: { Type: 'AWS::Events::EventBus', Properties: { Name: 'kitchensink-food-dev' } },
                Api: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [
                            { Environment: [{ Name: 'FOOD_EVENT_BUS_NAME', Value: { Ref: 'Bus' } }] },
                        ],
                    },
                },
            },
        };

        expect(ownRefsOf('FoodService-dev', template, LOCALSTACK)).toStrictEqual({
            FOOD_EVENT_BUS_NAME: 'kitchensink-food-dev',
        });
    });

    it('gives a queue its URL, not its name', () => {
        const template = {
            Resources: {
                Q: { Type: 'AWS::SQS::Queue', Properties: { QueueName: 'erasure' } },
                Api: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [{ Environment: [{ Name: 'QUEUE_URL', Value: { Ref: 'Q' } }] }],
                    },
                },
            },
        };

        expect(ownRefsOf('S', template, LOCALSTACK)['QUEUE_URL']).toBe('http://localhost:4566/000000000000/erasure');
    });

    it('ignores a Ref to something this run does not create', () => {
        const template = {
            Resources: {
                P: { Type: 'AWS::SSM::Parameter', Properties: {} },
                Api: {
                    Type: 'AWS::ECS::TaskDefinition',
                    Properties: {
                        ContainerDefinitions: [{ Environment: [{ Name: 'X', Value: { Ref: 'NotDeclared' } }] }],
                    },
                },
            },
        };

        expect(ownRefsOf('S', template, LOCALSTACK)).toStrictEqual({});
    });
});

describe('resolveParameterValues — an SSM parameter whose value IS another resource', () => {
    /**
     * ⛔ `RecipeWorkers` publishes its queue URLs as SSM parameters, and the parameter's `Value` is a `Ref`
     * to the queue — not a string. Creating the parameter with a literal fallback wrote
     * `local-placeholder` into SSM, so the services read a placeholder from a parameter that existed, which
     * is worse than one that does not: it looks configured.
     */
    it('resolves a Ref value to the referenced resource local value', () => {
        const resources = [
            { stack: 'S', logicalId: 'Q', type: 'AWS::SQS::Queue', name: 'erasure', properties: {} },
            {
                stack: 'S',
                logicalId: 'P',
                type: 'AWS::SSM::Parameter',
                name: '/k/dev/queue-url',
                properties: { Value: { Ref: 'Q' } },
            },
        ];

        const out = resolveParameterValues(resources, LOCALSTACK);

        expect(out[1]?.properties['Value']).toBe('http://localhost:4566/000000000000/erasure');
    });

    it('leaves a literal value alone', () => {
        const resources = [
            { stack: 'S', logicalId: 'P', type: 'AWS::SSM::Parameter', name: '/k/x', properties: { Value: 'plain' } },
        ];

        expect(resolveParameterValues(resources, LOCALSTACK)[0]?.properties['Value']).toBe('plain');
    });

    it('leaves a non-parameter resource untouched', () => {
        const resources = [{ stack: 'S', logicalId: 'Q', type: 'AWS::SQS::Queue', name: 'q', properties: {} }];

        expect(resolveParameterValues(resources, LOCALSTACK)).toStrictEqual(resources);
    });
});
