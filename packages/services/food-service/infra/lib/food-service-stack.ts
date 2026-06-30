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
    aws_events as events,
    aws_events_targets as targets,
    aws_iam as iam,
    aws_lambda as lambda,
    aws_logs as logs,
    aws_rds as rds,
    aws_route53 as route53,
    aws_route53_targets as route53_targets,
    aws_secretsmanager as secretsmanager,
    aws_sns as sns,
} from 'aws-cdk-lib';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Construct } from 'constructs';

/**
 * Canonical food worker metric names — MUST stay byte-identical to `src/observability/emf-metrics.ts`
 * `FOOD_METRIC` (the worker emits these EMF metric names; the dashboard charts and the alarms alarm on
 * them). A CDK test cross-checks these against the exported source constants so the two cannot drift.
 */
const FOOD_METRIC_NAMESPACE = 'Commise/Food';
const FOOD_METRIC = {
    fetchQueueDepth: 'food-fetch-queue-depth',
    resolutionLatencySeconds: 'food-resolution-latency-seconds',
    sourceRollingWindowCount: 'source-rolling-window-count',
    unresolvedBacklog: 'food-unresolved-backlog',
    tombstoneCount: 'food-tombstone-count',
    pendingAgeSeconds: 'food-fetch-pending-age-seconds',
    inFlightLeases: 'food-in-flight-leases',
    workerErrorCount: 'food-worker-error-count',
} as const;

/** Props for {@link FoodServiceStack}. */
export interface FoodServiceStackProps extends StackProps {
    /** Deploy stage (`prod`, `sandbox-*`, `pr-{N}`, …). */
    readonly stage: string;
    /** Apex domain for the service's `food[.stage].{domain}` record. */
    readonly domainName: string;
    /** Container image tag (commit SHA) for the API and worker tasks. */
    readonly imageTag: string;
    /** Desired count for the ALB-fronted API service. */
    readonly desiredCount: number;
    /** Desired count for the Fargate fetch worker (FR-022: exactly one consumer at MVP). */
    readonly workerDesiredCount: number;
    /** Shared VPC id to import. */
    readonly vpcId: string;
    /**
     * Source API credential for the fetch/refresh workloads (`USDA_API_KEY`). FLAG: this is a secret
     * but there is no Secrets Manager seam for source credentials yet, so it is wired as plaintext
     * container env from the deploy environment. Before a real key is used this MUST move to
     * `ecs.Secret.fromSecretsManager` (like the DB creds) so it never lands in the template.
     */
    readonly usdaApiKey?: string;
    /** Optional UNRESOLVED-candidate TTL (days) for the change-refresh task (`FOOD_UNRESOLVED_TTL_DAYS`). */
    readonly unresolvedTtlDays?: number;
}

/**
 * Food service infrastructure (feature 003).
 *
 * Mirrors `IdentityServiceStack`: an ECS/Fargate NestJS service fronted by the shared per-stage ALB
 * (owned by the global infra) via a host-based listener rule. Additionally defines the **Fargate
 * consumer worker** (single desired count — the Postgres `fetch_queue` is the demand queue, so there
 * is NO SQS), the **change-refresh Fargate scheduled task** (EventBridge → ECS `RunTask`, T-001c), the
 * **in-VPC migration-runner Lambda** (T-191), and the food **observability** surface (EMF-backed
 * dashboard + alarms). It does NOT create an RDS instance — it `Fn.importValue`s the shared
 * `kitchensink-data-{stage}` exports plus `:FoodDbSecretArn` / `:FoodDatabaseName` and connects to the
 * `kitchensink_food` database.
 *
 * Subnet placement (ADR-0004): the API + worker + change-refresh Fargate workloads run in PUBLIC
 * subnets with `assignPublicIp` (egress to USDA/AWS via the IGW, inbound locked to the service SG). The
 * migration-runner Lambda is the ONLY food workload on the NAT (a VPC Lambda cannot egress via a public
 * IP, and it must reach the private RDS).
 *
 * @implements ARCH-001 FR-022 FR-031 FR-032 FR-046 FR-048 SC-002 SC-006
 */
export class FoodServiceStack extends Stack {
    /** Public HTTPS URL of the food API. */
    public readonly serviceUrl: string;
    /** ECS service name of the Fargate fetch worker (exported for ops/deploy tooling). */
    public readonly foodFetchWorkerServiceName: string;

    public constructor(scope: Construct, id: string, props: FoodServiceStackProps) {
        super(scope, id, props);

        const { stage, imageTag, desiredCount, workerDesiredCount, vpcId, domainName } = props;

        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { vpcId });

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

        // Shared DB connection secret (instance master) + the dedicated least-privilege food role
        // secret (T-001b). NO RDS is created here — the instance is owned by the global DataStack.
        const sharedDbSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedDbSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${stage}:DatabaseSecretArn`),
        });

        const foodDbSecret = secretsmanager.Secret.fromSecretAttributes(this, 'ImportedFoodDbSecret', {
            secretCompleteArn: Fn.importValue(`kitchensink-data-${stage}:FoodDbSecretArn`),
        });

        const database = rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, 'ImportedDatabase', {
            instanceIdentifier: `kitchensink-data-${stage}`,
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

        const repository = ecr.Repository.fromRepositoryName(this, 'FoodServiceRepository', 'kitchensink-food');

        const cluster = new ecs.Cluster(this, 'FoodServiceCluster', {
            vpc,
            containerInsightsV2: ecs.ContainerInsights.ENHANCED,
        });

        const taskExecutionRole = new iam.Role(this, 'FoodTaskExecutionRole', {
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

        // EventBridge bus the worker uses to signal fetch lifecycle (no SQS). The completion event
        // (`FoodFetchCompleted`) is still emitted as part of the event contract for future consumers;
        // there is deliberately NO rule consumer on the bus right now (the prior search-indexer rule
        // was removed — T-180 ships search_vector as a STORED generated column, so no indexer is needed).
        const eventBus = new events.EventBus(this, 'FoodEventBus', {
            eventBusName: `kitchensink-food-${stage}`,
        });

        const foodDbEnvironment: Record<string, string> = {
            NODE_ENV: 'production',
            STAGE: stage,
            DB_HOST: database.dbInstanceEndpointAddress,
            DB_PORT: Fn.importValue(`kitchensink-data-${stage}:DatabasePort`),
            DB_NAME: Fn.importValue(`kitchensink-data-${stage}:FoodDatabaseName`),
            FOOD_EVENT_BUS_NAME: eventBus.eventBusName,
        };

        // FLAG (see props.usdaApiKey): source credentials wired as plaintext container env. The Nest app
        // env validation requires USDA_API_KEY (config/env.schema.ts) and both the worker and the
        // change-refresh entrypoint THROW without it, so all three containers receive it. Move to a
        // Secrets Manager `ecs.Secret` before a real key ships.
        const sourceCredentialsEnvironment: Record<string, string> = {
            USDA_API_KEY: props.usdaApiKey ?? '',
        };

        const foodDbSecrets = {
            DB_USERNAME: ecs.Secret.fromSecretsManager(foodDbSecret, 'username'),
            DB_PASSWORD: ecs.Secret.fromSecretsManager(foodDbSecret, 'password'),
        };

        // ── API service (ECS/Fargate behind the shared ALB) ─────────────────────────────────────
        const apiTaskRole = new iam.Role(this, 'FoodApiTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for the food API',
        });
        sharedDbSecret.grantRead(apiTaskRole);
        foodDbSecret.grantRead(apiTaskRole);
        eventBus.grantPutEventsTo(apiTaskRole);

        const apiTaskDefinition = new ecs.FargateTaskDefinition(this, 'FoodApiTaskDefinition', {
            cpu: 512,
            memoryLimitMiB: 1024,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole: apiTaskRole,
        });

        const apiLogGroup = new logs.LogGroup(this, 'FoodApiLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        apiTaskDefinition.addContainer('FoodApiContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'food-service', logGroup: apiLogGroup }),
            environment: { ...foodDbEnvironment, ...sourceCredentialsEnvironment, PORT: '3000' },
            secrets: foodDbSecrets,
            command: ['node', 'dist/main.js'],
            portMappings: [{ containerPort: 3000 }],
            healthCheck: {
                command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
                interval: Duration.seconds(30),
                timeout: Duration.seconds(10),
                retries: 3,
                startPeriod: Duration.seconds(60),
            },
        });

        const apiService = new ecs.FargateService(this, 'FoodApiService', {
            cluster,
            taskDefinition: apiTaskDefinition,
            desiredCount,
            // Public subnet + public IP so the task egresses to USDA/AWS via the Internet Gateway (free)
            // instead of the NAT. Inbound stays locked to the ALB SG (serviceSecurityGroup), so the
            // public IP is egress-only; the task still reaches the private RDS intra-VPC by SG. This
            // keeps the NAT serving ONLY the migration-runner Lambda (ADR-0004 minimize-nat).
            assignPublicIp: true,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [serviceSecurityGroup],
            minHealthyPercent: 50,
            maxHealthyPercent: 200,
            healthCheckGracePeriod: Duration.seconds(120),
            circuitBreaker: { rollback: true },
        });

        // ── Fargate consumer worker (single desired count; LISTEN/NOTIFY drain loop) ─────────────
        const workerTaskRole = new iam.Role(this, 'FoodWorkerTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for the food fetch worker',
        });
        sharedDbSecret.grantRead(workerTaskRole);
        foodDbSecret.grantRead(workerTaskRole);
        eventBus.grantPutEventsTo(workerTaskRole);

        const workerTaskDefinition = new ecs.FargateTaskDefinition(this, 'FoodWorkerTaskDefinition', {
            cpu: 256,
            memoryLimitMiB: 512,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole: workerTaskRole,
        });

        const workerLogGroup = new logs.LogGroup(this, 'FoodWorkerLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        workerTaskDefinition.addContainer('FoodWorkerContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'food-worker', logGroup: workerLogGroup }),
            environment: { ...foodDbEnvironment, ...sourceCredentialsEnvironment, FOOD_WORKER: '1' },
            secrets: foodDbSecrets,
            command: ['node', 'dist/worker/main.js'],
        });

        const workerService = new ecs.FargateService(this, 'FoodFetchWorkerService', {
            cluster,
            taskDefinition: workerTaskDefinition,
            // FR-022: exactly one consumer holds the LISTEN connection at MVP.
            desiredCount: workerDesiredCount,
            // Public subnet + public IP (egress-only, inbound SG-locked) — IGW egress off the NAT path,
            // intra-VPC reach to the private RDS by SG (ADR-0004), same as the API service above.
            assignPublicIp: true,
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [serviceSecurityGroup],
            // A rolling deploy must not run two consumers; keep at most one task during deploys.
            minHealthyPercent: 0,
            maxHealthyPercent: 100,
        });
        this.foodFetchWorkerServiceName = workerService.serviceName;

        // ── Change-refresh Fargate scheduled task (T-001c / D-REFRESH) ──────────────────────────
        // An EventBridge schedule → ECS `RunTask` of a dedicated task definition running the
        // change-refresh entrypoint (`runOnce()` then exit). This is NOT a long-running ECS *service*
        // (RunTask uses only a task def), so the "exactly 2 ECS services" invariant still holds.
        const changeRefreshTaskRole = new iam.Role(this, 'FoodChangeRefreshTaskRole', {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'Least-privilege runtime role for the change-refresh scheduled task (T-053)',
        });
        sharedDbSecret.grantRead(changeRefreshTaskRole);
        foodDbSecret.grantRead(changeRefreshTaskRole);
        // T-053: this named role is the only refresh-path principal allowed to PutEvents on the bus.
        eventBus.grantPutEventsTo(changeRefreshTaskRole);

        const changeRefreshTaskDefinition = new ecs.FargateTaskDefinition(this, 'FoodChangeRefreshTaskDefinition', {
            cpu: 256,
            memoryLimitMiB: 512,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
            executionRole: taskExecutionRole,
            taskRole: changeRefreshTaskRole,
        });

        const changeRefreshLogGroup = new logs.LogGroup(this, 'FoodChangeRefreshLogGroup', {
            retention: logs.RetentionDays.ONE_MONTH,
        });

        const changeRefreshEnvironment: Record<string, string> = {
            ...foodDbEnvironment,
            ...sourceCredentialsEnvironment,
        };

        if (props.unresolvedTtlDays !== undefined) {
            changeRefreshEnvironment.FOOD_UNRESOLVED_TTL_DAYS = String(props.unresolvedTtlDays);
        }

        changeRefreshTaskDefinition.addContainer('FoodChangeRefreshContainer', {
            image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
            logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'food-change-refresh', logGroup: changeRefreshLogGroup }),
            environment: changeRefreshEnvironment,
            secrets: foodDbSecrets,
            command: ['node', 'dist/worker/change-refresh/main.js'],
        });

        // D-REFRESH is explicitly low-priority idle-drain background work that yields to live demand
        // (no fixed-cadence promise). Every 6 hours is frequent enough to pick up upstream changes
        // without competing with the demand-driven fetch path.
        new events.Rule(this, 'IngestionScheduled', {
            description:
                'Change-refresh: re-enqueue RESOLVED foods for a selective in-place re-pull (FR-032, D-REFRESH)',
            schedule: events.Schedule.rate(Duration.hours(6)),
            targets: [
                new targets.EcsTask({
                    cluster,
                    taskDefinition: changeRefreshTaskDefinition,
                    taskCount: 1,
                    // ADR-0004: Fargate egress to USDA via the IGW (public subnet + public IP); inbound
                    // SG-locked (egress-only). Reaches the private RDS intra-VPC by SG.
                    subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
                    assignPublicIp: true,
                    securityGroups: [serviceSecurityGroup],
                }),
            ],
        });

        // ── In-VPC migration-runner Lambda (T-191 / FU-MIGRATE) ─────────────────────────────────
        // The RDS instance is PRIVATE_ISOLATED, so the deploy pipeline invokes this VPC-attached Lambda
        // to apply the ordered SQL against kitchensink_food. It is the ONLY food workload on the NAT (a
        // VPC Lambda's public IP does NOT give egress — ADR-0004 — and it must reach the private RDS).
        // Asset: esbuild bundles to dist-lambda/ (npm run bundle:lambda, run by infra:synth/deploy).
        // Synth must not fail when the asset is absent (e.g. a bare `cdk synth`), so fall back to an
        // inline placeholder when dist-lambda/ has not been built — the real deploy always builds it.
        const lambdaAssetDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist-lambda');
        const migrationCode = existsSync(lambdaAssetDir)
            ? lambda.Code.fromAsset(lambdaAssetDir)
            : lambda.Code.fromInline('export const handler = async () => ({ ok: false, reason: "asset-not-built" });');

        const migrationFn = new lambda.Function(this, 'FoodMigrationFunction', {
            runtime: lambda.Runtime.NODEJS_22_X,
            architecture: lambda.Architecture.ARM_64,
            handler: 'lambdas/migrate/handler.handler',
            code: migrationCode,
            timeout: Duration.seconds(300),
            memorySize: 512,
            environment: {
                STAGE: stage,
                FOOD_DB_SECRET_ARN: foodDbSecret.secretArn,
                FOOD_DB_ENDPOINT: database.dbInstanceEndpointAddress,
                FOOD_DB_PORT: Fn.importValue(`kitchensink-data-${stage}:DatabasePort`),
                FOOD_DB_NAME: Fn.importValue(`kitchensink-data-${stage}:FoodDatabaseName`),
            },
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [serviceSecurityGroup],
        });
        foodDbSecret.grantRead(migrationFn);

        // ── Shared ALB host-rule + DNS (mirrors identity) ───────────────────────────────────────
        // This service does NOT create its own ALB. It imports the shared per-stage ALB's HTTPS
        // listener (owned by the global infra — kitchensink-alb-${stage}) and attaches a host-based
        // rule for its subdomain. See docs/architecture/decisions/0003-shared-alb-per-stage.md.
        const isProd = stage === 'prod';
        const subdomain = isProd ? 'food' : `food.${stage}`;
        const serviceDomain = `${subdomain}.${domainName}`;

        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
            hostedZoneId: Fn.importValue(`kitchensink-domain-${stage}:HostedZoneId`),
            zoneName: domainName,
        });

        // Named '…SharedTargets' to match identity's shared-ALB convention (a TG belongs to exactly one
        // load balancer — the shared ALB — and cannot be moved). See identity-service-stack.ts.
        const targetGroup = new elbv2.ApplicationTargetGroup(this, 'FoodServiceSharedTargets', {
            vpc,
            port: 3000,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            targets: [apiService.loadBalancerTarget({ containerName: 'FoodApiContainer', containerPort: 3000 })],
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

        const sharedHttpsListener = elbv2.ApplicationListener.fromApplicationListenerAttributes(
            this,
            'SharedHttpsListener',
            {
                listenerArn: Fn.importValue(`kitchensink-alb-${stage}:SharedAlbHttpsListenerArn`),
                securityGroup: albSecurityGroup,
            },
        );

        // Per-service listener-rule priority allocation: identity=100, food=200. Future services pick
        // 300, 400, … (priorities must be unique across all rules on the shared listener).
        new elbv2.ApplicationListenerRule(this, 'FoodServiceListenerRule', {
            listener: sharedHttpsListener,
            priority: 200,
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

        new route53.ARecord(this, 'FoodServiceAliasRecord', {
            zone: hostedZone,
            recordName: subdomain,
            target: route53.RecordTarget.fromAlias(new route53_targets.LoadBalancerTarget(sharedAlb)),
        });

        this.serviceUrl = `https://${serviceDomain}`;

        // ── Observability: SNS + alarms (T-183) + dashboard (T-182) ─────────────────────────────
        // Food-specific alarms read the EMF metrics the worker emits (Commise/Food namespace, no extra
        // IAM — CloudWatch auto-extracts from the worker log group). The API 5xx alarm uses the
        // TARGET-group 5xx (per ADR-0003 §Decision-5; the shared ALB's own 5xx is now multi-tenant).
        const alarmTopic = new sns.Topic(this, 'FoodAlarmTopic', {
            displayName: `Food service alarms (${stage})`,
        });
        const alarmAction = new cloudwatch_actions.SnsAction(alarmTopic);

        const emfMetric = (metricName: string, statistic: string): cloudwatch.Metric =>
            new cloudwatch.Metric({
                namespace: FOOD_METRIC_NAMESPACE,
                metricName,
                period: Duration.minutes(5),
                statistic,
            });

        // Any tombstone (NOT_FOUND/FAILED) row is worth a look — alarm at > 0 (DSN-9 / FR-016).
        const tombstoneAlarm = new cloudwatch.Alarm(this, 'FoodTombstoneAlarm', {
            metric: emfMetric(FOOD_METRIC.tombstoneCount, 'max'),
            threshold: 0,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'Food has tombstone (NOT_FOUND/FAILED) rows',
        });
        tombstoneAlarm.addAlarmAction(alarmAction);

        // API error rate > 5% — target-group target 5xx over request count (ADR-0003). Division by a
        // zero request count yields no datapoint (no traffic → no alarm), treated as not-breaching.
        const target5xx = targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
            period: Duration.minutes(5),
            statistic: 'sum',
        });
        const requestCount = targetGroup.metrics.requestCount({ period: Duration.minutes(5), statistic: 'sum' });
        const apiErrorRate = new cloudwatch.MathExpression({
            expression: '100 * (errors / requests)',
            usingMetrics: { errors: target5xx, requests: requestCount },
            period: Duration.minutes(5),
            label: 'API 5xx error rate (%)',
        });
        const apiErrorRateAlarm = new cloudwatch.Alarm(this, 'FoodApiErrorRateAlarm', {
            metric: apiErrorRate,
            threshold: 5,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'Food API target 5xx error rate > 5%',
        });
        apiErrorRateAlarm.addAlarmAction(alarmAction);

        // fetch_queue backpressure: pending depth > 10,000 (FR-046).
        const queueDepthAlarm = new cloudwatch.Alarm(this, 'FoodQueueDepthAlarm', {
            metric: emfMetric(FOOD_METRIC.fetchQueueDepth, 'max'),
            threshold: 10_000,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'Food fetch_queue pending depth > 10,000 (FR-046 backpressure)',
        });
        queueDepthAlarm.addAlarmAction(alarmAction);

        // Freshness: the oldest pending row's first_requested age > 5 min (demand not being drained).
        const pendingAgeAlarm = new cloudwatch.Alarm(this, 'FoodPendingAgeAlarm', {
            metric: emfMetric(FOOD_METRIC.pendingAgeSeconds, 'max'),
            threshold: 300,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: 'Oldest pending fetch_queue row older than 5 minutes',
        });
        pendingAgeAlarm.addAlarmAction(alarmAction);

        // Dashboard (T-182). Per-stage name; ephemeral (pr-{N}) stages carry the pr-{N} prefix so the
        // PR-close name sweep catches it (ADR-0005); prod keeps the bare `food-data`.
        const dashboardName = isProd ? 'food-data' : `${stage}-food-data`;
        const dashboard = new cloudwatch.Dashboard(this, 'FoodDataDashboard', { dashboardName });
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Fetch queue depth & oldest-pending age',
                left: [emfMetric(FOOD_METRIC.fetchQueueDepth, 'max')],
                right: [emfMetric(FOOD_METRIC.pendingAgeSeconds, 'max')],
            }),
            new cloudwatch.GraphWidget({
                title: 'In-flight leases',
                left: [emfMetric(FOOD_METRIC.inFlightLeases, 'max')],
            }),
        );
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Per-source rolling-60-min calls',
                left: [emfMetric(FOOD_METRIC.sourceRollingWindowCount, 'sum')],
            }),
            new cloudwatch.GraphWidget({
                title: 'UNRESOLVED backlog & tombstones',
                left: [emfMetric(FOOD_METRIC.unresolvedBacklog, 'max'), emfMetric(FOOD_METRIC.tombstoneCount, 'max')],
            }),
        );
        dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Resolution latency (p50/p90, seconds)',
                left: [
                    emfMetric(FOOD_METRIC.resolutionLatencySeconds, 'p50'),
                    emfMetric(FOOD_METRIC.resolutionLatencySeconds, 'p90'),
                ],
            }),
            new cloudwatch.GraphWidget({
                title: 'Worker error rate',
                left: [emfMetric(FOOD_METRIC.workerErrorCount, 'sum')],
            }),
        );

        // ── Outputs ─────────────────────────────────────────────────────────────────────────────
        new CfnOutput(this, 'FoodServiceUrl', {
            value: this.serviceUrl,
            exportName: `${this.stackName}:FoodServiceUrl`,
        });
        new CfnOutput(this, 'FoodFetchWorkerServiceName', {
            value: this.foodFetchWorkerServiceName,
            exportName: `${this.stackName}:foodFetchWorkerServiceName`,
        });
        new CfnOutput(this, 'FoodEventBusName', {
            value: eventBus.eventBusName,
            exportName: `${this.stackName}:FoodEventBusName`,
        });
        // Exported for the deploy-time `lambda invoke` migration step (mirrors identity-webhooks).
        new CfnOutput(this, 'FoodMigrationFunctionName', {
            value: migrationFn.functionName,
            exportName: `${this.stackName}:FoodMigrationFunctionName`,
        });
    }
}
