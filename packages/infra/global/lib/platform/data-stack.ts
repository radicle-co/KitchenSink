import {
    CfnOutput,
    Duration,
    RemovalPolicy,
    SecretValue,
    Stack,
    type StackProps,
    aws_ec2 as ec2,
    aws_rds as rds,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
    aws_sqs as sqs,
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
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_16,
            }),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
            allocatedStorage: 100,
            storageEncrypted: true,
            backupRetention: Duration.days(7),
            multiAz: false,
            databaseName: this.databaseName,
            deletionProtection: false,
            publiclyAccessible: false,
            removalPolicy: RemovalPolicy.DESTROY,
            autoMinorVersionUpgrade: true,
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
