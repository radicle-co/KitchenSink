import {
    CfnOutput,
    Duration,
    Fn,
    Stack,
    type StackProps,
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
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/** Props for {@link FoodServiceStack}. */
export interface FoodServiceStackProps extends StackProps {
    /** Deploy stage (`prod`, `sandbox-*`, …). */
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
}

/**
 * Food service infrastructure (feature 003).
 *
 * Mirrors `IdentityServiceStack`: an ECS/Fargate NestJS service fronted by the shared per-stage ALB
 * (owned by the global infra) via a host-based listener rule. Additionally
 * defines the **Fargate consumer worker** (single desired count — the Postgres `fetch_queue` is the
 * demand queue, so there is NO SQS), the three lambdas (stale-refresh, bulk-sync, search-indexer),
 * and the EventBridge **scheduled-producer** wiring. It does NOT create an RDS instance — it
 * `Fn.importValue`s the shared `kitchensink-data-{stage}:Database{Endpoint,Port,SecretArn}` exports
 * plus the new `:FoodDbSecretArn` and connects to the `kitchensink_food` database.
 *
 * This is a foundation skeleton: handlers point at placeholder asset code that later phases flesh
 * out (T-017+ worker drain loop, T-023/T-030/T-032 lambdas).
 *
 * @implements ARCH-001 FR-019 FR-022 FR-031
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

        // EventBridge bus the producer/consumer use to signal fetch lifecycle (no SQS).
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
            environment: { ...foodDbEnvironment, PORT: '3000' },
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
            assignPublicIp: false,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
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
            environment: { ...foodDbEnvironment, FOOD_WORKER: '1' },
            secrets: foodDbSecrets,
            command: ['node', 'dist/worker/main.js'],
        });

        const workerService = new ecs.FargateService(this, 'FoodFetchWorkerService', {
            cluster,
            taskDefinition: workerTaskDefinition,
            // FR-022: exactly one consumer holds the LISTEN connection at MVP.
            desiredCount: workerDesiredCount,
            assignPublicIp: false,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            securityGroups: [serviceSecurityGroup],
            // A rolling deploy must not run two consumers; keep at most one task during deploys.
            minHealthyPercent: 0,
            maxHealthyPercent: 100,
        });
        this.foodFetchWorkerServiceName = workerService.serviceName;

        // ── Lambdas (stale-refresh, bulk-sync, search-indexer) ──────────────────────────────────
        const lambdaEnvironment: Record<string, string> = {
            STAGE: stage,
            FOOD_DB_SECRET_ARN: foodDbSecret.secretArn,
            FOOD_DB_ENDPOINT: database.dbInstanceEndpointAddress,
            FOOD_DB_NAME: Fn.importValue(`kitchensink-data-${stage}:FoodDatabaseName`),
            FOOD_EVENT_BUS_NAME: eventBus.eventBusName,
        };

        const makeLambda = (name: string, handler: string): lambda.Function => {
            const fn = new lambda.Function(this, name, {
                runtime: lambda.Runtime.NODEJS_22_X,
                architecture: lambda.Architecture.ARM_64,
                handler,
                // Foundation skeleton: inline placeholder. Later phases replace with bundled asset code.
                code: lambda.Code.fromInline(
                    'export const handler = async () => ({ statusCode: 200, body: "not-implemented" });',
                ),
                timeout: Duration.minutes(5),
                memorySize: 512,
                environment: lambdaEnvironment,
                vpc,
                vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
                securityGroups: [serviceSecurityGroup],
            });
            foodDbSecret.grantRead(fn);
            eventBus.grantPutEventsTo(fn);

            return fn;
        };

        const staleRefreshLambda = makeLambda('FoodStaleRefreshLambda', 'index.handler');
        const bulkSyncLambda = makeLambda('FoodBulkSyncLambda', 'index.handler');
        const searchIndexerLambda = makeLambda('FoodSearchIndexerLambda', 'index.handler');

        // ── EventBridge wiring ──────────────────────────────────────────────────────────────────
        // Scheduled producer: nightly stale refresh (T-030) and weekly bulk sync (T-032).
        new events.Rule(this, 'FoodStaleRefreshSchedule', {
            description: 'Daily USDA stale-data refresh (FR-031)',
            schedule: events.Schedule.cron({ minute: '0', hour: '3' }),
            targets: [new targets.LambdaFunction(staleRefreshLambda)],
        });

        new events.Rule(this, 'FoodBulkSyncSchedule', {
            description: 'Weekly USDA Foundation/SR-Legacy bulk sync (FR-031)',
            schedule: events.Schedule.cron({ minute: '0', hour: '2', weekDay: 'SUN' }),
            targets: [new targets.LambdaFunction(bulkSyncLambda)],
        });

        // Event-driven search indexer: react to FoodFetchCompleted emitted by the worker (T-023).
        new events.Rule(this, 'FoodFetchCompletedRule', {
            eventBus,
            description: 'Reindex search_vector when a fetch completes (FR-008)',
            eventPattern: {
                source: ['kitchensink.food'],
                detailType: ['FoodFetchCompleted'],
            },
            targets: [new targets.LambdaFunction(searchIndexerLambda)],
        });

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
    }
}
