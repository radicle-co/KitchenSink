import {
    CfnOutput,
    Duration,
    Fn,
    Stack,
    type StackProps,
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

import { BASE_LISTENER_PRIORITY } from '@kitchensink/infra-alb';
import { AcceptedNagFindings, acceptNagFindings } from '@kitchensink/infra-security';

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

        // Fargate Spot for non-prod (ADR-0008). Prod runs on-demand `FARGATE` (unchanged → no prod
        // diff); every non-prod stage (sandbox) runs interruption-tolerant `FARGATE_SPOT`. The cluster
        // must advertise the FARGATE_SPOT capacity provider before a service strategy can bind to it,
        // so the cluster flag and the service strategy are gated together on the same stage check.
        const useSpot = stage !== 'prod';
        const capacityProviderStrategies = useSpot ? [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }] : undefined;

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

        // The data stack imports this secret by NAME (`fromSecretNameV2`) and exports its name-based,
        // suffix-LESS ARN — unlike the DB/migration secrets, which are CDK-created and export the full
        // ARN with the random `-XXXXXX` suffix. Import it as a PARTIAL ARN so `grantRead` (and the ecs
        // `Secret.fromSecretsManager` execution-role grant) append the `-??????` wildcard. A
        // `secretCompleteArn` here writes an exact policy for the suffix-less ARN, which never matches
        // the secret's real ARN — so the task can't fetch it, the container never starts, and every
        // deploy hangs on ECS "NotStabilized" then rolls back.
        const authSecretKey = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedAuthSecret', {
            secretPartialArn: Fn.importValue(`kitchensink-data-${stage}:SecretArn`),
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

        // The global handle-sync topic (W8-a.2): identity publishes a rename here on PATCH /api/v1/users/me.
        const handleSyncTopic = sns.Topic.fromTopicArn(
            this,
            'ImportedHandleSyncTopic',
            Fn.importValue(`kitchensink-data-${stage}:HandleSyncTopicArn`),
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
            // Per-stage observability depth (ADR-0007). Prod keeps ENHANCED (unchanged → no prod diff);
            // non-prod stages drop to the STANDARD tier — `ENABLED` (CFN `enabled`) is base Container
            // Insights, priced well below the ENHANCED tier.
            containerInsightsV2: stage === 'prod' ? ecs.ContainerInsights.ENHANCED : ecs.ContainerInsights.ENABLED,
            // ADR-0008: advertise the FARGATE_SPOT capacity provider for non-prod only. `false` (prod)
            // creates no ClusterCapacityProviderAssociations resource, so the prod template is unchanged.
            enableFargateCapacityProviders: useSpot,
        });

        const taskExecutionRole = new iam.Role(this, 'IdentityTaskExecutionRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });

        // ARCH-IT-4: no manual `secretsmanager:GetSecretValue` on `*` here. The execution role only
        // needs to read the secrets referenced by the container `secrets:` block (the DB creds and the
        // auth publishable key), and `ecs.Secret.fromSecretsManager` already grants the execution role
        // `GetSecretValue` scoped to those exact secret ARNs. A wildcard statement would let this task
        // read EVERY secret in the account, so it is omitted (verified against the synthesized policy).

        const taskRole = new iam.Role(this, 'IdentityTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for identity service',
        });

        dbCredentialsSecret.grantRead(taskRole);
        authSecretKey.grantRead(taskRole);
        migrationPlanSecret.grantRead(taskRole);
        // SEND, not consume. This service is a pure PRODUCER on the deletion queue: `queue/sqs.service.ts`
        // imports exactly one command (`SendMessageCommand`) and nothing in `src/` ever receives — the
        // deletion-WORKER Lambda is the consumer, and it holds its own `grantConsumeMessages` over in the
        // webhooks stack.
        //
        // ⚠️ This line read `grantConsumeMessages` and shipped that way. `grantConsumeMessages` confers
        // ReceiveMessage/DeleteMessage/ChangeMessageVisibility and NOT SendMessage, so the task held only dead
        // permission on a queue it exclusively writes to, and every enqueue was an AccessDenied — confirmed on
        // the deployed sandbox role. Because both call sites (`users.service.ts` closure, `admin.service.ts`
        // reactivation) await the enqueue inside a swallow that logs a warning, the API still answered 200:
        // account closure never BANNED the Clerk identity and reactivation never UNBANNED it, so a reactivated
        // user stayed locked out of an account the database said was active. A security control that fails into
        // logger.warn is indistinguishable from one that works, which is why nobody noticed.
        //
        // `service-infra-wiring-invariants.test.ts` (W1) now derives this: a queue whose URL is injected into a
        // deployed environment must be granted the operations that code's SQS commands require.
        deletionQueue.grantSendMessages(taskRole);
        handleSyncTopic.grantPublish(taskRole);
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

        // AwsSolutions-ECS2 accepted: every plaintext container Environment entry here is non-secret, and
        // every real secret is injected via ecs.Secret.fromSecretsManager (i.e. under Secrets, not
        // Environment). Justification -- including the invariant it depends on -- in
        // @kitchensink/infra-security.
        acceptNagFindings(taskDefinition, AcceptedNagFindings.TASK_ENVIRONMENT_HOLDS_NO_SECRET);

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
                HANDLE_SYNC_TOPIC_ARN: handleSyncTopic.topicArn,
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
                // Stage-gated azp enforcement (ADR-0001). PROD: exact-match list. NON-PROD (sandbox): the
                // self-owned anchored pattern for per-PR preview subdomains, with the preview MODE
                // (`strict` | `transition`) resolved from SSM so the cutover + rollback is an SSM change +
                // task restart, not a code deploy. Exactly one mode per stage (config contract), so prod
                // gets ONLY the list and non-prod ONLY the pattern pair. Params must exist before deploy.
                ...(stage === 'prod'
                    ? {
                          CLERK_AUTHORIZED_PARTIES: ssm.StringParameter.valueForStringParameter(
                              this,
                              `/kitchensink/prod/clerk/authorized-parties`,
                          ),
                      }
                    : {
                          CLERK_AZP_PATTERN: ssm.StringParameter.valueForStringParameter(
                              this,
                              `/kitchensink/sandbox/clerk/azp-pattern`,
                          ),
                          CLERK_AZP_PREVIEW_MODE: ssm.StringParameter.valueForStringParameter(
                              this,
                              `/kitchensink/sandbox/clerk/azp-preview-mode`,
                          ),
                          // Non-prod runs pattern mode, which rejects azp-less native (@clerk/expo) tokens
                          // unless the native-admission gate is on. The mobile app authenticates against the
                          // shared sandbox identity, so admit its `client_type: 'native'` tokens. Prod stays
                          // list mode, which already skips the azp check on absent azp — so prod needs no flag
                          // and its template stays byte-identical.
                          CLERK_ADMIT_NATIVE_CLIENT: 'true',
                      }),
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
            // ADR-0008: non-prod runs on FARGATE_SPOT (undefined for prod keeps on-demand LaunchType
            // FARGATE → no prod diff). Providing a strategy omits LaunchType from the service resource.
            capacityProviderStrategies,
            // Public subnet + public IP so the task egresses to Clerk/AWS via the Internet Gateway
            // (free) instead of the NAT. Inbound stays locked to the ALB SG (serviceSecurityGroup),
            // so the public IP is egress-only; the task still reaches the private RDS intra-VPC by SG.
            // This keeps the NAT serving ONLY the DB-bound webhook lambdas (minimize-nat).
            assignPublicIp: true,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
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

        // NOTE: a target group cannot be MOVED between load balancers — attaching an existing TG to a
        // second LB fails with "target groups cannot be associated with more than one load balancer".
        // Migrating identity from its own ALB to the shared ALB therefore requires a NEW TG (new logical
        // id 'IdentityServiceSharedTargets', replacing the old 'IdentityServiceTargets'): CloudFormation
        // creates the fresh TG on the shared ALB and deletes the old TG with the old ALB. Do not rename
        // back to the old id while any stage still has the pre-shared-ALB topology deployed.
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'IdentityServiceSharedTargets', {
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

        // Shared per-stage ALB (owned by the global infra — kitchensink-alb-${stage}). This service
        // does NOT create its own ALB; it imports the shared HTTPS listener and adds a host-based rule
        // for its subdomain. See docs/architecture/decisions/0003-shared-alb-per-stage.md.
        const sharedHttpsListener = elbv2.ApplicationListener.fromApplicationListenerAttributes(
            this,
            'SharedHttpsListener',
            {
                listenerArn: Fn.importValue(`kitchensink-alb-${stage}:SharedAlbHttpsListenerArn`),
                securityGroup: albSecurityGroup,
            },
        );

        // Listener-rule priorities are ONE namespace shared across every service's stack on this stage's
        // single HTTPS listener, owned by @kitchensink/infra-alb (ADR-0003). Identity reads its BASE priority
        // directly and never calls the stage resolver, because it has no ephemeral variant: it is the ONE
        // shared persistent service every per-PR preview signs in against, so `stage` is always a base stage
        // here (note the `kitchensink-alb-${stage}` import above, not `${baseStage}`). Its ephemeral band is
        // reserved in the registry and deliberately unused.
        new elbv2.ApplicationListenerRule(this, 'IdentityServiceListenerRule', {
            listener: sharedHttpsListener,
            priority: BASE_LISTENER_PRIORITY.identity,
            conditions: [elbv2.ListenerCondition.hostHeaders([serviceDomain])],
            targetGroups: [targetGroup],
        });

        const sharedAlb = elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, 'SharedAlb', {
            loadBalancerArn: Fn.importValue(`kitchensink-alb-${stage}:SharedAlbArn`),
            securityGroupId: Fn.importValue(`kitchensink-network-${stage}:AlbSecurityGroupId`),
            loadBalancerDnsName: Fn.importValue(`kitchensink-alb-${stage}:SharedAlbDnsName`),
            loadBalancerCanonicalHostedZoneId: Fn.importValue(
                `kitchensink-alb-${stage}:SharedAlbCanonicalHostedZoneId`,
            ),
        });

        new route53.ARecord(this, 'IdentityServiceAliasRecord', {
            zone: hostedZone,
            recordName: subdomain,
            target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(sharedAlb)),
        });

        this.serviceUrl = `https://${serviceDomain}`;

        // A4: alarms previously had no action wired, so they fired silently. Route all of them to an
        // SNS topic so they actually notify (subscriptions managed out-of-band per stage).
        const alarmTopic = new sns.Topic(this, 'IdentityAlarmTopic', {
            enforceSSL: true,
            displayName: `Identity service alarms (${stage})`,
        });
        const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);

        // Per-service 5xx on the shared ALB. The ALB-level metric would now aggregate every service's
        // 5xx, so this scopes to the identity target group's target 5xx count instead.
        const alb5xxAlarm = new cloudwatch.Alarm(this, 'IdentityAlb5xxAlarm', {
            metric: targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
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
