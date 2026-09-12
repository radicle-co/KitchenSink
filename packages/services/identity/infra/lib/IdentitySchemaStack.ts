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
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

import { NODE_LAMBDA_RUNTIME } from '@radicle-co/infra-shared/security';
import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

export interface IdentitySchemaStackProps extends StackProps {
    readonly stage: string;
    readonly vpcId: string;
}

/**
 * The identity database's SCHEMA — its migration runner, and nothing that reads the schema.
 *
 * ## Why the runner lives alone
 *
 * ADR-0022 put the schema apply INSIDE the service deploy, as an `aws-cdk-lib/triggers` Trigger every
 * consumer in the stack was ordered behind. It was the right answer to the wrong constraint: the runner had
 * to share a stack with the ECS service because CloudFormation's `DependsOn` cannot leave a stack, and
 * because the runner's SQL ships with its bundle, so invoking it before the deploy runs the PREVIOUS
 * release's migration set.
 *
 * Both halves of that are now addressed without coupling the two. The runner is deployed by its own
 * pipeline step, ahead of every consumer, so ordering comes from position rather than from a construct
 * graph that cannot cross a stack boundary. And the "previous release's bundle" hazard — which used to be
 * undetectable, because such a runner answers `applied: []` exactly like one with nothing to do — is closed
 * by the manifest expectation the pipeline sends with the invoke: a runner holding a different migration
 * set refuses instead of reporting a clean run.
 *
 * ⛔ NOTHING THAT READS THE SCHEMA MAY BE ADDED HERE. That is the stack's entire invariant: it is what
 * makes "deploy this, then migrate, then deploy everything else" a real barrier rather than a convention.
 * A DB-touching Lambda placed here would be updated by the same `cdk deploy` that ships the runner, i.e.
 * BEFORE the migration it depends on. `packages/infra/global/__tests__/schemaStackPurity.test.ts` asserts
 * it from the synthesized template.
 *
 * ## Why it is a separate stack and not a separate CDK app
 *
 * A stack in this app can be deployed by name (`cdk deploy kitchensink-identity-schema-{stage}`) while
 * still sharing the app's tags, provenance stamp and nag aspects. A second app would duplicate all of
 * that, and would need its own `verify-deployment.sh` invocation to stay covered.
 */
export class IdentitySchemaStack extends Stack {
    /** The migration runner's function name, for the pipeline's migrate step. */
    public readonly migrationFunctionName: string;

    public constructor(scope: Construct, id: string, props: IdentitySchemaStackProps) {
        super(scope, id, props);

        const { stage, vpcId } = props;

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { vpcId });

        const lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedLambdaSecurityGroup',
            Fn.importValue(`kitchensink-network-${stage}:LambdaSecurityGroupId`),
        );

        // ⛔ NOT the master credential any more. The runner used to read `DatabaseSecretArn` — the RDS MASTER,
        // `rds_superuser` — and ran every migration as it. It now connects as `identity_migrator` by RDS IAM (the
        // role split, `docs/plans/2026-09-11-database-role-split.md`), so it needs the instance, not a secret: the
        // resource id is imported so `grantConnect` can scope `rds-db:connect` to exactly that db-user.
        const database = rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedDatabase', {
            instanceIdentifier: `kitchensink-data-${stage}`,
            instanceResourceId: Fn.importValue(`kitchensink-data-${stage}:DatabaseResourceId`),
            instanceEndpointAddress: Fn.importValue(`kitchensink-data-${stage}:DatabaseEndpoint`),
            port: Token.asNumber(Fn.importValue(`kitchensink-data-${stage}:DatabasePort`)),
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(
                    this,
                    'ImportedDbSg',
                    Fn.importValue(`kitchensink-network-${stage}:DatabaseSecurityGroupId`),
                ),
            ],
        });

        // ⚠️ The identity RDS instance is not publicly reachable, so the apply cannot run from the pipeline
        // itself; a VPC-attached Lambda does it. A Lambda's public IP does NOT give it egress (ADR-0004),
        // so this is one of the NAT instance's consumers — unchanged by the move out of the service stack,
        // which is the same function in a different template.
        //
        // Asset: esbuild bundles to the package-root `dist-lambda/` (`npm run bundle:lambda`, run by
        // infra:synth/deploy). Synth must not fail when the asset is absent (a bare `cdk synth`), so fall
        // back to an inline placeholder that THROWS. Resolving something benign would be a SUCCESSFUL
        // invocation that applied nothing — the silent no-op this whole path exists to remove. This module
        // lives at `infra/lib/`, so the package root is two levels up from source (tsx) but three from the
        // compiled `infra/dist/lib/` (how CI deploys via `node infra/dist/bin/app.js`) — probe both.
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);

        const migrationFn = new lambda.Function(this, 'IdentityMigrationFunction', {
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: hasLambdaAsset ? 'lambdas/migrate/handler.handler' : 'index.handler',
            code: hasLambdaAsset
                ? lambda.Code.fromAsset(lambdaAssetDir)
                : lambda.Code.fromInline(
                      'exports.handler = async () => { throw new Error("identity migration bundle missing: run `npm run bundle:lambda --workspace=packages/services/identity` before deploying"); };',
                  ),
            // Sized for the whole apply loop, which holds a session advisory lock for its duration. The
            // pipeline's invoke has no socket timeout of its own to keep in step, which is one thing the
            // Trigger form did need.
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: {
                STAGE: stage,
                DB_HOST: database.dbInstanceEndpointAddress,
                DB_PORT: Fn.importValue(`kitchensink-data-${stage}:DatabasePort`),
                DB_NAME: Fn.importValue(`kitchensink-data-${stage}:DatabaseName`),
                DB_USERNAME: DATABASE_ROLES.identity.migrator,
            },
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [lambdaSecurityGroup],
        });
        database.grantConnect(migrationFn, DATABASE_ROLES.identity.migrator);

        this.migrationFunctionName = migrationFn.functionName;

        // ⛔ The pipeline's migrate step resolves the runner through this output, and `run-migrations.sh`
        // treats a stack that EXISTS but publishes no such output as a FAILURE — that is a runner which
        // lost its `CfnOutput`, which is precisely how a migration path becomes unreachable while every
        // check stays green.
        // ⚠️ NO `exportName`, and that is deliberate. Its reader is `run-migrations.sh run`, which resolves
        // the function through `describe-stacks --query 'Stacks[0].Outputs'` and needs no export. An export
        // would let something `Fn.importValue` it and reintroduce the "cannot delete export … as it is in
        // use" deadlock, on a stack a per-PR teardown must always be able to delete.
        //
        // ⛔ It is NOT a per-PR database drop door. `teardown-sandbox-pr.sh` §1 used to discover doors on
        // each stack by this output's shape and invoke them with `{"action":"drop"}`; that was repointed to
        // `PerPrDatabaseReaperFunction` in `DataStack` (ADR-0031) precisely because a door inside the stack
        // whose database it drops is unreachable once that stack is deleted or stuck. Reclamation is the
        // reaper's; this output's only job is to make the schema reachable for MIGRATION.
        new CfnOutput(this, 'IdentityMigrationFunctionName', { value: migrationFn.functionName });
    }
}
