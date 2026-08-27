import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    CfnOutput,
    CustomResource,
    Duration,
    RemovalPolicy,
    SecretValue,
    Stack,
    type StackProps,
    aws_ec2 as ec2,
    aws_lambda as lambda,
    aws_rds as rds,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
    aws_sns as sns,
    aws_sqs as sqs,
    custom_resources as cr,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { AcceptedNagFindings, NODE_LAMBDA_RUNTIME, acceptNagFindings } from '@kitchensink/infra-security';

import type { NetworkStack } from './NetworkStack.js';

/**
 * Where the esbuild-produced handler bundle lives, and whether it is there — read ONCE, at module load.
 *
 * ⛔ The reading is pinned deliberately, and it used to happen inside the constructor. `bin/app.ts` builds
 * every stack of a stage in ONE process, so a per-construction probe makes each stack's template depend on
 * when it happened to be built rather than on the app's inputs — two stacks in the same synth could
 * disagree about their own handler. That is not a hypothetical: `cdkNagSynth.integration.test.ts` runs
 * `npm run bundle:lambda`, which creates this directory, and it sits in `__tests__/` where the default unit
 * glob picks it up — so vitest runs it in PARALLEL with `cdkNagTemplateParity.test.ts`, whose two
 * module-scope synths must be byte-identical. The bundle landing between those two lines made the same app
 * emit `"codeSource": "inline-stub"` and then `"codeSource": "bundle"`, and the prod no-diff proof failed
 * on a diff nobody wrote. Reproduced deterministically by creating the directory ~0.95s into that file's
 * import; by 1.05s the window has closed.
 *
 * Reading once is also right for the real path: `npm run deploy` is `bundle:lambda && cdk deploy`, so the
 * bundle is complete before this module is ever imported. The integration suite likewise bundles and then
 * synthesizes in a CHILD process, which loads this module fresh afterwards.
 *
 * `find` already answers both questions — a candidate it returns is one that exists — so there is no
 * separate second `existsSync` to drift from it.
 */
const LAMBDA_ASSET_CANDIDATES = ((): { readonly dir: string; readonly present: boolean } => {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')];
    const found = candidates.find((candidate) => existsSync(candidate));

    return { dir: found ?? candidates[0]!, present: found !== undefined };
})();

export interface DataStackProps extends StackProps {
    readonly network: NetworkStack;
    readonly stage?: string;
}

/**
 * @implements REQ-013 REQ-014 REQ-017 REQ-025 REQ-026 REQ-050 REQ-IF-007 REQ-CN-007 FR-013 FR-014 FR-017 FR-025 FR-026 ARCH-017 ARCH-031 MOD-017 MOD-031
 */
export class DataStack extends Stack {
    public readonly database: rds.DatabaseInstance;
    public readonly deletionQueue: sqs.Queue;
    /**
     * The handle-sync SNS topic (W8-a.2 / decision 6). Owned by GLOBAL infra (never swept by per-PR
     * cleanup): the identity service (`PATCH /api/v1/users/me`) and the Clerk `user.updated` webhook both
     * publish `{ userId, displayName, sourceTimestamp }` here, and each recipe-workers deployment subscribes
     * its OWN per-stack SQS queue — SNS fan-out, not one shared queue (which would deliver each rename to
     * exactly one of N preview consumers). Its ARN is exported for the producer + subscriber stacks.
     */
    public readonly handleSyncTopic: sns.Topic;
    public readonly deletionDlq: sqs.Queue;
    public readonly mediaBucket: s3.Bucket;
    public readonly archiveBucket: s3.Bucket;
    public readonly dbCredentialsSecret: secretsmanager.Secret;
    public readonly authSecretKey: secretsmanager.ISecret;
    public readonly migrationPlanSecret: secretsmanager.Secret;
    public readonly databaseName: string;
    /**
     * Name of the second logical database provisioned on the shared instance (feature 003). The
     * database + its owning IAM-auth `food_app` role are created by `FoodDbBootstrap`, a
     * master-connected custom resource — `food_app` has no password and cannot bootstrap itself.
     */
    public readonly foodDatabaseName: string;

    /**
     * Name of the third logical database provisioned on the shared instance (feature 001). The database
     * + its owning IAM-auth `recipe_app` role are created by `RecipeDbBootstrap`, a master-connected
     * custom resource — `recipe_app` has no password and cannot bootstrap itself.
     */
    public readonly recipeDatabaseName: string;

    public constructor(scope: Construct, id: string, props: DataStackProps) {
        super(scope, id, props);

        this.dbCredentialsSecret = new secretsmanager.Secret(this, 'DatabaseCredentialsSecret', {
            description: ' PostgreSQL credentials',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ username: 'identity_app' }),
                generateStringKey: 'password',
                excludePunctuation: true,
                includeSpace: false,
            },
        });

        const stageTag = props.stage ?? 'dev';

        // Per-stage RDS right-sizing (ADR-0007). Prod keeps db.t4g.small (unchanged → no prod diff);
        // every non-prod stage (sandbox, dev, per-PR base imports) runs db.t4g.micro. The instance
        // class is the only stage-dependent RDS property, so prod's synthesized template is untouched.
        const dbInstanceSize = stageTag === 'prod' ? ec2.InstanceSize.SMALL : ec2.InstanceSize.MICRO;

        // Per-stage RDS storage type (ADR-0008). Prod stays on the default gp2 (`undefined` here →
        // CDK's default `StorageType: gp2`, byte-identical → no prod diff); every non-prod stage uses
        // gp3. gp3 is cheaper per GB-month and bundles 3,000 baseline IOPS at 100 GB, so NO provisioned
        // IOPS/throughput is set (CDK emits neither `Iops` nor `StorageThroughput` for gp3 under 400 GB).
        // Flipping prod to gp3 later is a safe online modify, deliberately deferred to preserve no-prod-diff.
        const dbStorageType = stageTag === 'prod' ? undefined : rds.StorageType.GP3;

        this.authSecretKey = secretsmanager.Secret.fromSecretNameV2(
            this,
            'Secret',
            `kitchensink/${stageTag}/identity/keys`,
        );

        this.migrationPlanSecret = new secretsmanager.Secret(this, 'MigrationPlanSecret', {
            description: 'Deployment bootstrap instructions for pg_trgm extension',
            secretObjectValue: {
                bootstrapSql: SecretValue.unsafePlainText('CREATE EXTENSION IF NOT EXISTS pg_trgm;'),
                migrationOwner: SecretValue.unsafePlainText('@kitchensink/identity-service'),
            },
        });

        // AwsSolutions-SMG4 accepted: this secret is not a credential — it carries two static, non-sensitive
        // values set from source above, so there is nothing rotation could mean. Justification in
        // @kitchensink/infra-security. (SMG4 on `DatabaseCredentialsSecret` is NOT accepted and NOT
        // suppressed: it is a real gap, ESCALATED in ADR-0013, because single-user rotation there would take
        // the identity service down — see that ADR for the evidence.)
        acceptNagFindings(this.migrationPlanSecret, AcceptedNagFindings.MIGRATION_PLAN_SECRET_HOLDS_NO_CREDENTIAL);

        this.databaseName = 'kitchensink_identity';

        // Feature 003 — second logical database `kitchensink_food` on this SAME shared instance.
        // No new instance/cluster: just an additional least-privilege role + credentials secret and
        // the bootstrap SQL that creates the database and role. `pg_trgm` is already bootstrapped on
        // the instance (see `migrationPlanSecret`), so FR-008 search needs no extra extension here.
        this.foodDatabaseName = 'kitchensink_food';

        // Feature 001 — third logical database `kitchensink_recipes` on this SAME shared instance. Same
        // additive pattern as food (ADR-0006): an extra IAM-auth `recipe_app` role + base database created
        // by the master-connected `RecipeDbBootstrap` below. No new instance/cluster.
        this.recipeDatabaseName = 'kitchensink_recipes';

        const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
            description: 'Isolated subnets for identity PostgreSQL',
            vpc: props.network.vpc,
            removalPolicy: RemovalPolicy.DESTROY,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
        });

        this.database = new rds.DatabaseInstance(this, 'Database', {
            vpc: props.network.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            },
            subnetGroup: dbSubnetGroup,
            securityGroups: [props.network.databaseSecurityGroup],
            credentials: rds.Credentials.fromSecret(this.dbCredentialsSecret),
            // The `food_app` role authenticates passwordlessly with short-lived RDS IAM tokens (feature
            // 003). The master `identity_app` keeps password auth — enabling IAM auth is additive and
            // non-disruptive. See `FoodDbBootstrap` for the role/database provisioning.
            iamAuthentication: true,
            // ⛔ ONE-WAY DOOR. A PostgreSQL MAJOR version cannot be downgraded in place; AWS states that
            // "after an upgrade is complete, you can't revert to the previous version of the DB engine" and
            // the only recovery is restoring the pre-upgrade snapshot into a NEW instance — which
            // CloudFormation does not own. ADR-0002's standing "fix forward only" posture for this stack
            // therefore does NOT apply to this one property. Before moving it, execute
            // `docs/runbooks/pg18-upgrade.md`: it carries the pre-flight checks, the window, and the
            // rehearsed restore leg.
            //
            // ⚠️ MAJOR-ONLY on purpose. `VER_18` synthesizes `EngineVersion: '18'`, and with
            // `autoMinorVersionUpgrade` below RDS tracks the 18 series' patch releases rather than freezing
            // the instance on whichever minor it landed on. Pinning a minor here would make every security
            // patch a code change. The cost of the prefix form is that RDS resolves it at deploy time, so
            // the runbook's pre-flight asserts the resolved target is in this instance's `ValidUpgradeTarget`
            // list — not every 16.x minor can reach every 18.x minor.
            //
            // ⚠️ NO `parameterGroup` is set, DELIBERATELY, and that is what makes this bump a one-property
            // change. Parameter-group families are version-pinned (`postgres16` vs `postgres18`) and
            // `ModifyDBInstance` requires the group to be "in the same DB parameter group family as the DB
            // instance" — so a custom group would have to be REPLACED in the same change set as the version,
            // and getting that wrong fails the deploy AFTER the outage has begun. Without one, RDS uses the
            // default group for the engine version and moves it with the engine. Adding a custom parameter
            // group here is a decision that must handle the family swap; `engineVersionDiff.test.ts` fails
            // if one appears.
            //
            // The reviewed version is RESTATED in `engineVersionDiff.test.ts`, on purpose — a gate that read
            // it from here would agree with it by construction. `localPostgresParity.test.ts` reads it from
            // here for the opposite reason, so every Docker Postgres pin in the repo follows this line.
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_18,
            }),
            // Required IN THE SAME deployment that changes `engine` above: AWS rejects a major-version
            // change without it. It only PERMITS an upgrade, it never triggers one — the trigger is the
            // version, which `engineVersionDiff.test.ts` pins to a reviewed constant. Left on afterwards so
            // the next major hop is not a two-deploy dance during a maintenance window.
            allowMajorVersionUpgrade: true,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, dbInstanceSize),
            // Stage-derived, like `dbInstanceSize` directly above — it was a hardcoded 100 here, which is how
            // two EMPTY databases came to carry 100 GB apiece (~$23/mo of storage for ~0 bytes; measured
            // 2026-08-27, ~101.9 GB free of 100 GB allocated on BOTH). Prod keeps 100 by owner ruling, which
            // also means prod is never rebuilt to reach a new number.
            //
            // Sized against the full intended scope — all of USDA FoodData Central including Branded (~1.9M
            // foods, ~30M food_nutrients rows) plus 10,000 recipes — the database models to ~10-11 GB at the
            // bloaty end of the published pg_trgm index ratios. 50 GB is generous; the RDS minimum is 20.
            allocatedStorage: stageTag === 'prod' ? 100 : 50,
            // ⚠️ The number above is a MODEL — nothing has ingested Branded yet, and `usdaBulk.parser.ts`
            // does not seed it today. This is what makes being wrong survivable: autoscaling costs nothing
            // until used and turns "out of disk at 3am" into "grew". It was OFF on both instances, which is
            // the real defect the oversized literal was hiding.
            maxAllocatedStorage: 200,
            storageType: dbStorageType,
            storageEncrypted: true,
            backupRetention: Duration.days(7),
            multiAz: false,
            databaseName: this.databaseName,
            // ON for every stage (owner ruling 2026-08-08). It is free, and it is the ONLY thing between an
            // accidental replacement and total data loss: this instance has no Multi-AZ standby (T-196 closed
            // that as WON'T DO — one cluster, one AZ, one region until the product earns) and
            // `removalPolicy: DESTROY` below takes NO safety snapshot.
            //
            // The concrete hazard it closes is ADR-0002's: changing the prod VPC CIDR, or any construct id
            // feeding the VPC, REPLACES the prod VPC and its RDS with no snapshot. Protection converts that
            // from silent data loss into a loud CloudFormation failure.
            //
            // SANDBOX IS INCLUDED DELIBERATELY. It is not disposable — it hosts the single shared identity
            // service every PR preview signs in against, and the teardown rules say the shared RDS must never
            // be destroyed. Per-PR cleanup operates on LOGICAL databases inside this instance and on
            // `Environment=pr-{N}` resources, so protecting the instance cannot block it.
            //
            // ⚠️ ACCEPTED CONSEQUENCE: with protection on and `removalPolicy: DESTROY` retained, a genuine
            // teardown FAILS until someone disables protection first. That extra deliberate step is the
            // point — it makes destroying a database an explicit act, not a side effect of a rename.
            // `removalPolicy` is intentionally left as-is: flipping it to RETAIN is a separate decision that
            // would change teardown semantics ADR-0002 documents.
            deletionProtection: true,
            publiclyAccessible: false,
            removalPolicy: RemovalPolicy.DESTROY,
            autoMinorVersionUpgrade: true,
        });

        // ── Food role + base database bootstrap (feature 003, ADR-0006) ──────────────────────────────
        // `food_app` authenticates via RDS IAM (no password), so it cannot create itself — only the
        // master can. This VPC-attached custom resource connects AS MASTER on every deploy and, idempotently,
        // creates the `food_app` LOGIN role, grants it `rds_iam`, creates the base `kitchensink_food`
        // database, and (non-prod only) grants CREATEDB so the migrate lambda can make per-PR databases.
        // Bundled by esbuild.mjs to the package-root `dist-lambda/`; a bare `cdk synth` (no bundle) falls
        // back to an inline no-op asset. This module lives at `lib/platform/`, so the package root is two
        // levels up when run from source (tsx) but three when run from the compiled `dist/lib/platform/`
        // (how CI deploys via `node dist/bin/app.js`) — probe both so the REAL handler ships either way.
        // The placeholder shipped when `dist-lambda/` was never built. It must NOT report success: a
        // success-returning no-op is how prod ran for four weeks with NO `food_app`/`recipe_app` role at
        // all — CloudFormation recorded CREATE_COMPLETE for a 101-byte stub that did nothing, and the
        // failure only surfaced later, in another service, as `password authentication failed for user
        // "food_app"`. Deleting must still no-op, or a stack delete would wedge on a throwing resource.
        const missingBundleStub = (physicalId: string): string =>
            `exports.handler = async (e) => { if (e.RequestType === 'Delete') { ` +
            `return { PhysicalResourceId: e.PhysicalResourceId ?? '${physicalId}' }; } ` +
            `throw new Error('${physicalId} was deployed WITHOUT its real bundle, so it would silently ` +
            `create no role and no database. Run \`npm run bundle:lambda --workspace=packages/infra/global\` ` +
            `before cdk deploy (the package\\'s own npm \`deploy\` script already does).'); };`;

        const foodBootstrapFn = new lambda.Function(this, 'FoodDbBootstrapFunction', {
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: LAMBDA_ASSET_CANDIDATES.present ? 'food-db-bootstrap/handler.handler' : 'index.handler',
            code: LAMBDA_ASSET_CANDIDATES.present
                ? lambda.Code.fromAsset(LAMBDA_ASSET_CANDIDATES.dir)
                : lambda.Code.fromInline(missingBundleStub('food-db-bootstrap')),
            timeout: Duration.seconds(300),
            memorySize: 256,
            description: `Bootstrap food_app role + base database (${stageTag})`,
            vpc: props.network.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [props.network.lambdaSecurityGroup],
            environment: {
                DB_SECRET_ARN: this.dbCredentialsSecret.secretArn,
                DB_ENDPOINT: this.database.dbInstanceEndpointAddress,
                DB_PORT: this.database.dbInstanceEndpointPort,
                FOOD_DATABASE_NAME: this.foodDatabaseName,
                STAGE: stageTag,
            },
        });
        this.dbCredentialsSecret.grantRead(foodBootstrapFn);

        const foodBootstrapProvider = new cr.Provider(this, 'FoodDbBootstrapProvider', {
            onEventHandler: foodBootstrapFn,
        });

        const foodBootstrap = new CustomResource(this, 'FoodDbBootstrap', {
            serviceToken: foodBootstrapProvider.serviceToken,
            // Re-runs the (idempotent) bootstrap whenever the target database or stage changes.
            properties: {
                foodDatabaseName: this.foodDatabaseName,
                stage: stageTag,
                // Re-runs when the handler goes from the inline stub to the real bundle. Without this a
                // CODE-only change never re-invokes the resource, so a stage bootstrapped by the stub
                // stays un-bootstrapped forever even after the bundle starts shipping.
                codeSource: LAMBDA_ASSET_CANDIDATES.present ? 'bundle' : 'inline-stub',
            },
        });
        // `GRANT rds_iam` needs the instance's IAM-auth modify to be applied first. The env already
        // references the endpoint (an implicit dependency), but make the ordering explicit so a fresh
        // deploy (e.g. prod's first apply of this change) cannot race the instance update.
        foodBootstrap.node.addDependency(this.database);

        // ── Recipe role + base database bootstrap (feature 001, ADR-0006) ────────────────────────────
        // Identical additive pattern to the food bootstrap above: a master-connected custom resource that
        // idempotently creates the IAM-auth `recipe_app` LOGIN role, grants it `rds_iam`, creates the base
        // `kitchensink_recipes` database, and (non-prod only) grants CREATEDB so the recipe migrate lambda
        // can make per-PR databases. Reuses the same bundled `dist-lambda/` asset dir (the esbuild build
        // emits `recipe-db-bootstrap/handler`); a bare `cdk synth` (no bundle) falls back to an inline no-op.
        const recipeBootstrapFn = new lambda.Function(this, 'RecipeDbBootstrapFunction', {
            runtime: NODE_LAMBDA_RUNTIME,
            architecture: lambda.Architecture.ARM_64,
            handler: LAMBDA_ASSET_CANDIDATES.present ? 'recipe-db-bootstrap/handler.handler' : 'index.handler',
            code: LAMBDA_ASSET_CANDIDATES.present
                ? lambda.Code.fromAsset(LAMBDA_ASSET_CANDIDATES.dir)
                : lambda.Code.fromInline(missingBundleStub('recipe-db-bootstrap')),
            timeout: Duration.seconds(300),
            memorySize: 256,
            description: `Bootstrap recipe_app role + base database (${stageTag})`,
            vpc: props.network.vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [props.network.lambdaSecurityGroup],
            environment: {
                DB_SECRET_ARN: this.dbCredentialsSecret.secretArn,
                DB_ENDPOINT: this.database.dbInstanceEndpointAddress,
                DB_PORT: this.database.dbInstanceEndpointPort,
                RECIPE_DATABASE_NAME: this.recipeDatabaseName,
                STAGE: stageTag,
            },
        });
        this.dbCredentialsSecret.grantRead(recipeBootstrapFn);

        const recipeBootstrapProvider = new cr.Provider(this, 'RecipeDbBootstrapProvider', {
            onEventHandler: recipeBootstrapFn,
        });

        const recipeBootstrap = new CustomResource(this, 'RecipeDbBootstrap', {
            serviceToken: recipeBootstrapProvider.serviceToken,
            // Re-runs the (idempotent) bootstrap whenever the target database or stage changes.
            properties: {
                recipeDatabaseName: this.recipeDatabaseName,
                stage: stageTag,
                codeSource: LAMBDA_ASSET_CANDIDATES.present ? 'bundle' : 'inline-stub',
            },
        });
        // Same explicit ordering as the food bootstrap: `GRANT rds_iam` needs the instance's IAM-auth
        // modify applied first, so depend on the instance rather than race a fresh deploy.
        recipeBootstrap.node.addDependency(this.database);

        this.deletionDlq = new sqs.Queue(this, 'DeletionDlq', {
            enforceSSL: true,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14),
            visibilityTimeout: Duration.minutes(2),
        });

        this.deletionQueue = new sqs.Queue(this, 'DeletionQueue', {
            enforceSSL: true,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: Duration.minutes(2),
            deadLetterQueue: {
                queue: this.deletionDlq,
                maxReceiveCount: 5,
            },
        });

        // Handle-sync fan-out topic (W8-a.2). A plain topic: the payload is transient and non-secret at the
        // topic; the PII (a display name) is bounded by each subscriber SQS queue's retention + SSE. Named
        // per-stage but tagged Environment=global (prod/sandbox baseline only, never pr-{N}).
        this.handleSyncTopic = new sns.Topic(this, 'HandleSyncTopic', {
            enforceSSL: true,
            topicName: `kitchensink-handle-sync-${stageTag}`,
            displayName: 'Recipe author/editor handle sync',
        });

        this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        this.archiveBucket = new s3.Bucket(this, 'ArchiveBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true,
            lifecycleRules: [
                {
                    enabled: true,
                    expiration: Duration.days(30),
                },
            ],
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        new CfnOutput(this, 'HandleSyncTopicArn', {
            value: this.handleSyncTopic.topicArn,
            exportName: `${this.stackName}:HandleSyncTopicArn`,
        });
        new CfnOutput(this, 'DatabaseEndpoint', {
            value: this.database.dbInstanceEndpointAddress,
            exportName: `${this.stackName}:DatabaseEndpoint`,
        });
        new CfnOutput(this, 'DatabasePort', {
            value: this.database.dbInstanceEndpointPort,
            exportName: `${this.stackName}:DatabasePort`,
        });
        new CfnOutput(this, 'DatabaseName', {
            value: this.databaseName,
            exportName: `${this.stackName}:DatabaseName`,
        });
        new CfnOutput(this, 'DatabaseSecretArn', {
            value: this.dbCredentialsSecret.secretArn,
            exportName: `${this.stackName}:DatabaseSecretArn`,
        });
        new CfnOutput(this, 'SecretArn', {
            value: this.authSecretKey.secretArn,
            exportName: `${this.stackName}:SecretArn`,
        });
        new CfnOutput(this, 'MigrationPlanSecretArn', {
            value: this.migrationPlanSecret.secretArn,
            exportName: `${this.stackName}:MigrationPlanSecretArn`,
        });
        new CfnOutput(this, 'FoodDatabaseName', {
            value: this.foodDatabaseName,
            exportName: `${this.stackName}:FoodDatabaseName`,
        });
        new CfnOutput(this, 'RecipeDatabaseName', {
            value: this.recipeDatabaseName,
            exportName: `${this.stackName}:RecipeDatabaseName`,
        });
        // RDS instance resource id (dbi-…), needed to scope `rds-db:connect` IAM to the food_app db-user.
        // Always present on an owned instance (only `undefined` for some imports), so guard for the type.
        const databaseResourceId = this.database.instanceResourceId;

        if (!databaseResourceId) {
            throw new Error('DatabaseInstance.instanceResourceId is unexpectedly undefined');
        }

        new CfnOutput(this, 'DatabaseResourceId', {
            value: databaseResourceId,
            exportName: `${this.stackName}:DatabaseResourceId`,
        });
        new CfnOutput(this, 'DeletionQueueArn', {
            value: this.deletionQueue.queueArn,
            exportName: `${this.stackName}:DeletionQueueArn`,
        });
        new CfnOutput(this, 'DeletionQueueUrl', {
            value: this.deletionQueue.queueUrl,
            exportName: `${this.stackName}:DeletionQueueUrl`,
        });
        new CfnOutput(this, 'DeletionDlqArn', {
            value: this.deletionDlq.queueArn,
            exportName: `${this.stackName}:DeletionDlqArn`,
        });
        new CfnOutput(this, 'MediaBucketName', {
            value: this.mediaBucket.bucketName,
            exportName: `${this.stackName}:MediaBucketName`,
        });
        new CfnOutput(this, 'ArchiveBucketName', {
            value: this.archiveBucket.bucketName,
            exportName: `${this.stackName}:ArchiveBucketName`,
        });
    }
}
