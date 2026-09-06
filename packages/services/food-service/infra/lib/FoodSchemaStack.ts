import {
    CfnOutput,
    Duration,
    Fn,
    Stack,
    type StackProps,
    aws_ec2 as ec2,
    aws_lambda as lambda,
    aws_rds as rds,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { NODE_LAMBDA_RUNTIME } from '@kitchensink/infra-security';

import { foodDatabaseNameForStage } from './FoodServiceStack.js';

export interface FoodSchemaStackProps extends StackProps {
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
            port: Number(Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`)),
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

        const migrationFn = new lambda.Function(this, 'FoodMigrationFunction', {
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
        database.grantConnect(migrationFn, 'food_app');

        this.migrationFunctionName = migrationFn.functionName;

        // ⛔ The pipeline's migrate step resolves the runner through this output, and `run-migrations.sh`
        // treats a stack that EXISTS but publishes no such output as a FAILURE — that is a runner which
        // lost its `CfnOutput`, which is precisely how a migration path becomes unreachable while every
        // check stays green.
        // ⚠️ NO `exportName`, and that is deliberate. Both readers — `run-migrations.sh run` and
        // `teardown-sandbox-pr.sh` §1, which discovers per-PR database drop doors by the shape
        // `^[A-Za-z]+MigrationFunctionName$` — read `describe-stacks --query 'Stacks[0].Outputs'`, which
        // needs no export. An export would let something `Fn.importValue` it and reintroduce the
        // "cannot delete export … as it is in use" deadlock, on the one stack a per-PR teardown must be
        // able to delete.
        new CfnOutput(this, 'FoodMigrationFunctionName', { value: migrationFn.functionName });
    }
}
