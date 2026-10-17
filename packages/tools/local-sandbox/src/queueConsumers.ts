/**
 * @module queueConsumers — which SQS-triggered Lambdas a local sandbox runs, and the environment each one gets.
 *
 * `local:up` creates every queue the CDK declares and deploys no Lambda, so a queue whose consumer is a Lambda
 * fills and nothing drains it. This module reads the consumers out of the synthesised templates (each
 * `AWS::Lambda::EventSourceMapping` on an SQS queue), decides for each one whether a local run should drive it, and
 * builds the environment it runs with. `bin/queueConsumer.ts` then drives the deployed bundle against LocalStack.
 *
 * @pattern Specification — `LOCAL_QUEUE_CONSUMERS` is a total, reasoned table over the deployed consumers, the
 *   same shape as `LOCAL_SUPPORT`; an undecided consumer is refused, never skipped
 */

import { resolveImport } from './awsResources.js';
import type { SsmParameterMap } from './runPlan.js';

/** One SQS-triggered Lambda, as the template declares it. */
export interface QueueConsumer {
    readonly stack: string;
    /** The function's `Handler` string, e.g. `handlers/accountErasureWorker.handler`. The decision table's key. */
    readonly handler: string;
    /** The module the handler names, relative to the bundle root. */
    readonly module: string;
    /** The export the handler names. */
    readonly exportName: string;
    /** The asset the code is synthesised under (`asset.<hash>/`), or `undefined` when the code is not an asset. */
    readonly assetHash: string | undefined;
    /** The queue's `QueueName`, or `undefined` when the source is a queue another stack declares. */
    readonly queueName: string | undefined;
    readonly batchSize: number;
    /** `FunctionResponseTypes: ['ReportBatchItemFailures']` — the handler returns which records failed. */
    readonly reportsBatchItemFailures: boolean;
    readonly timeoutSeconds: number;
    /** The function's `Environment.Variables`, as synthesised. */
    readonly variables: Readonly<Record<string, unknown>>;
    /** The template's `Parameters`, which a variable's `{ Ref }` resolves against. */
    readonly parameters: Readonly<Record<string, unknown>>;
}

/** Where a variable the synth could only fill with a placeholder gets its local value. */
export interface ExportBinding {
    /** A CloudFormation export another stack publishes; resolved stage-agnostically by `resolveImport`. */
    readonly export: string;
}

/** Whether a local run drives a consumer. */
export type ConsumerDecision =
    | { readonly kind: 'run'; readonly why: string; readonly bindings: Readonly<Record<string, ExportBinding>> }
    | { readonly kind: 'not-run'; readonly why: string };

/**
 * ⛔ TOTAL over the consumers the CDK deploys, and every entry carries its reason. Keyed by `Handler`, the one name
 * that is the same in every stage.
 */
export const LOCAL_QUEUE_CONSUMERS: Readonly<Record<string, ConsumerDecision>> = Object.freeze({
    'handlers/accountErasureWorker.handler': {
        kind: 'run',
        why:
            'completes GDPR erasure and the test-principal purge (ADR-0040) the e2e tiers reset through — without ' +
            'it every purge job stays `queued`',
        // `RecipeWorkersStack` takes these names from the deploy pipeline's environment, so the synth carries only
        // placeholders; the buckets are the global data stack's.
        bindings: {
            RECIPE_MEDIA_BUCKET: { export: 'kitchensink-data-dev:MediaBucketName' },
            RECIPE_ARCHIVE_BUCKET: { export: 'kitchensink-data-dev:ArchiveBucketName' },
        },
    },
    'handlers/parseLine.handler': {
        kind: 'not-run',
        why:
            'the parse queue is drained by `recipe-workers` `dev` (its offline CRF and LLM substitute); the Lambda ' +
            'calls the deployed CRF function and Bedrock, and two consumers would race for one queue',
    },
    'handlers/verifyLine.handler': {
        kind: 'not-run',
        why: 'verification is Bedrock inference (ADR-0024), which a local run never calls',
    },
    'handlers/handleSyncWorker.handler': {
        kind: 'not-run',
        why: 'fed by an SNS subscription to identity’s handle topic, and `awsResources.ts` creates no subscription, so nothing arrives',
    },
    'handlers/versionArchiveWorker.handler': {
        kind: 'not-run',
        why: 'fed only by the scheduled archive sweeper, which nothing runs locally',
    },
    'handlers/deletionWorker.handler': {
        kind: 'not-run',
        why: 'identity’s deletion queue URL is a placeholder locally, so identity sends it nothing',
    },
});

/** A plain-string `Handler` of the form `<module path>.<export>`. */
const HANDLER = /^(.+)\.([A-Za-z_$][\w$]*)$/u;

/**
 * Every SQS-triggered Lambda one template declares.
 *
 * @param stack - The stack name.
 * @param template - The synthesised template.
 * @returns One entry per event-source mapping whose source is an SQS queue and whose function is in the same
 *   template. Pure.
 */
export function discoverQueueConsumers(stack: string, template: unknown): readonly QueueConsumer[] {
    const { Resources: resources = {}, Parameters: parameters = {} } = (template ?? {}) as {
        Resources?: Record<string, { Type?: unknown; Properties?: Record<string, unknown> }>;
        Parameters?: Record<string, unknown>;
    };

    return Object.values(resources).flatMap((mapping) => {
        if (mapping.Type !== 'AWS::Lambda::EventSourceMapping') {
            return [];
        }

        const properties = mapping.Properties ?? {};
        const source = properties['EventSourceArn'];
        const queueId = (source as { 'Fn::GetAtt'?: unknown } | undefined)?.['Fn::GetAtt'];
        const queue =
            Array.isArray(queueId) && typeof queueId[0] === 'string' && Object.hasOwn(resources, queueId[0])
                ? resources[queueId[0]]
                : undefined;
        const imported = (source as { 'Fn::ImportValue'?: unknown } | undefined)?.['Fn::ImportValue'];
        const isQueue = queue?.Type === 'AWS::SQS::Queue' || (typeof imported === 'string' && /Queue/u.test(imported));

        const functionId = (properties['FunctionName'] as { Ref?: unknown } | undefined)?.Ref;
        const fn =
            typeof functionId === 'string' && Object.hasOwn(resources, functionId) ? resources[functionId] : undefined;
        const fnProperties = fn?.Properties ?? {};
        const handler = fnProperties['Handler'];
        const matched = typeof handler === 'string' ? HANDLER.exec(handler) : null;

        if (!isQueue || fn?.Type !== 'AWS::Lambda::Function' || matched === null || typeof handler !== 'string') {
            return [];
        }

        const key = (fnProperties['Code'] as { S3Key?: unknown } | undefined)?.S3Key;
        const queueName = queue?.Properties?.['QueueName'];
        const responseTypes = properties['FunctionResponseTypes'];
        const variables = (fnProperties['Environment'] as { Variables?: Record<string, unknown> } | undefined)
            ?.Variables;

        return [
            {
                stack,
                handler,
                module: `${matched[1] as string}.js`,
                exportName: matched[2] as string,
                assetHash: typeof key === 'string' ? key.replace(/\.zip$/u, '') : undefined,
                queueName: typeof queueName === 'string' ? queueName : undefined,
                batchSize: typeof properties['BatchSize'] === 'number' ? properties['BatchSize'] : 10,
                reportsBatchItemFailures:
                    Array.isArray(responseTypes) && responseTypes.includes('ReportBatchItemFailures'),
                timeoutSeconds: typeof fnProperties['Timeout'] === 'number' ? fnProperties['Timeout'] : 3,
                variables: variables ?? {},
                parameters,
            },
        ];
    });
}

/** What a local run does with each discovered consumer. */
export interface QueueConsumerPlan {
    readonly run: readonly (QueueConsumer & { readonly decision: Extract<ConsumerDecision, { kind: 'run' }> })[];
    readonly notRun: readonly { readonly consumer: QueueConsumer; readonly why: string }[];
    readonly undecided: readonly QueueConsumer[];
}

/**
 * Partition the consumers by their decision.
 *
 * @param consumers - Every discovered consumer.
 * @returns The partition; a non-empty `undecided` must refuse the run. Pure.
 */
export function planQueueConsumers(consumers: readonly QueueConsumer[]): QueueConsumerPlan {
    const run: QueueConsumerPlan['run'][number][] = [];
    const notRun: QueueConsumerPlan['notRun'][number][] = [];
    const undecided: QueueConsumer[] = [];

    for (const consumer of consumers) {
        const decision = Object.hasOwn(LOCAL_QUEUE_CONSUMERS, consumer.handler)
            ? LOCAL_QUEUE_CONSUMERS[consumer.handler]
            : undefined;

        if (decision === undefined) {
            undecided.push(consumer);
        } else if (decision.kind === 'run') {
            run.push({ ...consumer, decision });
        } else {
            notRun.push({ consumer, why: decision.why });
        }
    }

    return { run, notRun, undecided };
}

/** What a consumer's environment is resolved against. */
export interface ConsumerEnvContext {
    readonly ssmParameters: SsmParameterMap;
    /** Export name → local value, from `localExportMap`. */
    readonly exports: Readonly<Record<string, string>>;
    /** Every value the local synth INVENTED as a placeholder (`synthEnvFor`). */
    readonly inventedValues: ReadonlySet<string>;
    /** The local database, as the HOST reaches it. */
    readonly database: {
        readonly host: string;
        readonly port: number;
        readonly user: string;
        readonly password: string;
    };
}

const DB_HOST = /(^|_)DB_HOST$/u;
const DB_PORT = /(^|_)DB_PORT$/u;
const DB_USER = /(^|_)DB_USER(NAME)?$/u;
const DB_NAME = /(^|_)(DB_NAME|DATABASE_NAME)$/u;

/**
 * The environment one consumer runs with locally.
 *
 * Rules, in order: the database keys point at the local Postgres (with `@kitchensink/rds-iam-auth`'s local mode,
 * `STAGE=local` + `DB_PASSWORD`, because the deployed form is RDS IAM over TLS); the decision's bindings; then the
 * template's own values, minus Sentry and minus anything the synth invented.
 *
 * @param consumer - A consumer the plan runs.
 * @param context - What variables resolve against.
 * @returns Name → value. Pure.
 * @throws {Error} when a binding or the database name cannot be resolved — a worker handed a placeholder boots and
 *   fails at its first real call.
 */
export function consumerEnvironment(
    consumer: QueueConsumer & { readonly decision: Extract<ConsumerDecision, { kind: 'run' }> },
    context: ConsumerEnvContext,
): Readonly<Record<string, string>> {
    const env: Record<string, string> = Object.create(null) as Record<string, string>;

    const resolve = (value: unknown): string | undefined => {
        if (typeof value === 'string') {
            return context.inventedValues.has(value) ? undefined : value;
        }

        const imported = (value as { 'Fn::ImportValue'?: unknown } | null)?.['Fn::ImportValue'];

        if (typeof imported === 'string') {
            return resolveImport(imported, context.exports);
        }

        const ref = (value as { Ref?: unknown } | null)?.Ref;
        const parameter =
            typeof ref === 'string' && Object.hasOwn(consumer.parameters, ref) ? consumer.parameters[ref] : undefined;
        const path = (parameter as { Default?: unknown } | undefined)?.Default;

        return typeof path === 'string' && Object.hasOwn(context.ssmParameters, path)
            ? context.ssmParameters[path]
            : undefined;
    };

    let usesDatabase = false;

    for (const [key, raw] of Object.entries(consumer.variables)) {
        if (/^SENTRY_|_DSN$/u.test(key) || Object.hasOwn(consumer.decision.bindings, key)) {
            continue;
        }

        if (DB_HOST.test(key)) {
            env[key] = context.database.host;
            usesDatabase = true;
        } else if (DB_PORT.test(key)) {
            env[key] = String(context.database.port);
        } else if (DB_USER.test(key)) {
            env[key] = context.database.user;
        } else if (DB_NAME.test(key)) {
            const name = resolve(raw);

            if (name === undefined) {
                throw new Error(`${consumer.handler}: ${key} names no database a local run can resolve`);
            }

            env[key] = name;
        } else {
            const value = resolve(raw);

            if (value !== undefined) {
                env[key] = value;
            }
        }
    }

    for (const [key, binding] of Object.entries(consumer.decision.bindings)) {
        const value = resolveImport(binding.export, context.exports);

        if (value === undefined) {
            throw new Error(
                `${consumer.handler}: ${key} is bound to the export ${binding.export}, which nothing publishes`,
            );
        }

        env[key] = value;
    }

    if (usesDatabase) {
        env['STAGE'] = 'local';
        env['DB_PASSWORD'] = context.database.password;
    }

    return { ...env };
}

/** One consumer as `local:up` persists it for `bin/queueConsumer.ts` — everything the driver needs, resolved. */
export interface PersistedConsumer {
    /** The handler module's base name, e.g. `accountErasureWorker` — what the runner names it by. */
    readonly name: string;
    readonly handler: string;
    /** Absolute path of the copied asset. */
    readonly bundleDir: string;
    readonly module: string;
    readonly exportName: string;
    /** The queue's HOST url (`http://localhost:4566/...`). */
    readonly queueUrl: string;
    readonly batchSize: number;
    readonly reportsBatchItemFailures: boolean;
    readonly timeoutSeconds: number;
    readonly environment: Readonly<Record<string, string>>;
}
