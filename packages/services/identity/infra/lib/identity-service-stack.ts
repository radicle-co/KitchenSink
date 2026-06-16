import {
    CfnOutput,
    Duration,
    Fn,
    Stack,
    type StackProps,
    aws_certificatemanager as acm,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cloudwatch_actions,
    aws_ec2 as ec2,
    aws_ecr as ecr,
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elbv2,
    aws_iam as iam,
    aws_logs as logs,
    aws_rds as rds,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_s3 as s3,
    aws_secretsmanager as secretsmanager,
    aws_sns as sns,
    aws_sqs as sqs,
    aws_ssm as ssm,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export interface IdentityServiceStackProps extends StackProps {
    readonly stage: string;
    readonly domainName: string;
    readonly imageTag: string;
    readonly desiredCount: number;
    readonly vpcId: string;
}

/**
 * @implements REQ-018..REQ-026 REQ-032..REQ-038 REQ-050 FR-018..FR-026 FR-032..FR-038 FR-041..FR-044 ARCH-014..ARCH-019 ARCH-032 MOD-014..MOD-019 MOD-032
 */
export class IdentityServiceStack extends Stack {
    public readonly serviceUrl: string;

    public constructor(scope: Construct, id: string, props: IdentityServiceStackProps) {
        super(scope, id, props);

        const { stage, imageTag, desiredCount, vpcId, domainName } = props;

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
            vpcId,
        });

        const albSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedAlbSg',
            Fn.importValue(`kitchensink-network-${stage}:AlbSecurityGroupId`),
        );

        const serviceSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
            this,
            'ImportedServiceSg',
            Fn.importValue(`kitchensink-network-${stage}:ServiceSecurityGroupId`),
        );

        const dbCredentialsSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedDbSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${stage}:DatabaseSecretArn`),
        });

        const authSecretKey = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedAuthSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${stage}:SecretArn`),
        });

        const migrationPlanSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedMigrationSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${stage}:MigrationPlanSecretArn`),
        });

        const database = rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedDatabase', {
            instanceIdentifier: `kitchensink-identity-${stage}`,
            instanceEndpointAddress: Fn.importValue(`kitchensink-data-${stage}:DatabaseEndpoint`),
            port: Number(Fn.importValue(`kitchensink-data-${stage}:DatabasePort`)),
            securityGroups: [
                ec2.SecurityGroup.fromSecurityGroupId(
                    this,
                    'ImportedDbSg',
                    Fn.importValue(`kitchensink-network-${stage}:DatabaseSecurityGroupId`),
                ),
            ],
        });

        const deletionQueue = sqs.Queue.fromQueueArn(
            this,
            'ImportedDeletionQueue',
            Fn.importValue(`kitchensink-data-${stage}:DeletionQueueArn`),
        );

        const mediaBucket = s3.Bucket.fromBucketName(
            this,
            'ImportedMediaBucket',
            Fn.importValue(`kitchensink-data-${stage}:MediaBucketName`),
        );

        const archiveBucket = s3.Bucket.fromBucketName(
            this,
            'ImportedArchiveBucket',
            Fn.importValue(`kitchensink-data-${stage}:ArchiveBucketName`),
        );

        const repository = ecr.Repository.fromRepositoryName(this, 'IdentityServiceRepository', 'kitchensink-identity');

        const cluster = new ecs.Cluster(this, 'IdentityServiceCluster', {
            vpc,
            containerInsightsV2: ecs.ContainerInsights.ENHANCED,
        });

        const taskExecutionRole = new iam.Role(this, 'IdentityTaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });

        taskExecutionRole.addToPolicy(
            new iam.PolicyStatement({
                actions: ['secretsmanager:GetSecretValue'],
                resources: ['*'],
            }),
        );

        const taskRole = new iam.Role(this, 'IdentityTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for identity service',
        });

        dbCredentialsSecret.grantRead(taskRole);
        authSecretKey.grantRead(taskRole);
        migrationPlanSecret.grantRead(taskRole);
        deletionQueue.grantConsumeMessages(taskRole);
        mediaBucket.grantReadWrite(taskRole);
        archiveBucket.grantReadWrite(taskRole);

        const taskDefinition = new ecs.FargateTaskDefinition(this, 'IdentityTaskDefinition', {
            cpu: 512,
            memoryLimitMiB: 1024,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole,
        });

        const logGroup = new logs.LogGroup(this, 'IdentityServiceLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        taskDefinition.addContainer('IdentityServiceContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'identity-service',
                logGroup,
            }),
            environment: {
                NODE_ENV: 'production',
                PORT: '3000',
                // debug:auth flow tracing — on in sandbox, off in prod. Flip to '1' on the task def to
                // debug a prod signup/auth issue (no code change), then back to '0'.
                DEBUG_AUTH: stage === 'prod' ? '0' : '1',
                DB_HOST: database.dbInstanceEndpointAddress,
                DB_PORT: Fn.importValue(`kitchensink-data-${stage}:DatabasePort`),
                DB_NAME: Fn.importValue(`kitchensink-data-${stage}:DatabaseName`),
                DELETION_QUEUE_URL: deletionQueue.queueUrl,
                MEDIA_BUCKET_NAME: mediaBucket.bucketName,
                ARCHIVE_BUCKET_NAME: archiveBucket.bucketName,
                AUTH_SECRET_ARN: authSecretKey.secretArn,
                // Sentry config (U8). DSN value resolved from SSM at deploy (KTD6); STAGE drives the
                // Sentry environment; SENTRY_RELEASE = the image tag (commit SHA) so source maps
                // resolve against the same release the build uploaded (KTD7 / U11).
                STAGE: stage,
                // Stage-first SSM layout — `kitchensink/{stage}/{service}/{key}` — matching Secrets
                // Manager (`kitchensink/{stage}/identity/keys`).
                SENTRY_DSN: ssm.StringParameter.valueForStringParameter(
                    this,
                    `/kitchensink/${stage === 'prod' ? 'prod' : 'sandbox'}/sentry/identity-service-dsn`,
                ),
                SENTRY_TRACES_SAMPLE_RATE: stage === 'prod' ? '0.1' : '1.0',
                SENTRY_RELEASE: imageTag,
                // Clerk session-token verification (read-through auth, U1/U2). The JWT *public* key
                // and the authorized-parties allowlist are non-secret, resolved from SSM at deploy.
                // Prod reads prod params; every other stage reads the shared sandbox (dev-instance)
                // params. These SSM params must exist before deploy (operational prerequisite).
                CLERK_JWT_KEY: ssm.StringParameter.valueForStringParameter(
                    this,
                    `/kitchensink/${stage === 'prod' ? 'prod' : 'sandbox'}/clerk/jwt-public-key`,
                ),
                CLERK_AUTHORIZED_PARTIES: ssm.StringParameter.valueForStringParameter(
                    this,
                    `/kitchensink/${stage === 'prod' ? 'prod' : 'sandbox'}/clerk/authorized-parties`,
                ),
            },
            secrets: {
                DB_USERNAME: ecs.Secret.fromSecretsManager(dbCredentialsSecret, 'username'),
                DB_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentialsSecret, 'password'),
                AUTH_PUBLISHABLE_KEY: ecs.Secret.fromSecretsManager(authSecretKey, 'PUBLISHABLE_KEY'),
            },
            portMappings: [
                {
                    containerPort: 3000,
                },
            ],
            healthCheck: {
                command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
                interval: Duration.seconds(30),
                timeout: Duration.seconds(10),
                retries: 3,
                startPeriod: Duration.seconds(60),
            },
        });

        const service = new ecs.FargateService(this, 'IdentityService', {
            cluster,
            taskDefinition,
            desiredCount,
            assignPublicIp: false,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [serviceSecurityGroup],
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(120),
            circuitBreaker: {
                rollback: true,
            },
        });

        const scalableTarget = service.autoScaleTaskCount({
            minCapacity: 1,
            maxCapacity: 6,
        });
        scalableTarget.scaleOnCpuUtilization('IdentityServiceCpuScaling', {
            targetUtilizationPercent: 60,
            scaleInCooldown: Duration.minutes(2),
            scaleOutCooldown: Duration.minutes(1),
        });

        const isProd = stage === 'prod';
        const subdomain = isProd ? 'identity' : `identity.${stage}`;
        const serviceDomain = `${subdomain}.${domainName}`;

        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-domain-${stage}:HostedZoneId`),
            zoneName: domainName,
        });

        const certificate = acm.Certificate.fromCertificateArn(
            this,
            'ImportedCertificate',
            Fn.importValue(`kitchensink-domain-${stage}:CertificateArn`),
        );

        const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'IdentityServiceAlb', {
            vpc,
            internetFacing: true,
            securityGroup: albSecurityGroup,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
        });

        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'IdentityServiceTargets', {
            vpc,
            port: 3000,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            targets: [service.loadBalancerTarget({ containerName: 'IdentityServiceContainer', containerPort: 3000 })],
            healthCheck: {
                enabled: true,
                path: '/health',
                healthyHttpCodes: '200',
                interval: Duration.seconds(30),
                timeout: Duration.seconds(10),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 10,
            },
        });

        const httpsListener = loadBalancer.addListener('IdentityServiceHttpsListener', {
            port: 443,
            certificates: [certificate],
            open: true,
        });
        httpsListener.addTargetGroups('IdentityServiceHttpsTargetGroup', {
            targetGroups: [targetGroup],
        });

        const httpListener = loadBalancer.addListener('IdentityServiceListener', {
            port: 80,
            open: true,
        });
        httpListener.addAction('HttpRedirect', {
            action: elbv2.ListenerAction.redirect({
                protocol: 'HTTPS',
                port: '443',
                permanent: true,
            }),
        });

        new route53.ARecord(this, 'IdentityServiceAliasRecord', {
            zone: hostedZone,
            recordName: subdomain,
            target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(loadBalancer)),
        });

        this.serviceUrl = `https://${serviceDomain}`;

        // A4: alarms previously had no action wired, so they fired silently. Route all of them to an
        // SNS topic so they actually notify (subscriptions managed out-of-band per stage).
        const alarmTopic = new sns.Topic(this, 'IdentityAlarmTopic', {
            displayName: `Identity service alarms (${stage})`,
        });
        const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);

        const alb5xxAlarm = new cloudwatch.Alarm(this, 'IdentityAlb5xxAlarm', {
            metric: loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
                period: Duration.minutes(5),
                statistic: 'sum',
            }),
            threshold: 5,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            alarmDescription: 'Identity ALB target 5xx alarm',
        });
        alb5xxAlarm.addAlarmAction(alarmAction);

        const highCpuAlarm = new cloudwatch.Alarm(this, 'IdentityServiceHighCpuAlarm', {
            metric: service.metricCpuUtilization({
                period: Duration.minutes(5),
                statistic: 'avg',
            }),
            threshold: 80,
            evaluationPeriods: 2,
            datapointsToAlarm: 2,
            alarmDescription: 'Identity ECS CPU high-water mark',
        });
        highCpuAlarm.addAlarmAction(alarmAction);

        // A4: boot crash-loop detector. A NestJS DI/boot failure crash-loops the task, which never
        // passes the ALB health check, so HealthyHostCount sits at 0 — directly observable here,
        // unlike a Sentry issue (the process can die before Sentry flushes). treatMissingData=BREACHING
        // because "no datapoints" during a crash-loop is itself the failure, not an absence of signal.
        const crashLoopAlarm = new cloudwatch.Alarm(this, 'IdentityServiceCrashLoopAlarm', {
            metric: targetGroup.metrics.healthyHostCount({
                period: Duration.minutes(1),
                statistic: 'min',
            }),
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
            threshold: 1,
            evaluationPeriods: 3,
            datapointsToAlarm: 3,
            treatMissingData: cloudwatch.TreatMissingData.BREACHING,
            alarmDescription: 'Identity ECS has no healthy targets (boot crash-loop / unhealthy tasks)',
        });
        crashLoopAlarm.addAlarmAction(alarmAction);

        new CfnOutput(this, 'IdentityEcrRepositoryUri', {
            value: repository.repositoryUri,
            exportName: `${this.stackName}:IdentityEcrRepositoryUri`,
        });
        new CfnOutput(this, 'IdentityClusterArn', {
            value: cluster.clusterArn,
            exportName: `${this.stackName}:IdentityClusterArn`,
        });
        new CfnOutput(this, 'IdentityServiceArn', {
            value: service.serviceArn,
            exportName: `${this.stackName}:IdentityServiceArn`,
        });
        new CfnOutput(this, 'IdentityTaskExecutionRoleArn', {
            value: taskExecutionRole.roleArn,
            exportName: `${this.stackName}:IdentityTaskExecutionRoleArn`,
        });
        new CfnOutput(this, 'IdentityTaskRoleArn', {
            value: taskRole.roleArn,
            exportName: `${this.stackName}:IdentityTaskRoleArn`,
        });
        new CfnOutput(this, 'IdentityAlbArn', {
            value: loadBalancer.loadBalancerArn,
            exportName: `${this.stackName}:IdentityAlbArn`,
        });
        new CfnOutput(this, 'IdentityAlbDnsName', {
            value: loadBalancer.loadBalancerDnsName,
            exportName: `${this.stackName}:IdentityAlbDnsName`,
        });
        new CfnOutput(this, 'IdentityAlbListenerArn', {
            value: httpsListener.listenerArn,
            exportName: `${this.stackName}:IdentityAlbListenerArn`,
        });
        new CfnOutput(this, 'IdentityAlbTargetGroupArn', {
            value: targetGroup.targetGroupArn,
            exportName: `${this.stackName}:IdentityAlbTargetGroupArn`,
        });
        new CfnOutput(this, 'IdentityServiceLogGroupName', {
            value: logGroup.logGroupName,
            exportName: `${this.stackName}:IdentityServiceLogGroupName`,
        });
        new CfnOutput(this, 'IdentityServiceUrl', {
            value: this.serviceUrl,
            exportName: `${this.stackName}:IdentityServiceUrl`,
        });
    }
}
