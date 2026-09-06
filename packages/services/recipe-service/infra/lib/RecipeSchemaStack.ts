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
import { recipeDatabaseNameForStage } from '@kitchensink/recipe-core/database-name';

export interface RecipeSchemaStackProps extends StackProps {
    /** Deploy stage (`prod`, `sandbox`, `pr-{N}`, …). */
    readonly stage: string;
    /** The persistent platform stage this deploy imports from (ADR-0006). Defaults to `stage`. */
    readonly baseStage?: string;
    /** Shared VPC id to import. */
    readonly vpcId: string;
}

/**
 * The recipe database's SCHEMA — its migration runner, and nothing that reads the schema.
 *
 * ## Why this stack collapses TWO runners into one
 *
 * ADR-0022 put the schema apply inside each deploy, as an `aws-cdk-lib/triggers` Trigger. For recipe that
 * required TWO runners for ONE database: `RecipeServiceStack` ordered the API tasks behind its own, and
 * `RecipeWorkersStack` — a separate CDK app, applied by a separate `cdk deploy` that must run FIRST —
 * shipped a SECOND copy of this same bundle purely so its eight Lambdas could be ordered behind something.
 * `DependsOn` cannot leave a stack, so there was no other way to express it.
 *
 * There is now. The runner is deployed and invoked by its own pipeline step ahead of both, so one runner
 * orders every consumer of this schema regardless of which app or stack it lives in — which is strictly
 * more coverage than two in-stack barriers could give, because a barrier only ever reached its own stack.
 *
 * ⛔ NOTHING THAT READS THE SCHEMA MAY BE ADDED HERE. That is the stack's entire invariant.
 *
 * ⚠️ On a first-ever `pr-{N}` deploy this runner CREATES the per-PR logical database (ADR-0006), so it must
 * precede every recipe resource for that stage, not merely the ones that read a table.
 *
 * ⚠️ It lives in the recipe-SERVICE CDK app, which owns the SQL and the bundle, even though recipe-WORKERS
 * deploys before the service. That is fine and deliberate: the pipeline deploys this stack by name with
 * `--exclusively`, ahead of both, and `RecipeWorkersStack` no longer needs the `migrationBundlePath` reach
 * into another package's `dist-lambda/` that its own runner required.
 */
export class RecipeSchemaStack extends Stack {
    /** The migration runner's function name, for the pipeline's migrate step. */
    public readonly migrationFunctionName: string;

    public constructor(scope: Construct, id: string, props: RecipeSchemaStackProps) {
        super(scope, id, props);

        const { stage, vpcId } = props;
        const baseStage = props.baseStage ?? stage;

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { vpcId });

        const serviceSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedServiceSg',
            Fn.importValue(`kitchensink-network-${baseStage}:ServiceSecurityGroupId`),
        );

        // NO RDS created here — owned by the global DataStack. `recipe_app` connects via RDS IAM auth, so
        // there is no secret; the instance resource id is imported so `grantConnect` can scope
        // `rds-db:connect` to that db-user.
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

        // Per-PR logical database isolation (ADR-0006). Resolved through the SAME function the service and
        // the workers use, never re-spelled: a runner that migrated one database while the consumers read
        // another is #119's failure mode through a new door.
        const recipeDatabaseName = recipeDatabaseNameForStage(
            stage,
            baseStage,
            Fn.importValue(`kitchensink-data-${baseStage}:RecipeDatabaseName`),
        );

        // The RDS is PRIVATE_ISOLATED, so the pipeline cannot apply the schema itself; a VPC-attached
        // Lambda does it. Asset bundled by `esbuild.mjs` to `dist-lambda/`; a bare `cdk synth` (no bundle)
        // falls back to an inline placeholder so synth never fails. ⛔ The placeholder THROWS. It used to
        // resolve `{ ok: false, reason: "asset-not-built" }`, which is a SUCCESSFUL invocation — so an
        // unbundled deploy reported a clean migration run having applied nothing.
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);

        const migrationFn = new lambda.Function(this, 'RecipeMigrationFunction', {
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: hasLambdaAsset ? 'lambdas/migrate/handler.handler' : 'index.handler',
            code: hasLambdaAsset
                ? lambda.Code.fromAsset(lambdaAssetDir)
                : lambda.Code.fromInline(
                      'exports.handler = async () => { throw new Error("recipe migration bundle missing: run `npm run bundle:lambda --workspace=packages/services/recipe-service` before deploying"); };',
                  ),
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: {
                STAGE: stage,
                DB_HOST: database.dbInstanceEndpointAddress,
                DB_PORT: Fn.importValue(`kitchensink-data-${baseStage}:DatabasePort`),
                DB_NAME: recipeDatabaseName,
                DB_USERNAME: 'recipe_app',
            },
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [serviceSecurityGroup],
        });
        database.grantConnect(migrationFn, 'recipe_app');

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
        new CfnOutput(this, 'RecipeMigrationFunctionName', { value: migrationFn.functionName });
    }
}
