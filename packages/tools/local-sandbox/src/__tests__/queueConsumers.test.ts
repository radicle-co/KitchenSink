/**
 * Which Lambdas a local sandbox runs as QUEUE CONSUMERS, read out of the synthesised CDK — and the environment each
 * one gets.
 *
 * ## Why this exists
 *
 * `local:up` creates every declared queue in LocalStack and deploys no Lambda, so a queue whose only consumer is a
 * Lambda fills and nothing drains it. The Maestro tier's `resetPool` asks the recipe service to purge a test
 * principal; the service writes a `queued` job and a message to the account-erasure queue, and the
 * `accountErasureWorker` Lambda is what completes it. Locally the job stayed `queued` for the full 300 s and the run
 * failed before a single flow — measured, on the first proof run of `local:maestro`.
 *
 * ## Why every consumer needs a stated decision
 *
 * Running every SQS-triggered Lambda would be wrong: `verifyLine` calls Bedrock, and the Lambda `parseLine` would race
 * the offline parse worker for one queue. Ignoring the ones nobody listed would be wrong too: a sixth consumer would
 * then be silently absent, which is the failure this whole package exists to prevent. So, like `LOCAL_SUPPORT`, the
 * table is total over what is deployed and an undecided consumer is refused.
 */
import { describe, expect, it } from 'vitest';

import {
    consumerEnvironment,
    discoverQueueConsumers,
    LOCAL_QUEUE_CONSUMERS,
    planQueueConsumers,
    type QueueConsumer,
    type QueueConsumerPlan,
} from '../queueConsumers.js';

const ASSET = '70e9c8178d6e7f5c700043830ddf4d570b8326c9a0501b69a5e2850614caacf1';

/** The shape `RecipeWorkers-dev` synthesises: a queue, a function on an asset, and the mapping between them. */
function workersTemplate(overrides: { readonly handler?: string; readonly mapping?: Record<string, unknown> } = {}) {
    return {
        Parameters: {
            DbNameParam: {
                Type: 'AWS::SSM::Parameter::Value<String>',
                Default: '/kitchensink/dev/recipe/database-name',
            },
            DsnParam: { Type: 'AWS::SSM::Parameter::Value<String>', Default: '/kitchensink/sandbox/sentry/dsn' },
        },
        Resources: {
            ErasureQueue: {
                Type: 'AWS::SQS::Queue',
                Properties: { QueueName: 'kitchensink-recipe-account-erasure-dev', VisibilityTimeout: 360 },
            },
            ErasureFunction: {
                Type: 'AWS::Lambda::Function',
                Properties: {
                    Handler: overrides.handler ?? 'handlers/accountErasureWorker.handler',
                    Code: { S3Bucket: 'cdk-assets', S3Key: `${ASSET}.zip` },
                    Timeout: 300,
                    Environment: {
                        Variables: {
                            RECIPE_DB_HOST: 'http://localhost:1',
                            RECIPE_DB_PORT: '1',
                            RECIPE_DB_NAME: { Ref: 'DbNameParam' },
                            RECIPE_DB_USER: 'recipe_app',
                            SENTRY_DSN: { Ref: 'DsnParam' },
                            SENTRY_TRACES_SAMPLE_RATE: '1.0',
                            RECIPE_MEDIA_BUCKET: 'local-placeholder',
                            RECIPE_ARCHIVE_BUCKET: 'local-placeholder',
                            CLOUDFRONT_DISTRIBUTION_ID: 'ELOCALDISTRIBUTION',
                            LOG_LEVEL: 'info',
                        },
                    },
                },
            },
            ErasureMapping: {
                Type: 'AWS::Lambda::EventSourceMapping',
                Properties: {
                    FunctionName: { Ref: 'ErasureFunction' },
                    EventSourceArn: { 'Fn::GetAtt': ['ErasureQueue', 'Arn'] },
                    BatchSize: 1,
                    ...overrides.mapping,
                },
            },
        },
    };
}

/** The one consumer the plan RUNS — the shape `consumerEnvironment` takes. */
function runnable(template: unknown): QueueConsumerPlan['run'][number] {
    const { run } = planQueueConsumers([onlyConsumer(template)]);

    expect(run).toHaveLength(1);

    return run[0] as QueueConsumerPlan['run'][number];
}

function onlyConsumer(template: unknown): QueueConsumer {
    const found = discoverQueueConsumers('RecipeWorkers-dev', template);

    expect(found).toHaveLength(1);

    return found[0] as QueueConsumer;
}

describe('discoverQueueConsumers', () => {
    it('reads the queue, the handler module and export, the asset and the batch shape off the mapping', () => {
        expect(onlyConsumer(workersTemplate())).toMatchObject({
            stack: 'RecipeWorkers-dev',
            handler: 'handlers/accountErasureWorker.handler',
            module: 'handlers/accountErasureWorker.js',
            exportName: 'handler',
            assetHash: ASSET,
            queueName: 'kitchensink-recipe-account-erasure-dev',
            batchSize: 1,
            reportsBatchItemFailures: false,
            timeoutSeconds: 300,
        });
    });

    it('says when the function reports partial batch failures, so a good message is not redelivered with a bad one', () => {
        const consumer = onlyConsumer(
            workersTemplate({ mapping: { BatchSize: 10, FunctionResponseTypes: ['ReportBatchItemFailures'] } }),
        );

        expect(consumer.batchSize).toBe(10);
        expect(consumer.reportsBatchItemFailures).toBe(true);
    });

    it('reports a queue it cannot name (another stack’s, through an export) rather than dropping the consumer', () => {
        const consumer = onlyConsumer(
            workersTemplate({
                mapping: { EventSourceArn: { 'Fn::ImportValue': 'kitchensink-data-dev:DeletionQueueArn' } },
            }),
        );

        expect(consumer.queueName).toBeUndefined();
    });

    it('ignores a mapping whose source is not an SQS queue', () => {
        const template = workersTemplate({
            mapping: { EventSourceArn: 'arn:aws:kinesis:us-east-1:000000000000:stream/x' },
        });

        expect(discoverQueueConsumers('RecipeWorkers-dev', template)).toEqual([]);
    });

    it('finds nothing in a template with no mapping', () => {
        expect(discoverQueueConsumers('X', { Resources: { Q: { Type: 'AWS::SQS::Queue' } } })).toEqual([]);
    });
});

describe('LOCAL_QUEUE_CONSUMERS + planQueueConsumers', () => {
    it('runs the account-erasure worker — the test-principal purge `resetPool` waits on', () => {
        const plan = planQueueConsumers([onlyConsumer(workersTemplate())]);

        expect(plan.run.map((consumer) => consumer.handler)).toEqual(['handlers/accountErasureWorker.handler']);
        expect(plan.undecided).toEqual([]);
    });

    it.each([
        ['handlers/parseLine.handler', /recipe-workers/u],
        ['handlers/verifyLine.handler', /Bedrock/u],
    ])('does NOT run %s, and says why', (handler, why) => {
        const plan = planQueueConsumers([onlyConsumer(workersTemplate({ handler }))]);

        expect(plan.run).toEqual([]);
        expect(plan.notRun).toHaveLength(1);
        expect(plan.notRun[0]?.why).toMatch(why);
    });

    it('refuses a consumer nobody decided — a new one must not be silently absent', () => {
        const plan = planQueueConsumers([onlyConsumer(workersTemplate({ handler: 'handlers/brandNew.handler' }))]);

        expect(plan.run).toEqual([]);
        expect(plan.undecided.map((consumer) => consumer.handler)).toEqual(['handlers/brandNew.handler']);
    });

    it('gives every decision a reason', () => {
        for (const [handler, decision] of Object.entries(LOCAL_QUEUE_CONSUMERS)) {
            expect(decision.why.trim(), handler).not.toBe('');
        }
    });
});

describe('consumerEnvironment', () => {
    const context = {
        ssmParameters: { '/kitchensink/dev/recipe/database-name': 'kitchensink_recipes_dev' },
        exports: {
            'kitchensink-data-dev:MediaBucketName': 'local-media-bucket',
            'kitchensink-data-dev:ArchiveBucketName': 'local-archive-bucket',
        },
        inventedValues: new Set(['http://localhost:1', '1', 'local-placeholder', 'ELOCALDISTRIBUTION', 'local']),
        database: { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres' },
    };

    const environment = (): Readonly<Record<string, string>> =>
        consumerEnvironment(runnable(workersTemplate()), context);

    it('connects to the local database as the local superuser, over a password and no TLS', () => {
        expect(environment()).toMatchObject({
            RECIPE_DB_HOST: 'localhost',
            RECIPE_DB_PORT: '5432',
            RECIPE_DB_USER: 'postgres',
            // `@kitchensink/rds-iam-auth`'s local mode: STAGE=local plus DB_PASSWORD, no IAM token, no TLS.
            STAGE: 'local',
            DB_PASSWORD: 'postgres',
        });
    });

    it('names the database the service names — through the SSM parameter the schema stack declares', () => {
        expect(environment()['RECIPE_DB_NAME']).toBe('kitchensink_recipes_dev');
    });

    it('binds the buckets the synth could only fill with placeholders to the local buckets', () => {
        expect(environment()).toMatchObject({
            RECIPE_MEDIA_BUCKET: 'local-media-bucket',
            RECIPE_ARCHIVE_BUCKET: 'local-archive-bucket',
        });
    });

    it('drops a value the synth INVENTED — a placeholder is not configuration', () => {
        // Kept, the fake distribution id makes the worker call CloudFront, which LocalStack Community does not
        // serve, and every purge fails; unset is the worker's documented no-op.
        expect(environment()).not.toHaveProperty('CLOUDFRONT_DISTRIBUTION_ID');
    });

    it('drops Sentry, so a local run reports nowhere', () => {
        expect(Object.keys(environment()).filter((key) => key.startsWith('SENTRY_'))).toEqual([]);
    });

    it('keeps a literal the template states', () => {
        expect(environment()['LOG_LEVEL']).toBe('info');
    });

    it('refuses when a binding cannot be resolved, rather than handing the worker a placeholder', () => {
        expect(() => consumerEnvironment(runnable(workersTemplate()), { ...context, exports: {} })).toThrow(
            /RECIPE_MEDIA_BUCKET/u,
        );
    });

    it('refuses when the database name cannot be resolved, rather than guessing one', () => {
        expect(() => consumerEnvironment(runnable(workersTemplate()), { ...context, ssmParameters: {} })).toThrow(
            /RECIPE_DB_NAME/u,
        );
    });
});
