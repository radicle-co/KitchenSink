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
    aws_sqs as sqs,
    custom_resources as cr,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { NetworkStack } from './network-stack.js';

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
    public readonly deletionDlq: sqs.Queue;
    public readonly mediaBucket: s3.Bucket;
    public readonly archiveBucket: s3.Bucket;
    public readonly dbCredentialsSecret: secretsmanager.Secret;
    public readonly authSecretKey: secretsmanager.ISecret;
    public readonly migrationPlanSecret: secretsmanager.Secret;
    public readonly databaseName: string;
    /**
     * Name of the second logical database provisioned on the shared instance (feature 003). The
     * database + its owning IAM-auth `food_app` role are created by {@link FoodDbBootstrap}, a
     * master-connected custom resource — `food_app` has no password and cannot bootstrap itself.
     */
    public readonly foodDatabaseName: string;

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

        this.databaseName = 'kitchensink_identity';

        // Feature 003 — second logical database `kitchensink_food` on this SAME shared instance.
        // No new instance/cluster: just an additional least-privilege role + credentials secret and
        // the bootstrap SQL that creates the database and role. `pg_trgm` is already bootstrapped on
        // the instance (see `migrationPlanSecret`), so FR-008 search needs no extra extension here.
        this.foodDatabaseName = 'kitchensink_food';

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
            // non-disruptive. See {@link FoodDbBootstrap} for the role/database provisioning.
            iamAuthentication: true,
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_16,
            }),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, dbInstanceSize),
            allocatedStorage: 100,
            storageType: dbStorageType,
            storageEncrypted: true,
            backupRetention: Duration.days(7),
            multiAz: false,
            databaseName: this.databaseName,
            deletionProtection: false,
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
        const here = dirname(fileURLToPath(import.meta.url));
        const lambdaAssetDir =
            [resolve(here, '../../dist-lambda'), resolve(here, '../../../dist-lambda')].find((candidate) =>
                existsSync(candidate),
            ) ?? resolve(here, '../../dist-lambda');
        const hasLambdaAsset = existsSync(lambdaAssetDir);
        const foodBootstrapFn = new lambda.Function(this, 'FoodDbBootstrapFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            architecture: lambda.Architecture.ARM_64,
            handler: hasLambdaAsset ? 'food-db-bootstrap/handler.handler' : 'index.handler',
            code: hasLambdaAsset
                ? lambda.Code.fromAsset(lambdaAssetDir)
                : lambda.Code.fromInline(
                      'exports.handler = async (e) => ({ PhysicalResourceId: e.PhysicalResourceId ?? "food-db-bootstrap" });',
                  ),
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

        new CustomResource(this, 'FoodDbBootstrap', {
            serviceToken: foodBootstrapProvider.serviceToken,
            // Re-runs the (idempotent) bootstrap whenever the target database or stage changes.
            properties: { foodDatabaseName: this.foodDatabaseName, stage: stageTag },
        });

        this.deletionDlq = new sqs.Queue(this, 'DeletionDlq', {
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(14),
            visibilityTimeout: Duration.minutes(2),
        });

        this.deletionQueue = new sqs.Queue(this, 'DeletionQueue', {
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: Duration.days(4),
            visibilityTimeout: Duration.minutes(2),
            deadLetterQueue: {
                queue: this.deletionDlq,
                maxReceiveCount: 5,
            },
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
