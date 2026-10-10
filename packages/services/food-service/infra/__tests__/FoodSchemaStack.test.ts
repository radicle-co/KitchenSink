/**
 * The food database's schema stack: its two pipeline-only functions, and nothing that reads the schema (ADR-0035,
 * ADR-0051; curated catalog plan U3, KTD-1, KTD-18).
 *
 * `kitchensink-food-schema-{stage}` is deployed first, then the pipeline invokes the migration runner and then the
 * catalog seed function, and only then deploys anything that reads the catalog. Both functions run only when the
 * pipeline invokes them, which is what lets the seed function live here at all: nothing in this stack may run by
 * itself, because anything that did would run against the schema the migrate step has not yet moved.
 *
 * Each function ships its own asset or a THROWING placeholder, so these cases are written as disjunctions over the
 * bundle's presence: CI runs this tier before `bundle:lambda`, and a developer's machine usually has built.
 *
 * Moved here from `FoodServiceStack.test.ts`, where the schema stack's cases were written for one function. Rewritten
 * for two rather than relaxed: "exactly one Lambda" became "exactly these two, each pipeline-only", the placeholder case
 * became per function, and the drain count went from one filter to one per log group.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { App, type AppProps } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, it } from 'vitest';

import { NODE_LAMBDA_RUNTIME } from '@radicle-co/infra-shared/security';

import { FoodSchemaStack } from '../lib/FoodSchemaStack.js';
import { FoodServiceStack } from '../lib/FoodServiceStack.js';

/** Cloud-assembly directories this file synthesized into, removed in `afterAll`. */
const synthOutputs: string[] = [];

afterAll(() => {
    for (const directory of synthOutputs) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/**
 * A CDK `App` whose synth output lands somewhere this file will remove.
 *
 * @param props - Everything else the App needs; `outdir` is supplied here.
 * @returns The App.
 * @sideEffect Creates a directory under the OS temp directory and registers it for removal.
 */
function testApp(props: AppProps = {}): App {
    const outdir = mkdtempSync(join(tmpdir(), 'cdk-synth-'));

    synthOutputs.push(outdir);

    return new App({ ...props, outdir });
}

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

/** The runner's entry, derived as the stack derives it: the asset's when `dist-lambda/` exists, else the placeholder's. */
const MIGRATION_HANDLER = existsSync(join(PACKAGE_ROOT, 'dist-lambda'))
    ? 'lambdas/migrate/handler.handler'
    : 'index.handler';

/** The seed function's entry, derived the same way from `distSeed/`. */
const SEED_HANDLER = existsSync(join(PACKAGE_ROOT, 'distSeed')) ? 'lambdas/seed/handler.handler' : 'index.handler';

/** The VPC-lookup context every synth here shares, so `Vpc.fromLookup` never calls AWS. */
const VPC_LOOKUP_CONTEXT = {
    'vpc-provider:account=123456789012:filter.vpc-id=vpc-12345678:region=us-east-1:returnAsymmetricSubnets=true': {
        vpcId: 'vpc-12345678',
        vpcCidrBlock: '10.0.0.0/16',
        ownerAccountId: '123456789012',
        availabilityZones: [],
        subnetGroups: [
            {
                name: 'Public',
                type: 'Public',
                subnets: [
                    {
                        subnetId: 'subnet-public-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-public-1',
                        cidr: '10.0.0.0/24',
                    },
                ],
            },
            {
                name: 'Private',
                type: 'Private',
                subnets: [
                    {
                        subnetId: 'subnet-private-1',
                        availabilityZone: 'us-east-1a',
                        routeTableId: 'rtb-private-1',
                        cidr: '10.0.1.0/24',
                    },
                ],
            },
        ],
    },
};

const ENV = { account: '123456789012', region: 'us-east-1' };
const ARN = 'arn:aws:lambda:us-east-1:123456789012:function:kitchensink-log-forwarder-sandbox';

/**
 * Synthesize the schema stack.
 *
 * @param stage - The deploy stage.
 * @param baseStage - The platform stage it imports from.
 * @param logForwarderArn - The forwarder, when CI resolved one.
 * @returns The template.
 */
function synthSchema(stage: string, baseStage: string, logForwarderArn?: string): Template {
    const app = testApp({ context: { ...VPC_LOOKUP_CONTEXT } });

    return Template.fromStack(
        new FoodSchemaStack(app, `FoodSchema-${stage}`, {
            env: ENV,
            stage,
            baseStage,
            vpcId: 'vpc-12345678',
            ...(logForwarderArn === undefined ? {} : { logForwarderArn }),
        }),
    );
}

/** One synthesized `AWS::Lambda::Function`, narrowed to what these cases read. */
interface LambdaResource {
    readonly Properties: {
        readonly Handler?: string;
        readonly Timeout?: number;
        readonly MemorySize?: number;
        readonly ReservedConcurrentExecutions?: number;
        readonly Code?: { readonly ZipFile?: string; readonly S3Bucket?: unknown };
        readonly Role?: { readonly 'Fn::GetAtt'?: readonly string[] };
        readonly Environment?: { readonly Variables?: Readonly<Record<string, unknown>> };
        readonly VpcConfig?: unknown;
    };
    readonly Metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The template's functions, keyed by the output that publishes each one.
 *
 * @param template - A schema stack template.
 * @returns The runner and the seed function, as the pipeline resolves them.
 */
function pipelineFunctions(template: Template): {
    readonly runner: LambdaResource | undefined;
    readonly seed: LambdaResource | undefined;
    readonly runnerId: string | undefined;
    readonly seedId: string | undefined;
} {
    const outputs = template.findOutputs('*') as Record<string, { Value?: { Ref?: string } }>;
    const functions = template.findResources('AWS::Lambda::Function') as Record<string, LambdaResource>;
    const runnerId = outputs['FoodMigrationFunctionName']?.Value?.Ref;
    const seedId = outputs['FoodSeedFunctionName']?.Value?.Ref;

    return {
        runner: runnerId === undefined ? undefined : functions[runnerId],
        seed: seedId === undefined ? undefined : functions[seedId],
        runnerId,
        seedId,
    };
}

/**
 * The db-users a function's execution role may `rds-db:connect` as.
 *
 * @param template - The template.
 * @param fn - The function.
 * @returns The db-user names, from the end of each resource ARN.
 */
function connectableUsers(template: Template, fn: LambdaResource | undefined): readonly string[] {
    const roleId = fn?.Properties.Role?.['Fn::GetAtt']?.[0];
    const policies = Object.values(template.findResources('AWS::IAM::Policy')) as {
        Properties: {
            Roles?: readonly { Ref?: string }[];
            PolicyDocument: { Statement: readonly { Action?: unknown; Resource?: unknown }[] };
        };
    }[];

    return (
        policies
            .filter((policy) => (policy.Properties.Roles ?? []).some((role) => role.Ref === roleId))
            .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
            .filter((statement) => JSON.stringify(statement.Action ?? '').includes('rds-db:connect'))
            .map((statement) => JSON.stringify(statement.Resource))
            .filter((resource) => resource.includes(':dbuser:'))
            // The ARN is an `Fn::Join` whose last part is `/<db-user>`.
            .flatMap((resource) => [...resource.matchAll(/"\/([a-z_]+)"/gu)].map((match) => match[1] ?? ''))
            .sort()
    );
}

describe('the food schema stack — two pipeline-only functions and nothing that reads the schema', () => {
    const template = synthSchema('test', 'test');
    const { runner, seed, runnerId, seedId } = pipelineFunctions(template);

    it('ships exactly two Lambdas — the runner and the seed function — each published by an output', () => {
        expect(runnerId, 'the runner must be published as FoodMigrationFunctionName').toBeDefined();
        expect(seedId, 'the seed function must be published as FoodSeedFunctionName').toBeDefined();
        expect(Object.keys(template.findResources('AWS::Lambda::Function')).sort()).toStrictEqual(
            [runnerId, seedId].sort(),
        );
    });

    it('publishes both names as outputs, never exports, so nothing can import them and block a teardown', () => {
        const outputs = template.findOutputs('*') as Record<string, { Export?: unknown }>;

        expect(Object.keys(outputs).sort()).toStrictEqual(['FoodMigrationFunctionName', 'FoodSeedFunctionName']);
        expect(outputs['FoodMigrationFunctionName']?.Export).toBeUndefined();
        expect(outputs['FoodSeedFunctionName']?.Export).toBeUndefined();
    });

    it('⛔ holds NOTHING that reads the schema, and nothing that can invoke a function but the pipeline', () => {
        // Anything here is updated by the same deploy that ships the runner, BEFORE the migration it depends on;
        // both functions are safe here only because nothing but the pipeline can run them.
        for (const type of [
            'AWS::ECS::Service',
            'AWS::ECS::TaskDefinition',
            'AWS::Lambda::EventSourceMapping',
            'AWS::Events::Rule',
            'AWS::Scheduler::Schedule',
            'AWS::Lambda::Url',
            'AWS::Lambda::Permission',
            'Custom::Trigger',
        ]) {
            expect(Object.keys(template.findResources(type)), type).toStrictEqual([]);
        }
    });

    it('creates the runner in a PRIVATE subnet with the food DB env contract', () => {
        expect(runner?.Properties).toMatchObject({
            Handler: MIGRATION_HANDLER,
            Timeout: 300,
            MemorySize: 512,
        });
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: MIGRATION_HANDLER,
            Runtime: NODE_LAMBDA_RUNTIME.name,
            Architectures: ['arm64'],
            VpcConfig: Match.objectLike({ SubnetIds: Match.arrayWith(['subnet-private-1']) }),
        });
    });

    it('creates the seed function with KTD-1’s budget: 900 s and 2048 MB, on the runner’s runtime and network', () => {
        expect(seed?.Properties).toMatchObject({ Handler: SEED_HANDLER, Timeout: 900, MemorySize: 2048 });
        template.hasResourceProperties('AWS::Lambda::Function', {
            Handler: SEED_HANDLER,
            Runtime: NODE_LAMBDA_RUNTIME.name,
            Architectures: ['arm64'],
        });
        expect(seed?.Properties.VpcConfig).toStrictEqual(runner?.Properties.VpcConfig);
    });

    it('gives the seed function no reserved concurrency: describe must answer while an apply runs', () => {
        expect(seed?.Properties.ReservedConcurrentExecutions).toBeUndefined();
    });

    it('⛔ hands both functions exactly the same database: the same four variables, the same values', () => {
        const runnerEnv = runner?.Properties.Environment?.Variables;

        expect(Object.keys(runnerEnv ?? {}).sort()).toStrictEqual([
            'FOOD_DB_ENDPOINT',
            'FOOD_DB_NAME',
            'FOOD_DB_PORT',
            'STAGE',
        ]);
        expect(seed?.Properties.Environment?.Variables).toStrictEqual(runnerEnv);
    });

    it('⛔ grants each function rds-db:connect as its own login and no other', () => {
        expect(connectableUsers(template, runner)).toStrictEqual(['food_migrator']);
        expect(connectableUsers(template, seed)).toStrictEqual(['food_seeder']);
        expect(JSON.stringify(template.toJSON())).not.toContain('/food_app');
    });

    it('gives the two functions separate execution roles', () => {
        expect(runner?.Properties.Role?.['Fn::GetAtt']?.[0]).toBeDefined();
        expect(seed?.Properties.Role?.['Fn::GetAtt']?.[0]).toBeDefined();
        expect(seed?.Properties.Role?.['Fn::GetAtt']?.[0]).not.toBe(runner?.Properties.Role?.['Fn::GetAtt']?.[0]);
    });

    it.each<[string, () => LambdaResource | undefined]>([
        ['the runner', () => runner],
        ['the seed function', () => seed],
    ])('⛔ %s ships an asset or a THROWING placeholder — never one that resolves', (_name, pick) => {
        // A placeholder that RESOLVES is a successful invocation: the step goes green having done nothing.
        const code = pick()?.Properties.Code;

        expect(code, 'the function must ship some code').toBeDefined();

        if (code?.ZipFile === undefined) {
            expect(code?.S3Bucket, 'a bundled function ships an S3 asset').toBeDefined();
        } else {
            expect(code.ZipFile, 'an unbuilt bundle must synthesize a THROWING placeholder').toContain(
                'throw new Error',
            );
        }
    });

    it('gives the seed function its own log group, kept one month and removed with the stack', () => {
        const groups = template.findResources('AWS::Logs::LogGroup') as Record<
            string,
            { Properties: { RetentionInDays?: number }; DeletionPolicy?: string }
        >;

        expect(Object.keys(groups).sort()).toStrictEqual(
            ['FoodMigrationLogGroup', 'FoodSeedLogGroup'].map((id) => expect.stringMatching(new RegExp(`^${id}`, 'u'))),
        );
        expect(
            Object.values(groups).map((group) => [group.Properties.RetentionInDays, group.DeletionPolicy]),
        ).toStrictEqual([
            [30, 'Delete'],
            [30, 'Delete'],
        ]);
    });
});

describe('the schema stack targets the database the service stack reads', () => {
    it('⛔ hands both functions the per-PR database the service containers use', () => {
        // The two templates are separate stacks: exactly the seam where the name could drift.
        const service = Template.fromStack(
            new FoodServiceStack(testApp({ context: { ...VPC_LOOKUP_CONTEXT } }), 'Food-pr-7', {
                env: ENV,
                stage: 'pr-7',
                baseStage: 'sandbox',
                domainName: 'example.com',
                imageTag: 'test',
                desiredCount: 1,
                workerDesiredCount: 1,
                vpcId: 'vpc-12345678',
                alarmsEnabled: false,
            }),
        );
        const serviceNames = JSON.stringify(service.toJSON()).match(/kitchensink_food_pr_7/gu) ?? [];
        const { runner, seed } = pipelineFunctions(synthSchema('pr-7', 'sandbox'));

        expect(serviceNames.length).toBeGreaterThan(0);
        expect(runner?.Properties.Environment?.Variables?.['FOOD_DB_NAME']).toBe('kitchensink_food_pr_7');
        expect(seed?.Properties.Environment?.Variables?.['FOOD_DB_NAME']).toBe('kitchensink_food_pr_7');
    });
});

/**
 * ⛔ THE LOG DRAINS ARE CONDITIONAL, AND BOTH POSTURES ARE THE ASSERTION (ADR-0042). The forwarder's ARN is a CI-resolved
 * input, never an import (an import deadlocked this stack against the app that publishes it), and its absence is a
 * supported state in which no filter is attached.
 */
describe('the schema stack drains each log group only when CI resolved a forwarder ARN', () => {
    it.each([
        ['known', 2, ARN],
        ['absent', 0, undefined],
    ])('⛔ a %s ARN yields %i subscription filter(s)', (_posture, expected, arn) => {
        const template = synthSchema('sandbox', 'sandbox', arn);

        template.resourceCountIs('AWS::Logs::SubscriptionFilter', expected);
    });

    it('attaches one filter to each log group, not two to one', () => {
        const filters = Object.values(
            synthSchema('sandbox', 'sandbox', ARN).findResources('AWS::Logs::SubscriptionFilter'),
        ) as {
            Properties: { LogGroupName?: { Ref?: string } };
        }[];

        expect(filters.map((filter) => filter.Properties.LogGroupName?.Ref ?? '').sort()).toStrictEqual([
            expect.stringMatching(/^FoodMigrationLogGroup/u),
            expect.stringMatching(/^FoodSeedLogGroup/u),
        ]);
    });
});
