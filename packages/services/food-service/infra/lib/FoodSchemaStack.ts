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

/**
 * The food database's SCHEMA — its migration runner, and nothing that reads the schema.
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
 * ⛔ NOTHING THAT READS THE SCHEMA MAY BE ADDED HERE. That is the stack's entire invariant, and it is what
 * makes "deploy this, then migrate, then deploy everything else" a barrier rather than a convention.
 *
 * ⚠️ On a first-ever `pr-{N}` deploy this runner CREATES the per-PR logical database by cloning the base
 * one (ADR-0006), so it is also the step that must precede every other food resource for that stage — not
 * merely the ones that read a table.
 */
export class FoodSchemaStack extends Stack {
    /** The migration runner's function name, for the pipeline's migrate step. */
    public readonly migrationFunctionName: string;

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
        // VPC-attached Lambda does it. A VPC Lambda's public IP does NOT give it egress (ADR-0004), so this
        // is one of the NAT instance's consumers — unchanged by the move, which is the same function in a
        // different template.
        //
        // Asset: esbuild bundles to the package-root `dist-lambda/` (`npm run bundle:lambda`, run by
        // infra:synth/deploy). Synth must not fail when the asset is absent (a bare `cdk synth`), so fall
        // back to an inline placeholder. ⛔ The placeholder THROWS. It used to resolve
        // `{ ok: false, reason: "asset-not-built" }`, which is a SUCCESSFUL invocation — so an unbundled
        // deploy reported a clean migration run having applied nothing at all. This module lives at
        // `infra/lib/`, so the package root is two levels up from source (tsx) but three from the compiled
        // `infra/dist/lib/` (how CI deploys via `node infra/dist/bin/app.js`) — probe both.
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);

        // ── An EXPLICIT log group, drained and registered (plan U18, ADR-0042) ──
        //
        // ⛔ THIS FUNCTION WROTE TO AN IMPLICIT GROUP. A Lambda with no declared group gets one created by
        // the service on first invocation — outside CloudFormation, so it exists in no template, is deleted
        // by no teardown, and has NO RETENTION: it keeps every line forever, and the cost of that is
        // invisible because nothing in the repository names the resource. Declaring it puts it under the
        // stack that owns the function, gives it the repo's retention, and — the reason this unit exists —
        // makes it something a subscription filter can attach to.
        //
        // ⚠️ NO `logGroupName`. CDK generates one from the construct path, which is what every other group
        // in this repository does. Naming it explicitly would require naming the FUNCTION explicitly too,
        // and changing a Lambda's name from generated to explicit REPLACES it — a needless replacement of
        // the function that migrates the production database.
        const migrationLogGroup = new logs.LogGroup(this, 'FoodMigrationLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // ⛔ ONLY WHEN THE ARN IS KNOWN, and the import this replaces was a DEADLOCK rather than a race.
        // `Fn.importValue` on the webhooks app's export made THIS stack — the one ADR-0035 deploys ahead of
        // everything that reads the schema — wait for a stack the same pipeline deploys later. A sandbox
        // deploy died in `UPDATE_ROLLBACK_IN_PROGRESS` with "No export named
        // kitchensink-identity-webhooks-sandbox:LogForwarderArn found", and no ordering of the existing
        // steps could satisfy both rules at once. The ARN now arrives as a CI-resolved input.
        //
        // ⚠️ ABSENT IS A SUPPORTED STATE, not a failure: a fresh account has no forwarder to point at, and
        // a hard failure here would leave it with no way to bootstrap. The filter attaches on the next
        // deploy of this app — ADR-0042 records the convergence window as a residual.
        if (props.logForwarderArn !== undefined) {
            new logs.SubscriptionFilter(this, 'FoodMigrationLogDrain', {
                logGroup: migrationLogGroup,
                destination: new logsDestinations.LambdaDestination(
                    lambda.Function.fromFunctionArn(this, 'ImportedLogForwarder', props.logForwarderArn),
                    { addPermissions: false },
                ),
                filterPattern: logs.FilterPattern.literal('-START -END -REPORT -"_aws"'),
                filterName: 'forward-app-logs',
            });
        }

        const migrationFn = new lambda.Function(this, 'FoodMigrationFunction', {
            logGroup: migrationLogGroup,
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: hasLambdaAsset ? 'lambdas/migrate/handler.handler' : 'index.handler',
            code: hasLambdaAsset
                ? lambda.Code.fromAsset(lambdaAssetDir)
                : lambda.Code.fromInline(
                      'exports.handler = async () => { throw new Error("food migration bundle missing: run `npm run bundle:lambda --workspace=packages/services/food-service` before deploying"); };',
                  ),
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: {
                STAGE: stage,
                FOOD_DB_ENDPOINT: database.dbInstanceEndpointAddress,
                FOOD_DB_PORT: Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`),
                FOOD_DB_NAME: foodDatabaseName,
            },
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [serviceSecurityGroup],
        });
        // `food_app` authenticates via RDS IAM — the migrate lambda mints a token per connection.
        // The runner connects as the MIGRATOR (the role split, `docs/plans/2026-09-11-database-role-split.md`); the
        // service's own login is granted in the service stack, never here.
        database.grantConnect(migrationFn, DATABASE_ROLES.food.migrator);

        this.migrationFunctionName = migrationFn.functionName;

        // ⛔ The pipeline's migrate step resolves the runner through this output, and `runMigrations.sh`
        // treats a stack that EXISTS but publishes no such output as a FAILURE — that is a runner which
        // lost its `CfnOutput`, which is precisely how a migration path becomes unreachable while every
        // check stays green.
        // ⚠️ NO `exportName`, and that is deliberate. Its reader is `runMigrations.sh run`, which resolves
        // the function through `describe-stacks --query 'Stacks[0].Outputs'` and needs no export. An export
        // would let something `Fn.importValue` it and reintroduce the "cannot delete export … as it is in
        // use" deadlock, on a stack a per-PR teardown must always be able to delete.
        //
        // ⛔ It is NOT a per-PR database drop door. `teardownSandboxPr.sh` §1 used to discover doors on
        // each stack by this output's shape and invoke them with `{"action":"drop"}`; that was repointed to
        // `PerPrDatabaseReaperFunction` in `DataStack` (ADR-0031) precisely because a door inside the stack
        // whose database it drops is unreachable once that stack is deleted or stuck. Reclamation is the
        // reaper's; this output's only job is to make the schema reachable for MIGRATION.
        new CfnOutput(this, 'FoodMigrationFunctionName', { value: migrationFn.functionName });
    }
}
