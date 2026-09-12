import {
    CfnOutput,
    Duration,
    Fn,
    Stack,
    Token,
    type StackProps,
    aws_ec2 as ec2,
    aws_lambda as lambda,
    aws_rds as rds,
    aws_logs as logs,
    aws_logs_destinations as logsDestinations,
    RemovalPolicy,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { NODE_LAMBDA_RUNTIME } from '@radicle-co/infra-shared/security';
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { foodDatabaseNameForStage } from './FoodServiceStack.js';

export interface FoodSchemaStackProps extends StackProps {
    /**
     * The log forwarder's ARN, resolved in CI. Absent means no subscription filter is attached —
     * see the drain comment below for the deadlock that makes absence a supported state (ADR-0042).
     */
    readonly logForwarderArn?: string;

    /** Deploy stage (`prod`, `sandbox`, `pr-{N}`, …). */
    readonly stage: string;
    /** The persistent platform stage this deploy imports from (ADR-0006). Defaults to `stage`. */
    readonly baseStage?: string;
    /** Shared VPC id to import. */
    readonly vpcId: string;
}

/** What differs between the schema stack's two pipeline-only functions. */
interface PipelineFunctionOptions {
    /** The construct-id prefix of the log group's drain: `${name}LogDrain`. */
    readonly name: string;
    /**
     * The function's log group, declared at the call site with its literal id `${name}LogGroup` and
     * {@link PIPELINE_LOG_GROUP_PROPS}, so the log-drain register's guard can read it (ADR-0042).
     */
    readonly logGroup: logs.LogGroup;
    /** The asset directory under the package root, which `npm run bundle:lambda` builds. */
    readonly assetDir: string;
    /** The bundle's entry, under `outbase: src`. */
    readonly handler: string;
    readonly timeout: Duration;
    readonly memorySize: number;
}

/** Every pipeline function's log group: the repo's retention, deleted with the stack. */
const PIPELINE_LOG_GROUP_PROPS: logs.LogGroupProps = {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY,
};

/** What the two functions share, apart from the VPC each call site names. */
interface SharedPipelineProps {
    readonly serviceSecurityGroup: ec2.ISecurityGroup;
    /** The log forwarder, when CI resolved its ARN. */
    readonly forwarder: lambda.IFunction | undefined;
    /** The database both connect to, from one `foodDatabaseName`: the same four variables for both. */
    readonly environment: Readonly<Record<string, string>>;
}

/**
 * The food database's SCHEMA — the two pipeline-only functions that move it, and nothing that runs by itself.
 *
 * ## Why the runner lives alone
 *
 * ADR-0022 put the schema apply INSIDE the service deploy, as an `aws-cdk-lib/triggers` Trigger every
 * consumer in the stack was ordered behind. It was the right answer to the wrong constraint: the runner had
 * to share a stack with the ECS services because CloudFormation's `DependsOn` cannot leave a stack, and
 * because the runner's SQL ships with its bundle, so invoking it before the deploy runs the PREVIOUS
 * release's migration set.
 *
 * Both halves are now addressed without coupling the two. The runner is deployed by its own pipeline step,
 * ahead of every consumer, so ordering comes from position rather than from a construct graph that cannot
 * cross a stack boundary. And the "previous release's bundle" hazard — undetectable before, because such a
 * runner answers `applied: []` exactly like one with nothing to do — is closed by the manifest expectation
 * the pipeline sends with the invoke.
 *
 * ## ⛔ The invariant: nothing here may run by itself
 *
 * This stack is deployed BEFORE the migration, so anything in it that runs on its own (a service, a scheduled or
 * event-driven function, a function URL, an invoke grant) would run against the schema the migrate step has not yet
 * moved. That is what makes "deploy this, then migrate, then seed, then deploy everything else" a barrier rather than
 * a convention.
 *
 * Two functions live here, and both are PIPELINE-ONLY: no event source, no schedule, no URL, no permission for anyone
 * to invoke them. Each runs only when the pipeline calls it, in order (ADR-0051):
 *
 * - the migration runner, invoked by `runMigrations.sh` with the manifest it must hold;
 * - the catalog seed function, invoked by `runSeed.sh` after the migrate step, as `food_seeder`, with the digest of the
 *   asset it must hold (curated catalog plan U3). It reads and writes the catalog, which is safe here only because it
 *   cannot run before the migration does.
 *
 * `packages/infra/global/__tests__/dbTouchingStackBarrier.test.ts` holds every schema stack to that: each function is
 * the runner or a registered pipeline-only handler, and nothing can invoke one but the pipeline.
 *
 * ⚠️ On a first-ever `pr-{N}` deploy the runner CREATES the per-PR logical database, from `template0` (ADR-0006,
 * curated catalog plan U7), so it is also the step that must precede every other food resource for that stage — not
 * merely the ones that read a table.
 */
export class FoodSchemaStack extends Stack {
    /** The migration runner's function name, for the pipeline's migrate step. */
    public readonly migrationFunctionName: string;
    /** The catalog seed function's name, for the pipeline's seed step. */
    public readonly seedFunctionName: string;

    public constructor(scope: Construct, id: string, props: FoodSchemaStackProps) {
        super(scope, id, props);

        const { stage, vpcId } = props;
        const baseStage = props.baseStage ?? stage;

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { vpcId });

        const serviceSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedServiceSg',
            Fn.importValue(`kitchensink-network-${baseStage}:ServiceSecurityGroupId`),
        );

        // NO RDS is created here — the instance is owned by the global DataStack. `food_app` connects via
        // RDS IAM, so there is no secret to read; the grant below is what mints its token.
        const database = rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedDatabase', {
            instanceIdentifier: `kitchensink-data-${baseStage}`,
            instanceResourceId: Fn.importValue(`kitchensink-data-${baseStage}:DatabaseResourceId`),
            instanceEndpointAddress: Fn.importValue(`kitchensink-data-${baseStage}:DatabaseEndpoint`),
            port: Token.asNumber(Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`)),
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(
                    this,
                    'ImportedDbSg',
                    Fn.importValue(`kitchensink-network-${baseStage}:DatabaseSecurityGroupId`),
                ),
            ],
        });

        // Per-PR logical database isolation (ADR-0006). Resolved through the SAME function the service
        // stack uses, never re-spelled: a runner that migrated one database while the services read another
        // is #119's failure mode through a new door.
        const foodDatabaseName = foodDatabaseNameForStage(
            stage,
            baseStage,
            Fn.importValue(`kitchensink-data-${baseStage}:FoodDatabaseName`),
        );

        // The RDS instance is PRIVATE_ISOLATED, so the pipeline cannot apply the schema itself; a
        // VPC-attached Lambda does it. A VPC Lambda's public IP does NOT give it egress (ADR-0004), so both functions
        // here are the NAT instance's consumers. The seed function sends nothing through it: its IAM token is signed
        // locally, and its bundle ships no HTTP code of its own (R38, `seedBundleImports.test.ts`).
        //
        // Assets: `npm run bundle:lambda` (run by infra:synth/deploy) builds the runner into `dist-lambda/` and the seed
        // function into `distSeed/`. Synth must not fail when an asset is absent (a bare `cdk synth`), so each falls
        // back to an inline placeholder. ⛔ The placeholder THROWS. It used to resolve
        // `{ ok: false, reason: "asset-not-built" }`, which is a SUCCESSFUL invocation — so an unbundled deploy
        // reported a clean migration run having applied nothing at all.
        //
        // ⚠️ The forwarder is imported ONCE: both drains point at it.
        const forwarder =
            props.logForwarderArn === undefined
                ? undefined
                : lambda.Function.fromFunctionArn(this, 'ImportedLogForwarder', props.logForwarderArn);
        const shared: SharedPipelineProps = {
            serviceSecurityGroup,
            forwarder,
            environment: {
                STAGE: stage,
                FOOD_DB_ENDPOINT: database.dbInstanceEndpointAddress,
                FOOD_DB_PORT: Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`),
                FOOD_DB_NAME: foodDatabaseName,
            },
        };

        // ⚠️ Each construct is written out with its literal id and its `vpc`: the repo guards that find VPC-attached
        // Lambdas and pipeline-only handlers read the source, and a computed id or a hidden `vpc` hides a function from
        // them (`natEgressConsumers.test.ts`, `dbTouchingStackBarrier.test.ts`).
        const migrationFn = new lambda.Function(this, 'FoodMigrationFunction', {
            ...this.pipelineFunctionProps(
                {
                    name: 'FoodMigration',
                    logGroup: new logs.LogGroup(this, 'FoodMigrationLogGroup', PIPELINE_LOG_GROUP_PROPS),
                    assetDir: 'dist-lambda',
                    handler: 'lambdas/migrate/handler.handler',
                    timeout: Duration.seconds(300),
                    memorySize: 512,
                },
                shared,
            ),
            vpc,
        });
        // The runner connects as the MIGRATOR (the role split, `docs/plans/2026-09-11-database-role-split.md`); the
        // service's own login is granted in the service stack, never here.
        database.grantConnect(migrationFn, DATABASE_ROLES.food.migrator);

        // KTD-1's budget: 900 s, Lambda's maximum, and 2048 MB. A full apply of the committed seed took ~32 s and
        // ~515 MB locally (2026-10-01); the first preview deploy's logged timings decide whether the shape changes.
        // ⚠️ NO reserved concurrency: it would throttle the deploy gate's `describe` while an apply runs, and the seed's
        // session advisory lock already serialises two applies (KTD-2).
        const seedFn = new lambda.Function(this, 'FoodSeedFunction', {
            ...this.pipelineFunctionProps(
                {
                    name: 'FoodSeed',
                    logGroup: new logs.LogGroup(this, 'FoodSeedLogGroup', PIPELINE_LOG_GROUP_PROPS),
                    assetDir: 'distSeed',
                    handler: 'lambdas/seed/handler.handler',
                    timeout: Duration.seconds(900),
                    memorySize: 2048,
                },
                shared,
            ),
            vpc,
        });
        // The seed connects as `food_seeder` (KTD-18): its own role holds `rds-db:connect` for that login alone.
        database.grantConnect(seedFn, DATABASE_ROLES.food.seeder);

        this.migrationFunctionName = migrationFn.functionName;
        this.seedFunctionName = seedFn.functionName;

        // ⛔ The pipeline resolves each function through these outputs, and `runMigrations.sh`/`runSeed.sh` treat a
        // stack that EXISTS but publishes no such output as a FAILURE — that is a function which lost its
        // `CfnOutput`, which is precisely how a pipeline path becomes unreachable while every check stays green.
        // ⚠️ NO `exportName`, and that is deliberate. The readers resolve the functions through `describe-stacks
        // --query 'Stacks[0].Outputs'` and need no export. An export would let something `Fn.importValue` it and
        // reintroduce the "cannot delete export … as it is in use" deadlock, on a stack a per-PR teardown must always
        // be able to delete.
        //
        // ⛔ Neither is a per-PR database drop door. `teardownSandboxPr.sh` §1 used to discover doors on each stack by
        // this output's shape and invoke them with `{"action":"drop"}`; that was repointed to
        // `PerPrDatabaseReaperFunction` in `DataStack` (ADR-0031) precisely because a door inside the stack whose
        // database it drops is unreachable once that stack is deleted or stuck.
        new CfnOutput(this, 'FoodMigrationFunctionName', { value: migrationFn.functionName });
        new CfnOutput(this, 'FoodSeedFunctionName', { value: seedFn.functionName });
    }

    /**
     * One pipeline-only function's properties, apart from its VPC: an explicit, drained log group and the function's
     * code, runtime, network placement and environment.
     *
     * ## An EXPLICIT log group, drained and registered (plan U18, ADR-0042)
     *
     * ⛔ A Lambda with no declared group gets one created by the service on first invocation — outside
     * CloudFormation, so it exists in no template, is deleted by no teardown, and has NO RETENTION. Declaring it puts
     * it under the stack that owns the function, gives it the repo's retention, and makes it something a
     * subscription filter can attach to.
     *
     * ⚠️ NO `logGroupName`. CDK generates one from the construct path, which is what every other group in this
     * repository does. Naming it explicitly would require naming the FUNCTION explicitly too, and changing a Lambda's
     * name from generated to explicit REPLACES it — a needless replacement of the function that migrates the
     * production database. For the same reason the construct ids are `${name}LogGroup` and `${name}Function` (both
     * written out at the call site) and `${name}LogDrain`, exactly as the runner's were before this helper existed.
     *
     * ⛔ The drain attaches ONLY WHEN THE ARN IS KNOWN. `Fn.importValue` on the webhooks app's export made THIS stack —
     * the one ADR-0035 deploys ahead of everything that reads the schema — wait for a stack the same pipeline deploys
     * later: a deadlock, not a race. ABSENT IS A SUPPORTED STATE: a fresh account has no forwarder, and the filter
     * attaches on the next deploy of this app (ADR-0042 records that window).
     *
     * @param options - What differs between the two functions.
     * @param shared - What they share: the network, the forwarder and the database environment.
     * @returns The function's properties, without `vpc`.
     * @sideEffect Adds the log group's drain to this stack when the forwarder is known.
     */
    private pipelineFunctionProps(
        options: PipelineFunctionOptions,
        shared: SharedPipelineProps,
    ): Omit<lambda.FunctionProps, 'vpc'> {
        const { logGroup } = options;

        if (shared.forwarder !== undefined) {
            new logs.SubscriptionFilter(this, `${options.name}LogDrain`, {
                logGroup,
                destination: new logsDestinations.LambdaDestination(shared.forwarder, { addPermissions: false }),
                filterPattern: logs.FilterPattern.literal('-START -END -REPORT -"_aws"'),
                filterName: 'forward-app-logs',
            });
        }

        // This module lives at `infra/lib/`, so the package root is two levels up from source (tsx) but three from the
        // compiled `infra/dist/lib/` (how CI deploys via `node infra/dist/bin/app.js`) — probe both.
        const here = dirname(fileURLToPath(import.meta.url));
        const assetDir = [resolve(here, '../..', options.assetDir), resolve(here, '../../..', options.assetDir)].find(
            (candidate) => existsSync(candidate),
        );

        return {
            logGroup,
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: assetDir === undefined ? 'index.handler' : options.handler,
            // One constant for both functions: `bundle:lambda` builds both bundles, and the error's log names the function.
            code:
                assetDir === undefined
                    ? lambda.Code.fromInline(
                          'exports.handler = async () => { throw new Error("food lambda bundle missing: run `npm run bundle:lambda --workspace=packages/services/food-service` before deploying"); };',
                      )
                    : lambda.Code.fromAsset(assetDir),
            timeout: options.timeout,
            memorySize: options.memorySize,
            environment: shared.environment,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [shared.serviceSecurityGroup],
        };
    }
}
