/**
 * Lambda adapter for the sandbox scheduler (ADR-0007, ADR-0060).
 *
 * This is a thin, mechanical adapter: it constructs the AWS SDK v3 clients (RDS/ECS/EC2/SSM/EventBridge — provided
 * by the Node 22 Lambda runtime, so they are marked `external` at bundle time and are NOT package
 * dependencies) and adapts them to the injected client interfaces in `lib/sandbox-scheduler/scheduler`,
 * where ALL the sandbox-only selection + stop/start decision logic lives (and is unit-tested).
 *
 * It is deliberately located under `src/` (outside the infra `tsconfig` `bin`/`lib` include) because
 * it depends on the runtime-provided SDK rather than an installed package; esbuild bundles it via
 * `esbuild.mjs`. The type-checked, tested logic is entirely in the `lib/` module it delegates to.
 *
 * @sideEffect Stops/starts sandbox RDS, ECS services and the NAT EC2 instance, and enables/disables scheduled rules.
 */
import {
    DescribeDBInstancesCommand,
    RDSClient,
    StartDBInstanceCommand,
    StopDBInstanceCommand,
} from '@aws-sdk/client-rds';
import {
    DescribeServicesCommand,
    ECSClient,
    DescribeClustersCommand,
    ListClustersCommand,
    ListServicesCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import { DescribeInstancesCommand, EC2Client, StartInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2';
import {
    DisableRuleCommand,
    EnableRuleCommand,
    EventBridgeClient,
    ListRulesCommand,
    ListTagsForResourceCommand,
} from '@aws-sdk/client-eventbridge';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

import {
    assertRunSucceeded,
    parseSchedulerRequest,
    runSchedulerAction,
    SCHEDULED_RULE_STAGE_TAG,
    type EcsClusterSummary,
    type EcsServiceSummary,
    type Ec2InstanceSummary,
    type RdsInstanceSummary,
    type ScheduledRuleSummary,
    type SchedulerClients,
    type SchedulerSummary,
} from '../../lib/sandbox-scheduler/scheduler.js';

const rdsClient = new RDSClient({});
const ecsClient = new ECSClient({});
const ec2Client = new EC2Client({});
const ssmClient = new SSMClient({});
// ⚠️ Adaptive retry, because every parallel deploy in Sandbox Up runs `sync` at once and each reads one tag set per
// rule: EventBridge's control plane throttles that burst, and the default three attempts failed a deploy on it.
const eventBridgeClient = new EventBridgeClient({ retryMode: 'adaptive', maxAttempts: 10 });

/**
 * The name prefix every rule this repository deploys carries. CloudFormation truncates a generated rule name but
 * keeps its start, which is the stack name (`kitchensink-…`), so this scopes the listing to this repository's
 * rules in an account that also hosts another application. The IAM resource pattern is the same prefix.
 */
const RULE_NAME_PREFIX = 'kitchensink-';

const clients: SchedulerClients = {
    rds: {
        async listInstances(): Promise<RdsInstanceSummary[]> {
            const response = await rdsClient.send(new DescribeDBInstancesCommand({}));

            return (response.DBInstances ?? []).map((instance) => ({
                identifier: instance.DBInstanceIdentifier ?? '',
                status: instance.DBInstanceStatus ?? '',
            }));
        },
        async stopInstance(identifier: string): Promise<void> {
            await rdsClient.send(new StopDBInstanceCommand({ DBInstanceIdentifier: identifier }));
        },
        async startInstance(identifier: string): Promise<void> {
            await rdsClient.send(new StartDBInstanceCommand({ DBInstanceIdentifier: identifier }));
        },
    },
    ecs: {
        async listClusters(): Promise<EcsClusterSummary[]> {
            const arns: string[] = [];
            let nextToken: string | undefined;

            do {
                const response = await ecsClient.send(new ListClustersCommand({ nextToken }));
                arns.push(...(response.clusterArns ?? []));
                nextToken = response.nextToken;
            } while (nextToken);

            const clusters: EcsClusterSummary[] = [];

            // ⚠️ `DescribeClusters` accepts at most 100 clusters per call, and TAGS are opt-in: without
            // `include: ['TAGS']` the response carries none and every per-PR cluster reads as untagged —
            // which is exactly the invisible state this change exists to remove.
            for (let index = 0; index < arns.length; index += 100) {
                const response = await ecsClient.send(
                    new DescribeClustersCommand({ clusters: arns.slice(index, index + 100), include: ['TAGS'] }),
                );

                for (const cluster of response.clusters ?? []) {
                    if (cluster.clusterArn) {
                        clusters.push({
                            arn: cluster.clusterArn,
                            environmentTag: (cluster.tags ?? []).find((tag) => tag.key === 'Environment')?.value,
                        });
                    }
                }
            }

            return clusters;
        },
        async listServices(clusterArn: string): Promise<EcsServiceSummary[]> {
            const serviceArns: string[] = [];
            let nextToken: string | undefined;

            do {
                const response = await ecsClient.send(new ListServicesCommand({ cluster: clusterArn, nextToken }));
                serviceArns.push(...(response.serviceArns ?? []));
                nextToken = response.nextToken;
            } while (nextToken);

            const summaries: EcsServiceSummary[] = [];

            // DescribeServices accepts at most 10 services per call.
            for (let index = 0; index < serviceArns.length; index += 10) {
                const batch = serviceArns.slice(index, index + 10);
                const response = await ecsClient.send(
                    new DescribeServicesCommand({ cluster: clusterArn, services: batch }),
                );

                for (const service of response.services ?? []) {
                    summaries.push({
                        clusterArn,
                        serviceArn: service.serviceArn ?? '',
                        serviceName: service.serviceName ?? '',
                        desiredCount: service.desiredCount ?? 0,
                    });
                }
            }

            return summaries;
        },
        async updateDesiredCount(clusterArn: string, serviceArn: string, desiredCount: number): Promise<void> {
            await ecsClient.send(new UpdateServiceCommand({ cluster: clusterArn, service: serviceArn, desiredCount }));
        },
    },
    ec2: {
        async listInstances(): Promise<Ec2InstanceSummary[]> {
            const summaries: Ec2InstanceSummary[] = [];
            let nextToken: string | undefined;

            do {
                const response = await ec2Client.send(new DescribeInstancesCommand({ NextToken: nextToken }));

                for (const reservation of response.Reservations ?? []) {
                    for (const instance of reservation.Instances ?? []) {
                        const nameTag = (instance.Tags ?? []).find((tag) => tag.Key === 'Name')?.Value;
                        summaries.push({
                            instanceId: instance.InstanceId ?? '',
                            state: instance.State?.Name ?? '',
                            nameTag,
                            sourceDestCheck: instance.SourceDestCheck ?? undefined,
                        });
                    }
                }

                nextToken = response.NextToken;
            } while (nextToken);

            return summaries;
        },
        async stopInstances(instanceIds: string[]): Promise<void> {
            await ec2Client.send(new StopInstancesCommand({ InstanceIds: instanceIds }));
        },
        async startInstances(instanceIds: string[]): Promise<void> {
            await ec2Client.send(new StartInstancesCommand({ InstanceIds: instanceIds }));
        },
    },
    ssm: {
        async getParameter(name: string): Promise<string | undefined> {
            try {
                const response = await ssmClient.send(new GetParameterCommand({ Name: name }));

                return response.Parameter?.Value;
            } catch (error) {
                if (error instanceof Error && error.name === 'ParameterNotFound') {
                    return undefined;
                }

                throw error;
            }
        },
        async putParameter(name: string, value: string): Promise<void> {
            await ssmClient.send(
                new PutParameterCommand({ Name: name, Value: value, Type: 'String', Overwrite: true }),
            );
        },
    },
    events: {
        // ⚠️ `ListRules` + `ListTagsForResource`, NOT the Resource Groups Tagging API. The post-deploy sync runs
        // seconds after CloudFormation created a rule, and the tagging API's index is eventually consistent — a
        // rule it has not indexed yet would be left DISABLED behind a green sync. EventBridge's own API is not.
        async listScheduledRules(): Promise<ScheduledRuleSummary[]> {
            const rules: ScheduledRuleSummary[] = [];
            let nextToken: string | undefined;

            do {
                const page = await eventBridgeClient.send(
                    new ListRulesCommand({ NamePrefix: RULE_NAME_PREFIX, NextToken: nextToken }),
                );

                for (const rule of page.Rules ?? []) {
                    // An event-pattern rule is not the scheduler's: the CDK gate leaves it untouched, so this does.
                    if (rule.Name === undefined || rule.Arn === undefined || rule.ScheduleExpression === undefined) {
                        continue;
                    }

                    const { Tags: tags = [] } = await eventBridgeClient.send(
                        new ListTagsForResourceCommand({ ResourceARN: rule.Arn }),
                    );
                    const tagValue = (key: string): string | undefined => tags.find((tag) => tag.Key === key)?.Value;

                    rules.push({
                        name: rule.Name,
                        stageTag: tagValue(SCHEDULED_RULE_STAGE_TAG),
                        environmentTag: tagValue('Environment'),
                    });
                }

                nextToken = page.NextToken;
            } while (nextToken);

            return rules;
        },
        async enableRule(name: string): Promise<void> {
            await eventBridgeClient.send(new EnableRuleCommand({ Name: name }));
        },
        async disableRule(name: string): Promise<void> {
            await eventBridgeClient.send(new DisableRuleCommand({ Name: name }));
        },
    },
};

/**
 * Lambda entrypoint. Parses the event into one scheduler command and runs it.
 *
 * @param event - `{ action: 'stop' }` from the midnight schedule, `{ action: 'start', stage: 'pr-<N>' }` from Sandbox
 *   Up, or `{ action: 'sync' }` from any workflow that changed what is up.
 * @returns The structured run summary (also logged).
 * @throws {InvalidSchedulerRequestError} When the event is not exactly one of the three commands — never defaulted.
 * @throws {SchedulerRunFailedError} When any resource or rule failed its transition, after every step has run.
 */
export const handler = async (event: unknown): Promise<SchedulerSummary> => {
    const request = parseSchedulerRequest(event);
    const summary = await runSchedulerAction(request, clients);

    console.log(JSON.stringify({ message: 'sandbox-scheduler run complete', ...summary }));
    assertRunSucceeded(summary);

    return summary;
};
